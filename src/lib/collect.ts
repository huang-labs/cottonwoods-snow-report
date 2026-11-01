import { createFetchContext, type CollectorSecrets } from "./http";
import { SOURCES } from "./sources";
import type { SourceDefinition } from "./sources/types";
import { readSnapshot, writeSnapshot, type KVLike } from "./store";
import type { Snapshot, SourceId, SourceRecord } from "./types";

export interface CollectorEnv extends CollectorSecrets {
  SNOW_KV: KVLike;
}

export interface CollectOptions {
  now?: Date;
  sources?: SourceDefinition[];
  fetchImpl?: typeof fetch;
  /** Restrict to specific sources (manual runs). */
  only?: SourceId[];
}

export interface CollectSummary {
  startedAt: string;
  durationMs: number;
  results: Array<{ id: SourceId; ok: boolean; error?: string; ms: number }>;
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
  const defs = (opts.sources ?? SOURCES).filter((s) => !opts.only || opts.only.includes(s.id));
  const previous = await readSnapshot(env.SNOW_KV);
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
  // records of sources that no longer exist are dropped.
  for (const def of SOURCES) {
    const prev = previous?.sources[def.id];
    if (prev) snapshot.sources[def.id] = prev;
  }
  for (const { rec } of records) snapshot.sources[rec.id] = rec;
  await writeSnapshot(env.SNOW_KV, snapshot);
  return {
    startedAt: now.toISOString(),
    durationMs: Date.now() - started,
    results: records.map(({ rec, ms }) => ({
      id: rec.id,
      ok: rec.status === "ok",
      ...(rec.status === "error" ? { error: rec.lastError ?? "unknown" } : {}),
      ms,
    })),
  };
}
