import { describe, expect, it } from "vitest";
import { emptyDailySnowState } from "@/lib/dailysnow";
import { emptyState, planRecommendation, ruleNoPick } from "@/lib/recommend";
import { mergeSnapshot } from "@/lib/store";
import type { DailySnowPost, Snapshot } from "@/lib/types";
import { buildDigest } from "@/lib/recommend/digest";

const old = "2026-11-02T13:00:00.000Z";
const attempt = "2026-11-03T13:00:00.000Z";
const later = "2026-11-03T13:05:00.000Z";
const finished = "2026-11-03T13:01:00.000Z";
const snapshot = (): Snapshot => ({ schemaVersion: 1, writtenAt: later, sources: {} });
const post = (generatedAt: string): DailySnowPost => ({
  date: generatedAt.slice(0, 10), generatedAt, title: generatedAt, phase: "quiet", summary: "Quiet", sections: [], figures: {},
  numbers: { canyons: [], resorts: [] }, model: "test", trigger: "morning",
});
const daily = () => ({ ...emptyDailySnowState(), lastAttemptAt: attempt, current: post(old) });
const recommendation = () => {
  const now = new Date(old);
  return { ...emptyState(now), lastAttemptAt: attempt, current: ruleNoPick(buildDigest(snapshot(), {}, now), now) };
};

describe("monotonic AI publication", () => {
  it.each(["dailySnow", "recommendation"] as const)("%s keeps completion over a same-attempt reservation in either merge direction", (key) => {
    const reserved = snapshot();
    const done = snapshot();
    if (key === "dailySnow") {
      reserved.dailySnow = daily();
      done.dailySnow = { ...daily(), current: post(attempt), lastFinishedAt: finished, history: [{ date: "2026-11-03", title: "Published", phase: "quiet", postedAt: attempt, forecast: [] }] };
    } else {
      reserved.recommendation = recommendation();
      done.recommendation = { ...recommendation(), current: { ...recommendation().current!, generatedAt: attempt }, lastFinishedAt: finished };
    }
    for (const [a, b] of [[reserved, done], [done, reserved]]) {
      expect(mergeSnapshot(a, b)[key]).toEqual(done[key]);
    }
  });

  it.each(["dailySnow", "recommendation"] as const)("%s preserves a published result when a later attempt carries old output", (key) => {
    const a = snapshot();
    const b = snapshot();
    if (key === "dailySnow") {
      a.dailySnow = { ...daily(), current: post(attempt), lastFinishedAt: finished };
      b.dailySnow = { ...daily(), lastAttemptAt: later, attempts: { date: "2026-11-03", count: 2, calls: 4 } };
    } else {
      a.recommendation = { ...recommendation(), current: { ...recommendation().current!, generatedAt: attempt }, lastFinishedAt: finished };
      b.recommendation = { ...recommendation(), lastAttemptAt: later, calls: { date: "2026-11-03", count: 4 } };
    }
    for (const [latest, incoming] of [[a, b], [b, a]]) {
      const merged = mergeSnapshot(latest, incoming)[key]!;
      expect(merged.lastAttemptAt).toBe(later);
      expect(merged.current!.generatedAt).toBe(attempt);
      if (key === "dailySnow") expect(mergeSnapshot(latest, incoming).dailySnow!.attempts.calls).toBe(4);
      else expect(mergeSnapshot(latest, incoming).recommendation!.calls.count).toBe(4);
    }
  });

  it.each(["dailySnow", "recommendation"] as const)("%s keeps a failed completion over its reservation", (key) => {
    const reserved = snapshot();
    const failed = snapshot();
    if (key === "dailySnow") {
      reserved.dailySnow = daily();
      failed.dailySnow = { ...daily(), lastError: "model failed", consecutiveFailures: 1, lastFinishedAt: finished };
    } else {
      reserved.recommendation = recommendation();
      failed.recommendation = { ...recommendation(), lastError: "model failed", consecutiveFailures: 1, lastFinishedAt: finished };
    }
    for (const [a, b] of [[reserved, failed], [failed, reserved]]) expect(mergeSnapshot(a, b)[key]).toEqual(failed[key]);
  });

  it("recognizes legacy successful output without a completion marker", () => {
    const latest = { ...snapshot(), recommendation: { ...recommendation(), current: { ...recommendation().current!, generatedAt: attempt } } };
    const incoming = { ...snapshot(), recommendation: recommendation() };
    expect(mergeSnapshot(latest, incoming).recommendation!.current!.generatedAt).toBe(attempt);
  });

  it("advances a rule-based no-pick beyond an older model attempt", () => {
    const base = recommendation();
    const now = new Date(later);
    const plan = planRecommendation(base, snapshot(), { AI: { run: async () => { throw new Error("unexpected model call"); } } }, now)!;
    expect(plan.run).toBeUndefined();
    const merged = mergeSnapshot({ ...snapshot(), recommendation: base }, { ...snapshot(), recommendation: plan.state });
    expect(merged.recommendation!.current!.generatedAt).toBe(later);
    expect(merged.recommendation!.lastFinishedAt).toBe(later);
  });
});
