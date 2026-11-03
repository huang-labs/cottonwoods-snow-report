import { createFetchContext, type CollectorSecrets } from "../http";
import type { RecommendEnv } from "../recommend";
import { denverDate } from "../recommend/digest";
import { DAILY_SNOW_ARCHIVE_POSTS } from "../report";
import type { KVLike } from "../store";
import type { DailySnowFigure, DailySnowLink, DailySnowPost, DailySnowState, Snapshot } from "../types";
import { historyEntry } from "./continuity";
import { buildDailyDigest, type FigureCandidate } from "./digest";
import { askDailySnow, MAX_FIGURES } from "./llm";
import { isSnowPlume } from "./plume";
import { attemptsToday, DAILY_CALL_CAP, shouldRunDailySnow } from "./schedule";

export interface DailySnowEnv extends RecommendEnv, CollectorSecrets {
  SNOW_KV: KVLike;
}

/** Archived posts and their figure stills (one write per post, plus one per image figure).
    Stored without expiry: KV keeps every post as the business archive, and /api/daily-snow serves any of them. */
export const dailySnowKey = (date: string) => `dailysnow:v1:${date}`;
export const dailySnowFigureKey = (date: string, id: string) => `dailysnow-fig:v1:${date}:${id}`;
export const dailySnowFigureUrl = (date: string, id: string) => `/api/daily-snow/figure/${date}/${id}`;
const MAX_IMAGE_BYTES = 3_000_000;

/** Point the archived post at `date` forward to its newer neighbor. A failure only costs that one
    "newer" link (the page falls back to the archive list), so it never fails the new post. */
async function linkNewer(kv: KVLike, date: string, newer: DailySnowLink): Promise<void> {
  try {
    const raw = await kv.get(dailySnowKey(date), "text");
    if (!raw) return;
    await kv.put(dailySnowKey(date), JSON.stringify({ ...(JSON.parse(raw) as DailySnowPost), newer }));
  } catch (err) {
    console.warn("daily-snow: could not link the previous post forward", err);
  }
}

export function emptyDailySnowState(): DailySnowState {
  return { current: null, lastAttemptAt: null, lastFinishedAt: null, lastError: null, consecutiveFailures: 0, attempts: { date: "", count: 0, calls: 0 }, history: [] };
}

export interface DailySnowPlan {
  /** State to store before the model call (reserves the attempt). */
  state: DailySnowState;
  /** Resolves to the state to store afterwards. Never rejects. */
  run?: () => Promise<DailySnowState>;
  /** Why no post is written this run, when it was due. */
  skipped?: string;
}

/**
 * Our last post before `date`, for continuity. Usually the current post; when
 * today's post is being rewritten (a forced run), the one it links back to.
 * Without it the post is still written, just without the previous post's text.
 */
async function previousPost(kv: KVLike, current: DailySnowPost | null, date: string): Promise<DailySnowPost | null> {
  if (!current || current.date < date) return current;
  if (!current.older) return null;
  try {
    const raw = await kv.get(dailySnowKey(current.older.date), "text");
    return raw ? (JSON.parse(raw) as DailySnowPost) : null;
  } catch (err) {
    console.warn("daily-snow: could not read the previous post", err);
    return null;
  }
}

/** Copy each used image figure into KV so the post keeps this morning's still. Figures that fail are dropped. */
async function storeFigures(
  used: FigureCandidate[],
  date: string,
  env: DailySnowEnv,
  now: Date,
  fetchImpl: typeof fetch | undefined,
): Promise<Record<string, DailySnowFigure>> {
  const ctx = createFetchContext(env, now, fetchImpl);
  const out: Record<string, DailySnowFigure> = {};
  await Promise.all(
    used.map(async (c) => {
      const f = c.figure;
      if (f.kind !== "image") return void (out[f.id] = f);
      try {
        const bytes = c.source?.kind === "kv"
          ? await env.SNOW_KV.get(c.source.key, "arrayBuffer")
          : c.source?.kind === "url"
            ? (await ctx.fetchBytes(c.source.url, { contentType: "image/", maxBytes: MAX_IMAGE_BYTES, browserLike: true })).buffer as ArrayBuffer
            : null;
        if (!bytes || !bytes.byteLength) return;
        await env.SNOW_KV.put(dailySnowFigureKey(date, f.id), bytes);
        out[f.id] = { ...f, url: dailySnowFigureUrl(date, f.id) };
      } catch (e) {
        console.error(`dailysnow: figure ${f.id} not stored`, e);
      }
    }),
  );
  return out;
}

/**
 * Decide whether to write today's post after a collection run. Same two-phase
 * shape as planRecommendation: the attempt is stored with the fresh sources,
 * then `run` asks the model. Returns undefined without the AI binding.
 */
export function planDailySnow(
  prev: DailySnowState | undefined,
  snapshot: Snapshot,
  env: DailySnowEnv,
  now: Date,
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {},
): DailySnowPlan | undefined {
  const ai = env.AI;
  if (!ai) return undefined;
  const base = prev ?? emptyDailySnowState();
  const used = attemptsToday(base, now);
  const trigger = opts.force ? (used.calls + 2 > DAILY_CALL_CAP ? null : "manual") : shouldRunDailySnow(base, now);
  if (!trigger) return { state: base };

  const build = buildDailyDigest(snapshot, base.current, base.history, now);
  if (!build.worthPosting && !opts.force) return { state: base, skipped: "off-season" };

  const date = denverDate(now);
  const startedAt = Date.now();
  const attempt: Partial<DailySnowState> = {
    lastAttemptAt: now.toISOString(),
    attempts: { date, count: used.count + (opts.force ? 0 : 1), calls: used.calls + 2 },
  };
  const reserved: DailySnowState = { ...base, ...attempt };
  const finishedAt = () => new Date(now.getTime() + (Date.now() - startedAt)).toISOString();

  const run = async (): Promise<DailySnowState> => {
    try {
      const previous = await previousPost(env.SNOW_KV, base.current, date);
      // Collection may have merged newer source/storm records before this call.
      const { digest, numbers, stormRecap, figures: candidates } = buildDailyDigest(snapshot, previous, base.history, now);
      const { value: r, model, fallbackReason } = await askDailySnow(ai, digest, env.AI_GATEWAY_ID);
      const wanted = new Set(r.sections.flatMap((s) => s.paragraphs.map((p) => p.figure)).filter((f): f is string => !!f));
      // A storm recap must accompany its event facts, even if prose omits it.
      if (stormRecap) {
        if (wanted.size >= MAX_FIGURES && !wanted.has("storm-recap")) wanted.delete([...wanted].at(-1)!);
        wanted.add("storm-recap");
      }
      const figures = await storeFigures(candidates.filter((c) => wanted.has(c.figure.id)), date, env, now, opts.fetchImpl);
      // A plume is part of the report even if the model omitted it. Prefer CLN,
      // then try another station if its frozen still is unavailable. Never invent
      // prose or values for the image; the article renders its code-written caption.
      if (!Object.keys(figures).some(isSnowPlume)) {
        const plumes = candidates.filter((c) => isSnowPlume(c.figure.id) && !wanted.has(c.figure.id))
          .sort((a, b) => Number(b.figure.id === "plume-snow-cln") - Number(a.figure.id === "plume-snow-cln"));
        for (const candidate of plumes) {
          const copied = await storeFigures([candidate], date, env, now, opts.fetchImpl);
          if (!copied[candidate.figure.id]) continue;
          // Reserve one of the six figure slots for the required plume.
          if (Object.keys(figures).length >= MAX_FIGURES) {
            const lastOptional = [...wanted].reverse().find((id) => id !== "storm-recap" && figures[id]);
            if (lastOptional) delete figures[lastOptional];
          }
          Object.assign(figures, copied);
          break;
        }
      }
      const older = base.history.find((h) => h.date < date);
      const post: DailySnowPost = {
        date,
        phase: digest.phase,
        title: r.title,
        summary: r.summary,
        sections: r.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map((p) => ({ ...p, figure: p.figure && figures[p.figure] ? p.figure : null })) })),
        figures,
        numbers,
        ...(stormRecap ? { stormRecap } : {}),
        generatedAt: now.toISOString(),
        model,
        trigger,
        ...(fallbackReason ? { fallbackReason } : {}),
        ...(older ? { older: { date: older.date, title: older.title } } : {}),
      };
      await env.SNOW_KV.put(dailySnowKey(date), JSON.stringify(post));
      if (older) await linkNewer(env.SNOW_KV, older.date, { date, title: post.title });
      const history = [historyEntry(post), ...base.history.filter((h) => h.date !== date)].slice(0, DAILY_SNOW_ARCHIVE_POSTS);
      return { ...reserved, current: post, history, lastError: null, consecutiveFailures: 0, lastFinishedAt: finishedAt() };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ...reserved, lastError: message.slice(0, 500), consecutiveFailures: base.consecutiveFailures + 1, lastFinishedAt: finishedAt() };
    }
  };
  return { state: reserved, run };
}
