import { planDailySnow, type DailySnowPlan } from "./dailysnow";
import { createFetchContext, type CollectorSecrets } from "./http";
import { planRecommendation, type RecommendationPlan, type RecommendEnv } from "./recommend";
import { SOURCES } from "./sources";
import { MINUTE, type SourceDefinition } from "./sources/types";
import { readSnapshot, writeSnapshot, type KVLike } from "./store";
import type { Snapshot, SourceId, SourceRecord } from "./types";

export interface CollectorEnv extends CollectorSecrets, RecommendEnv {
  SNOW_KV: KVLike;
}

export interface CollectOptions {
  now?: Date;
  sources?: SourceDefinition[];
  fetchImpl?: typeof fetch;
  /** Restrict to specific sources (manual runs). */
  only?: SourceId[];
  /** Ask the model regardless of its schedule (manual runs). */
  forceRecommendation?: boolean;
  /** Write the Daily Snow post regardless of its schedule (manual runs). */
  forceDailySnow?: boolean;
}

export interface CollectSummary {
  startedAt: string;
  durationMs: number;
  results: Array<{ id: SourceId; ok: boolean; error?: string; ms: number }>;
  /** Sources not due this run (collected recently; see SourceDefinition.intervalMs). */
  skipped: SourceId[];
  /** Recommendation outcome this run, when the AI binding is configured. */
  recommendation?: { generatedAt: string | null; model: string | null; trigger: string | null; error: string | null };
  /** Daily Snow outcome this run, when the AI binding is configured and a post was due. */
  dailySnow?: {
    date: string | null;
    model: string | null;
    trigger: string | null;
    error: string | null;
    skipped: string | null;
    /** Why the primary model failed, when the fallback wrote the post. */
    fallbackReason?: string | null;
  };
}

/**
 * Whether a source should be collected this run. Cron runs land on exact
 * 5-minute marks, so a minute of slack keeps e.g. a 15-minute source on
 * :00/:15/:30/:45 instead of slipping a run.
 */
export function isDue(def: SourceDefinition, prev: SourceRecord | undefined, now: Date): boolean {
  if (!def.intervalMs || !prev?.lastAttemptAt || prev.status !== "ok") return true;
  return now.getTime() - Date.parse(prev.lastAttemptAt) >= def.intervalMs - MINUTE;
}

function emptyRecord(id: SourceId): SourceRecord {
  return {
    id,
    lastAttemptAt: null,
    lastSuccessfulFetchAt: null,
    sourceUpdatedAt: null,
    status: "never",
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    diagnostics: null,
    payload: null,
  };
}

/** Collect one source. Never throws: failures preserve the previous payload. */
export async function collectSource(
  def: SourceDefinition,
  previous: SourceRecord | undefined,
  env: CollectorSecrets,
  now: Date,
  fetchImpl?: typeof fetch,
  kv?: KVLike,
): Promise<SourceRecord> {
  const prev = previous ?? emptyRecord(def.id);
  const ctx = createFetchContext(env, now, fetchImpl, { kv, previous: prev.payload });
  const started = Date.now();
  const attemptAt = now.toISOString();
  try {
    const { payload, sourceUpdatedAt } = await def.collect(ctx);
    return {
      id: def.id,
      lastAttemptAt: attemptAt,
      lastSuccessfulFetchAt: attemptAt,
      sourceUpdatedAt,
      status: "ok",
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      diagnostics: { durationMs: Date.now() - started, upstream: ctx.calls },
      payload,
    };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return {
      ...prev,
      id: def.id,
      lastAttemptAt: attemptAt,
      status: "error",
      lastError: message.slice(0, 500),
      lastErrorAt: attemptAt,
      consecutiveFailures: prev.consecutiveFailures + 1,
      diagnostics: { durationMs: Date.now() - started, upstream: ctx.calls },
      // payload, lastSuccessfulFetchAt and sourceUpdatedAt are preserved from prev.
    };
  }
}

/**
 * Run every source concurrently and persist one snapshot. Sources are isolated:
 * one failure (or throw) never affects another source's record.
 */
export async function runCollection(env: CollectorEnv, opts: CollectOptions = {}): Promise<CollectSummary> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const previous = await readSnapshot(env.SNOW_KV);
  const selected = (opts.sources ?? SOURCES).filter((s) => !opts.only || opts.only.includes(s.id));
  // Manual runs (`only`) collect what was asked regardless of intervals.
  const defs = opts.only ? selected : selected.filter((s) => isDue(s, previous?.sources[s.id], now));
  const skipped = selected.filter((s) => !defs.includes(s)).map((s) => s.id);
  const records = await Promise.all(
    defs.map(async (def) => {
      const t = Date.now();
      const rec = await collectSource(def, previous?.sources[def.id], env, now, opts.fetchImpl, env.SNOW_KV);
      return { rec, ms: Date.now() - t };
    }),
  );
  const snapshot: Snapshot = {
    schemaVersion: 1,
    writtenAt: new Date().toISOString(),
    sources: {},
  };
  // Carry over records of sources not collected this run (manual `only` runs);
  // records of sources that no longer exist are dropped. writeSnapshot merges
  // this snapshot with whatever a concurrent run wrote since `previous` was
  // read, keeping the newer attempt per source (see store.ts).
  for (const def of SOURCES) {
    const prev = previous?.sources[def.id];
    if (prev) snapshot.sources[def.id] = prev;
  }
  for (const { rec } of records) snapshot.sources[rec.id] = rec;
  // The recommendation is derived from the fresh sources. Its bookkeeping goes
  // into the same KV put; a model call (a few times an hour at most) waits until
  // the source data is stored, then costs one more put.
  let plan: RecommendationPlan | undefined;
  try {
    plan = planRecommendation(previous?.recommendation, snapshot, env, now, { force: opts.forceRecommendation });
  } catch (err) {
    console.error("recommendation: failed", err);
  }
  const carried = plan?.state ?? previous?.recommendation;
  if (carried) snapshot.recommendation = carried;
  // The Daily Snow post (once a morning) follows the same pattern, in parallel with the pick.
  let daily: DailySnowPlan | undefined;
  try {
    daily = planDailySnow(previous?.dailySnow, snapshot, env, now, { force: opts.forceDailySnow, fetchImpl: opts.fetchImpl });
  } catch (err) {
    console.error("dailysnow: failed", err);
  }
  const carriedDaily = daily?.state ?? previous?.dailySnow;
  if (carriedDaily) snapshot.dailySnow = carriedDaily;
  snapshot.writtenAt = new Date().toISOString();
  await writeSnapshot(env.SNOW_KV, snapshot);
  if (plan?.run || daily?.run) {
    const [rec, post] = await Promise.all([plan?.run?.(), daily?.run?.()]);
    if (rec) snapshot.recommendation = rec;
    if (post) snapshot.dailySnow = post;
    await writeSnapshot(env.SNOW_KV, snapshot);
  }
  const ai = snapshot.recommendation;
  const updatedNow = ai?.current?.generatedAt === now.toISOString();
  const posted = snapshot.dailySnow?.current?.generatedAt === now.toISOString() ? snapshot.dailySnow.current : null;
  return {
    startedAt: now.toISOString(),
    durationMs: Date.now() - started,
    results: records.map(({ rec, ms }) => ({
      id: rec.id,
      ok: rec.status === "ok",
      ...(rec.status === "error" ? { error: rec.lastError ?? "unknown" } : {}),
      ms,
    })),
    skipped,
    ...(ai
      ? {
          recommendation: {
            generatedAt: ai.current?.generatedAt ?? null,
            model: updatedNow ? (ai.current?.model ?? null) : null,
            trigger: updatedNow ? (ai.current?.trigger ?? null) : null,
            error: ai.lastAttemptAt === now.toISOString() ? ai.lastError : null,
          },
        }
      : {}),
    ...(daily && (daily.run || daily.skipped)
      ? {
          dailySnow: {
            date: posted?.date ?? null,
            model: posted?.model ?? null,
            trigger: posted?.trigger ?? null,
            error: daily.run ? (snapshot.dailySnow?.lastError ?? null) : null,
            skipped: daily.skipped ?? null,
            fallbackReason: posted?.fallbackReason ?? null,
          },
        }
      : {}),
  };
}
