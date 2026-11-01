import type { Recommendation, RecommendationState, Snapshot } from "../types";
import { buildDigest, denverDate, updateLastOperating, type Digest } from "./digest";
import { askModel, type AiLike } from "./llm";
import { DAILY_CALL_CAP, criticalKeyOf, fingerprintOf, shouldRun } from "./schedule";

export interface RecommendEnv {
  /** Workers AI binding. Without it the recommendation is skipped entirely. */
  AI?: AiLike;
  /** AI Gateway id for logging and rate limiting (optional). */
  AI_GATEWAY_ID?: string;
}

export function emptyState(now: Date): RecommendationState {
  return {
    current: null,
    lastAttemptAt: null,
    lastError: null,
    consecutiveFailures: 0,
    fingerprint: null,
    criticalKey: null,
    calls: { date: denverDate(now), count: 0 },
    resortLastOperatingAt: {},
  };
}

/** Explicit "no pick" when no resort is in season; decided in code, no model call. */
export function ruleNoPick(digest: Digest, now: Date): Recommendation {
  const headline = digest.resorts.some((r) => r.inSeason)
    ? "No pick: access is restricted by interlodge"
    : "No pick: no resort confirmed open for skiing";
  return {
    targetDate: digest.target.date,
    mode: digest.mode,
    pick: null,
    plan: digest.resorts.some((r) => r.inSeason) ? "Wait for official access restrictions to be lifted." : "Check back once lifts are running.",
    headline,
    reasons: [],
    caveats: [],
    runnerUp: null,
    generatedAt: now.toISOString(),
    model: null,
    trigger: "no-eligible-resort",
  };
}

export interface RecommendationPlan {
  /** State to store now (season memory, rule-based "no pick"); no model call needed. */
  state: RecommendationState;
  /** Present when the model should be asked; resolves to the state to store afterwards. Never rejects. */
  run?: () => Promise<RecommendationState>;
}

/**
 * Decide what to do after a collection run. Split in two so the collector can
 * store fresh source data before waiting on the model. Returns undefined when
 * the AI binding is not configured.
 */
export function planRecommendation(
  prev: RecommendationState | undefined,
  snapshot: Snapshot,
  env: RecommendEnv,
  now: Date,
  opts: { force?: boolean } = {},
): RecommendationPlan | undefined {
  const ai = env.AI;
  if (!ai) return undefined;
  const base = prev ?? emptyState(now);
  const digest = buildDigest(snapshot, base.resortLastOperatingAt, now);
  const state: RecommendationState = {
    ...base,
    resortLastOperatingAt: updateLastOperating(digest, base.resortLastOperatingAt, now),
  };
  const keys = { fingerprint: fingerprintOf(digest), criticalKey: criticalKeyOf(digest) };

  if (!digest.eligible.length) {
    const noPick = ruleNoPick(digest, now);
    return { state: { ...state, ...keys, current: noPick, lastError: null, consecutiveFailures: 0 } };
  }

  // Reserve both primary and fallback requests, including manual runs.
  const today = denverDate(now);
  const used = state.calls.date === today ? state.calls.count : 0;
  if (used + 2 > DAILY_CALL_CAP) return { state };
  const trigger = opts.force ? "manual" : shouldRun(state, digest, now);
  if (!trigger) return { state };
  const calls = { date: today, count: used + 2 };
  const attempt = { lastAttemptAt: now.toISOString(), calls };
  const run = async (): Promise<RecommendationState> => {
    try {
      const r = await askModel(ai, digest, state.current, env.AI_GATEWAY_ID);
      const current: Recommendation = {
        targetDate: digest.target.date,
        mode: digest.mode,
        pick: r.pick,
        plan: r.plan,
        headline: r.headline,
        reasons: r.reasons,
        caveats: r.caveats,
        runnerUp: r.runnerUp,
        generatedAt: now.toISOString(),
        model: r.model,
        trigger,
      };
      return { ...state, ...keys, ...attempt, current, lastError: null, consecutiveFailures: 0 };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ...state, ...attempt, lastError: message.slice(0, 500), consecutiveFailures: state.consecutiveFailures + 1 };
    }
  };
  // Stored before the call, so the call counts toward the daily cap even if the run is cut off.
  return { state: { ...state, ...attempt }, run };
}
