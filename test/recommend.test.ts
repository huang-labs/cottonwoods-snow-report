import { beforeAll, describe, expect, it, vi } from "vitest";
import { runCollection } from "@/lib/collect";
import { buildReport, publicRecommendation } from "@/lib/report";
import { MemoryKV, readSnapshot, writeSnapshot } from "@/lib/store";
import { canyonTexts, classifyCanyon } from "@/lib/recommend/canyon";
import { buildDigest, slrOf, targetFor } from "@/lib/recommend/digest";
import { emptyState, planRecommendation } from "@/lib/recommend";
import { FALLBACK_MODEL, PRIMARY_MODEL, responseJson } from "@/lib/ai/model";
import { askModel, validatePick } from "@/lib/recommend/llm";
import { criticalKeyOf, fingerprintOf, shouldRun } from "@/lib/recommend/schedule";
import type { Recommendation, ResortReport, RoadsPayload, Snapshot, TravelTimesPayload } from "@/lib/types";
import { createFixtureFetch } from "./fixtureFetch";

const now = new Date("2026-10-30T14:00:00Z"); // 8 AM MDT
let captured: Snapshot;
beforeAll(async () => {
  const kv = new MemoryKV();
  await runCollection({ SNOW_KV: kv }, { now, fetchImpl: createFixtureFetch().fetchImpl });
  captured = (await readSnapshot(kv))!;
});
function snapshot(open = true): Snapshot {
  const s = structuredClone(captured);
  if (open) for (const id of ["alta", "snowbird", "solitude", "brighton"] as const) {
    s.sources[id]!.sourceUpdatedAt = now.toISOString();
    const r = s.sources[id]!.payload as ResortReport;
    r.liftsOpen = 3;
    r.operatingStatus = "Open";
    r.lifts = [];
  }
  return s;
}
function pick(): Recommendation {
  return { targetDate: "2026-10-30", mode: "storm", pick: "alta", headline: "Alta for powder", plan: "Wait for the posted opening.", summary: "Alta has the deepest snow.", caveats: [], runnerUp: "solitude", generatedAt: now.toISOString(), model: PRIMARY_MODEL, trigger: "target-day" };
}
const result = { pick: "alta", headline: "Alta for powder", plan: "Wait for the posted opening.", summary: "Alta has the deepest snow.", caveats: [], runnerUp: "solitude", changedBecause: "" };

describe("canyon access", () => {
  const classify = (text: string, at = now) => classifyCanyon("LCC", [{ canyon: "LCC", text }], at);
  it("excludes multi-line seasonal signs before splitting phases", () => {
    const roads: RoadsPayload = { contributors: [], partialFailures: [], notices: [], signs: [{ name: "mouth", roadway: "SR-210", direction: null, source: "UDOT", messages: ["GUARDSMAN PASS", "CLOSED FOR", "WINTER"] }] };
    expect(canyonTexts(roads, {}, now)).toEqual([]);
    const digest = buildDigest(snapshot(), {}, now);
    expect(digest.canyons[0].state).not.toBe("closed");
  });
  it("keeps a closed canyon with an estimated opening available for a wait strategy", () => {
    expect(classify("LCC CLOSED for avalanche control, estimated opening 9:30 AM")).toMatchObject({ state: "closed-expected-open", expectedOpenAt: "2026-10-30T15:30:00.000Z" });
    expect(classify("LCC CLOSED until 9:30 AM").state).toBe("closed-expected-open");
    expect(classify("LCC CLOSED, opening time unknown").state).toBe("closed");
  });
  it("does not turn a delayed opening estimate into tomorrow's opening", () => {
    expect(classify("LCC CLOSED, estimated opening 9:30 AM", new Date("2026-10-30T18:00:00Z")).expectedOpenAt).toBe("2026-10-30T15:30:00.000Z");
  });
  it("distinguishes an announced closure, interlodge and parking notices", () => {
    expect(classify("LCC will close at 10 PM")).toMatchObject({ state: "unknown", closureAnnounced: { at: "2026-10-31T04:00:00.000Z" } });
    expect(classify("Interlodge in effect").state).toBe("interlodge");
    expect(classify("Interlodge lifted. Road open").state).toBe("open");
    expect(classify("Parking lots closed").state).not.toBe("closed");
    expect(classifyCanyon("BCC", [], now).state).toBe("unknown");
  });
});

describe("recommendation digest", () => {
  it("switches target at 2 PM Denver across DST", () => {
    expect(targetFor(new Date("2026-11-01T20:59:00Z")).date).toBe("2026-11-01");
    expect(targetFor(new Date("2026-11-01T21:00:00Z"))).toMatchObject({ date: "2026-11-02", day: "tomorrow" });
    expect(targetFor(new Date("2026-10-31T20:00:00Z")).date).toBe("2026-11-01");
  });
  it("calculates SLR only for meaningful precipitation", () => {
    expect(slrOf(8, 0.5)).toBe("16:1 very light (blower)");
    expect(slrOf(0.1, 0.01)).toBeNull();
    expect(slrOf(null, 0.5)).toBeNull();
  });
  it("retains season eligibility overnight and through storm closures", () => {
    const s = snapshot();
    const r = s.sources.alta!.payload as ResortReport;
    r.liftsOpen = 0;
    expect(buildDigest(s, { alta: new Date(now.getTime() - 18 * 3600_000).toISOString() }, now).eligible).toContain("alta");
    expect(buildDigest(s, {}, now).eligible).not.toContain("alta");
    r.operatingStatus = "Closed for the season";
    expect(buildDigest(s, { alta: now.toISOString() }, now).eligible).not.toContain("alta");
  });
  it("does not refresh season memory from stale resort reports", () => {
    const s = snapshot();
    s.sources.alta!.lastSuccessfulFetchAt = "2026-10-29T14:00:00Z";
    expect(buildDigest(s, {}, now).resorts[0].operatingNow).toBe(false);
  });
  it("marks frozen UDOT measurements non-live", () => {
    const d = buildDigest(snapshot(), {}, now);
    expect(d.travelTimesLive).toBe(false);
    expect(d.resorts.every((r) => r.travelFromCanyonBase === null)).toBe(true);
    const s = snapshot();
    (s.sources.traveltimes!.payload as TravelTimesPayload).newestMeasurementAt = now.toISOString();
    expect(buildDigest(s, {}, now).travelTimesLive).toBe(true);
  });
  it("excludes today's interlodge canyon while allowing tomorrow's forecast", () => {
    const s = snapshot();
    const roads = s.sources.roads!.payload as RoadsPayload;
    roads.signs = [];
    roads.notices = [{ title: "Interlodge", text: "LCC interlodge in effect", canyon: "LCC", severity: "critical", source: "UDOT", updatedAt: now.toISOString() }];
    expect(buildDigest(s, {}, now).eligible).toEqual(["solitude", "brighton"]);
    expect(buildDigest(s, { alta: now.toISOString() }, new Date("2026-10-30T20:00:00Z")).eligible).toContain("alta");
  });
});

describe("change-driven scheduling", () => {
  function setup(at = now) {
    const d = buildDigest(snapshot(), {}, at);
    const state = { ...emptyState(at), current: { ...pick(), targetDate: d.target.date, generatedAt: new Date(at.getTime() - 15 * 60_000).toISOString() }, fingerprint: fingerprintOf(d), criticalKey: criticalKeyOf(d) };
    return { d, state };
  }
  it("does not call on every collection; reacts to critical and material changes", () => {
    const { d, state } = setup();
    expect(shouldRun(state, d, now)).toBeNull();
    d.signals.canyonKeys.push("LCC:closed");
    expect(shouldRun(state, d, now)).toBe("critical-change");
    const other = setup();
    other.d.signals.snowKeys.push("parking full");
    expect(shouldRun(other.state, other.d, now)).toBeNull();
    other.state.current.generatedAt = new Date(now.getTime() - 31 * 60_000).toISOString();
    expect(shouldRun(other.state, other.d, now)).toBe("conditions-changed");
  });
  it("refreshes morning anchors and daytime max age, stays quiet overnight", () => {
    const at = new Date("2026-10-30T13:15:00Z");
    const { d, state } = setup(at);
    expect(shouldRun(state, d, at)).toBe("morning-refresh");
    const midday = new Date("2026-10-30T17:00:00Z");
    const daytime = setup(midday);
    daytime.state.current.generatedAt = "2026-10-30T14:30:00Z";
    expect(shouldRun(daytime.state, daytime.d, midday)).toBe("max-age");
    const quietAt = new Date("2026-10-31T09:00:00Z");
    const quiet = setup(quietAt);
    quiet.d.signals.snowKeys.push("changed");
    quiet.state.current.generatedAt = new Date(quietAt.getTime() - 3 * 3600_000).toISOString();
    expect(shouldRun(quiet.state, quiet.d, quietAt)).toBeNull();
  });
  it("backs off failures and caps manual requests including fallback reservations", () => {
    const { d, state } = setup();
    state.lastAttemptAt = now.toISOString();
    state.lastError = "timeout";
    expect(shouldRun(state, d, now)).toBeNull();
    state.lastAttemptAt = new Date(now.getTime() - 11 * 60_000).toISOString();
    expect(shouldRun(state, d, now)).toBe("retry");
    state.calls.count = 40;
    const ai = { run: vi.fn() };
    expect(planRecommendation(state, snapshot(), { AI: ai }, now, { force: true })?.run).toBeUndefined();
  });
});

describe("model validation and persistence", () => {
  it("rejects invalid picks and incomplete output; accepts both Workers AI response forms", () => {
    expect(() => validatePick({ ...result, pick: "snowbasin" }, ["alta", "solitude"])).toThrow(/ineligible/);
    expect(() => validatePick({ pick: "alta", headline: "Alta" }, ["alta"])).toThrow();
    expect(responseJson({ response: JSON.stringify(result) })).toEqual(result);
    expect(responseJson({ choices: [{ message: { content: JSON.stringify(result) } }] })).toEqual(result);
  });
  it("rejects inch amounts that are not in the data", () => {
    const allowed = [10, 15];
    expect(validatePick({ ...result, summary: "Alta has 15″ of new snow." }, ["alta", "solitude"], allowed).summary).toBe("Alta has 15″ of new snow.");
    expect(() => validatePick({ ...result, headline: "Alta: 40″ of powder" }, ["alta", "solitude"], allowed)).toThrow(/not in the data: 40/);
  });
  it("falls back once on invalid model output", async () => {
    const ai = { run: vi.fn().mockResolvedValueOnce({ response: "bad JSON" }).mockResolvedValueOnce({ response: result }) };
    expect((await askModel(ai, buildDigest(snapshot(), {}, now), null, "snow-report")).model).toBe(FALLBACK_MODEL);
    expect(ai.run.mock.calls.map((c) => c[0])).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
  });
  it("preserves last good recommendation when both models fail", async () => {
    const previous = { ...emptyState(now), current: pick() };
    const ai = { run: vi.fn().mockRejectedValue(new Error("upstream error")) };
    const plan = planRecommendation(previous, snapshot(), { AI: ai }, now, { force: true })!;
    expect(plan.state.calls.count).toBe(2);
    const next = await plan.run!();
    expect(next.current).toEqual(previous.current);
    expect(next.consecutiveFailures).toBe(1);
    expect(next.lastError).toContain("upstream error");
  });
  it("emits explicit no pick without spending tokens in preseason", () => {
    const ai = { run: vi.fn() };
    const plan = planRecommendation(undefined, snapshot(false), { AI: ai }, now)!;
    expect(plan.run).toBeUndefined();
    expect(plan.state.current).toMatchObject({ pick: null, model: null });
    expect(ai.run).not.toHaveBeenCalled();
  });
  it("stores fresh sources before awaiting AI and exposes the resulting recommendation", async () => {
    const kv = new MemoryKV();
    await writeSnapshot(kv, snapshot());
    const ai = { run: vi.fn(async () => {
      const during = (await readSnapshot(kv))!;
      expect(during.recommendation?.lastAttemptAt).toBe(now.toISOString());
      return { response: result };
    }) };
    await runCollection({ SNOW_KV: kv, AI: ai }, { now, sources: [], forceRecommendation: true });
    const report = buildReport(await readSnapshot(kv), now);
    expect(report.recommendation).toMatchObject({ pick: "alta", outdated: false, failing: false });
  });
  it("marks the previous day's target outdated at the afternoon rollover", () => {
    const state = { ...emptyState(now), current: pick(), consecutiveFailures: 3 };
    expect(publicRecommendation(state, new Date("2026-10-30T20:00:00Z"))).toMatchObject({ outdated: true, failing: true });
  });
});
