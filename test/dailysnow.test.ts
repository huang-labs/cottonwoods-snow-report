import { beforeAll, describe, expect, it } from "vitest";
import { runCollection } from "@/lib/collect";
import { dailySnowFigureKey, dailySnowKey, emptyDailySnowState, planDailySnow } from "@/lib/dailysnow";
import { buildDailyDigest, phaseOf } from "@/lib/dailysnow/digest";
import { buildModelInput, DAILY_SNOW_TIMEOUT_MS, groundNumbers, ungroundedInches, validateDailySnow } from "@/lib/dailysnow/llm";
import { IN_FLIGHT_MS, MAX_ATTEMPTS, RETRY_AFTER_MS, shouldRunDailySnow } from "@/lib/dailysnow/schedule";
import { FALLBACK_MODEL, PRIMARY_MODEL } from "@/lib/recommend/llm";
import { buildReport, DAILY_SNOW_PUBLIC_POSTS } from "@/lib/report";
import { parseAfd } from "@/lib/sources/nwsafd";
import { MemoryKV, readSnapshot, writeSnapshot } from "@/lib/store";
import type { AfdPayload, DailySnowState, PlumePayload, ResortCamsPayload, Snapshot } from "@/lib/types";
import { createFixtureFetch, fixture } from "./fixtureFetch";

// Nov 1 2026 is the end of daylight saving time: 13:00 UTC is 6:00 AM MST.
const SIX_AM = new Date("2026-11-01T13:00:00Z");
const at = (iso: string) => new Date(iso);

let captured: Snapshot;
beforeAll(async () => {
  const kv = new MemoryKV();
  await runCollection({ SNOW_KV: kv }, { now: SIX_AM, fetchImpl: createFixtureFetch().fetchImpl });
  captured = (await readSnapshot(kv))!;
});
const snap = () => structuredClone(captured);

/** A model answer that uses two figures and only amounts present in the fixture data. */
function answer(digestFigures: string[], extra: Record<string, unknown> = {}) {
  return {
    title: "Storm Underway",
    summary: "The main surge is here today with snow above 8,000 feet. Snow levels fall tonight and we clear out Monday.",
    sections: [
      {
        id: "update",
        paragraphs: [
          { text: "Snow is falling at the upper elevations of the Cottonwoods this morning:", figure: digestFigures[0] ?? "none" },
          { text: "Snow levels drop through tonight:", figure: digestFigures[1] ?? "none" },
        ],
      },
      { id: "extended", paragraphs: [{ text: "A weaker system arrives Wednesday into Thursday.", figure: "none" }] },
    ],
    ...extra,
  };
}

function fakeAi(respond: (model: string, input: Record<string, unknown>) => unknown) {
  const calls: Array<{ model: string; schema: string }> = [];
  return {
    calls,
    ai: {
      async run(model: string, input: Record<string, unknown>) {
        const schema = (input.response_format as { json_schema: { name: string } }).json_schema.name;
        calls.push({ model, schema });
        if (schema !== "daily_snow") throw new Error("resort pick not under test");
        return { response: JSON.stringify(respond(model, input)) };
      },
    },
  };
}

describe("NWS forecast discussion", () => {
  it("keeps forecast sections and drops aviation and hydrology", () => {
    const sections = parseAfd((JSON.parse(fixture("nws-afd-SLC.json")) as { productText: string }).productText);
    expect(sections.map((s) => s.name)).toEqual(["KEY MESSAGES", "DISCUSSION", "WATCHES/WARNINGS/ADVISORIES"]);
    expect(sections[0].text).toContain("Upper elevations of the Cottonwoods and western Uintas may see localized accumulations 18-24\".");
    // Wrapped 70-column lines are joined.
    expect(sections[1].text).not.toMatch(/\w\n\w/);
    expect(sections.every((s) => s.issued === undefined)).toBe(true);
  });
  it("reads updated products whose headers carry the original issuance (2026-11-02 5:13 AM update)", () => {
    const sections = parseAfd((JSON.parse(fixture("nws-afd-SLC-update.json")) as { productText: string }).productText);
    expect(sections.map((s) => s.name)).toEqual(["KEY MESSAGES", "DISCUSSION", "WATCHES/WARNINGS/ADVISORIES"]);
    expect(sections[0].issued).toBe("1037 PM MST Sun Nov 1 2026");
    expect(sections[1].issued).toBe("1037 PM MST Sun Nov 1 2026");
    expect(sections[1].text).toMatch(/^Currently, a mid-level trough/);
    // The next header ends the section rather than being swallowed into it.
    expect(sections[1].text).not.toContain("AVIATION");
  });
  it("is collected with the other sources and reused while the product is unchanged", async () => {
    const afd = captured.sources.nwsafd!;
    expect(afd.status).toBe("ok");
    expect((afd.payload as AfdPayload).issuedAt).toBe("2026-11-01T16:34:00.000Z");
    const kv = new MemoryKV();
    await writeSnapshot(kv, captured);
    const { fetchImpl, calls } = createFixtureFetch();
    await runCollection({ SNOW_KV: kv }, { now: SIX_AM, fetchImpl, only: ["nwsafd"] });
    expect(calls.filter((u) => u.includes("/products/"))).toEqual(["https://api.weather.gov/products/types/AFD/locations/SLC"]);
  });
});

describe("digest", () => {
  it("decides the storm phase in code", () => {
    expect(phaseOf(0, 0, 5, 12).phase).toBe("storm");
    expect(phaseOf(3, 3, 2, 4).phase).toBe("storm");
    expect(phaseOf(1, 8, 0, 0).phase).toBe("post-storm");
    expect(phaseOf(0, 0, 1, 6).phase).toBe("pre-storm");
    expect(phaseOf(0, 0, 0, 1).phase).toBe("quiet");
  });
  it("computes totals, figures and recent-post context from the sources", () => {
    const s = snap();
    // Make the Snowbird stake still this morning's.
    const cams = s.sources.resortcams!.payload as ResortCamsPayload;
    for (const c of cams.cameras) if (c.kind === "image") c.capturedAt = "2026-11-01T12:55:00.000Z";
    const history = [{ date: "2026-10-31", title: "Storm Arrives", phase: "pre-storm" as const, forecast: [{ canyon: "LCC" as const, next24In: 10, next72In: 16, stormIn: 17 }] }];
    const { digest, numbers, figures, worthPosting } = buildDailyDigest(s, null, history, SIX_AM);
    expect(digest.date).toBe("2026-11-01");
    expect(digest.weekday).toBe("Sunday");
    expect(digest.phase).toBe("storm");
    expect(numbers.canyons.map((c) => c.canyon)).toEqual(["LCC", "BCC"]);
    expect(numbers.canyons[0].next7dIn).toBeGreaterThanOrEqual(numbers.canyons[0].next72In!);
    expect(digest.discussion?.sections[0].name).toBe("KEY MESSAGES");
    expect(digest.recentPosts[0].forecast[0]).toBe("LCC: next 24 h 10″, next 72 h 16″, next storm 17″");
    const ids = figures.map((f) => f.figure.id);
    expect(ids).toEqual(expect.arrayContaining(["nws-snow-lcc", "nws-snow-bcc", "nws-snow-level", "plume-snow-cln", "plume-slr-pkcu1", "stake-alta", "stake-snowbird"]));
    // Captions come from code; the model is told it cannot see images.
    expect(digest.figures.find((f) => f.id === "stake-snowbird")?.shows).toMatch(/cannot see/);
    expect(worthPosting).toBe(true);
  });
  it("leaves out stake cams that are not this morning's", () => {
    const ids = buildDailyDigest(snap(), null, [], SIX_AM).figures.map((f) => f.figure.id);
    expect(ids.some((id) => id.startsWith("stake-"))).toBe(false);
  });
});

describe("schedule", () => {
  const posted = (date: string): DailySnowState => ({ ...emptyDailySnowState(), current: { date } as DailySnowState["current"] });
  it("posts from 6 AM Denver time, across the daylight-saving change", () => {
    expect(shouldRunDailySnow(undefined, at("2026-11-01T12:55:00Z"))).toBeNull(); // 5:55 AM MST
    // 12:00 UTC was 6 AM yesterday (MDT) but is 5 AM today (MST).
    expect(shouldRunDailySnow(undefined, at("2026-11-01T12:00:00Z"))).toBeNull();
    expect(shouldRunDailySnow(undefined, SIX_AM)).toBe("morning");
    expect(shouldRunDailySnow(undefined, at("2026-07-01T12:00:00Z"))).toBe("morning"); // 6 AM MDT
    expect(shouldRunDailySnow(undefined, at("2026-11-01T17:00:00Z"))).toBeNull(); // 10 AM: too late
  });
  it("posts once a day", () => {
    expect(shouldRunDailySnow(posted("2026-11-01"), at("2026-11-01T14:00:00Z"))).toBeNull();
    expect(shouldRunDailySnow(posted("2026-10-31"), at("2026-11-01T14:00:00Z"))).toBe("morning");
  });
  it("allows slow generations within the cron wall-time limit", () => {
    // GLM took 128 s for a valid post on 2026-11-02; the old 120 s limit discarded it.
    expect(DAILY_SNOW_TIMEOUT_MS).toBe(5 * 60_000);
    expect(IN_FLIGHT_MS).toBeGreaterThan(2 * DAILY_SNOW_TIMEOUT_MS);
    expect(IN_FLIGHT_MS).toBeLessThanOrEqual(15 * 60_000);
  });
  it("does not start a second attempt while one is running", () => {
    const running: DailySnowState = { ...emptyDailySnowState(), lastAttemptAt: SIX_AM.toISOString(), attempts: { date: "2026-11-01", count: 1, calls: 2 } };
    expect(shouldRunDailySnow(running, at("2026-11-01T13:05:00Z"))).toBeNull();
    // Two 5-minute model timeouts: later crons still see the attempt as running.
    expect(shouldRunDailySnow(running, at("2026-11-01T13:10:00Z"))).toBeNull();
    // Cut off without finishing: tried again once the in-flight window has passed.
    expect(shouldRunDailySnow(running, new Date(SIX_AM.getTime() + IN_FLIGHT_MS))).toBe("morning");
  });
  it("retries failures after 10 minutes, a few times a day", () => {
    const failed: DailySnowState = { ...emptyDailySnowState(), lastAttemptAt: SIX_AM.toISOString(), lastFinishedAt: "2026-11-01T13:01:00.000Z", lastError: "timeout", consecutiveFailures: 1, attempts: { date: "2026-11-01", count: 1, calls: 2 } };
    expect(shouldRunDailySnow(failed, at("2026-11-01T13:05:00Z"))).toBeNull();
    expect(shouldRunDailySnow(failed, new Date(SIX_AM.getTime() + RETRY_AFTER_MS))).toBe("retry");
    expect(shouldRunDailySnow({ ...failed, attempts: { date: "2026-11-01", count: MAX_ATTEMPTS, calls: 6 } }, at("2026-11-01T14:00:00Z"))).toBeNull();
    // The count resets the next day.
    expect(shouldRunDailySnow({ ...failed, attempts: { date: "2026-10-31", count: MAX_ATTEMPTS, calls: 6 } }, SIX_AM)).toBe("morning");
  });
});

describe("validation", () => {
  const { digest } = buildDailyDigest(structuredClone({ schemaVersion: 1, writtenAt: "", sources: {} }) as Snapshot, null, [], SIX_AM);
  const withData = () => buildDailyDigest(snap(), null, [], SIX_AM).digest;
  it("flags inch amounts that appear nowhere in the data", () => {
    expect(ungroundedInches("We got 12″ and 3-6\" lower down, 0.5″ of water.", [12, 3, 6, 0.5])).toEqual([]);
    expect(ungroundedInches("Up to 30″ fell", [12, 17.1])).toEqual([30]);
    expect(ungroundedInches("Totals of 17 inches", [17.1])).toEqual([]);
    // Plain "in" as the unit (gpt-oss writes "8 in (10 in in 48 h)").
    expect(ungroundedInches("Snowbird 8 in (25 in in 48 h), 3–40 in by Monday", [8, 10, 3])).toEqual([25, 40]);
    expect(ungroundedInches("Around 4 in the morning, 2 in a row", [])).toEqual([]);
    expect(groundNumbers(digest)).toContain(2026);
  });
  it("accepts a well-formed post and drops unknown, repeated or misplaced parts", () => {
    const d = withData();
    const r = validateDailySnow(
      answer(["nws-snow-lcc", "nws-snow-lcc"], {
        sections: [
          { id: "extended", paragraphs: [{ text: "Misplaced first.", figure: "none" }] },
          { id: "update", paragraphs: [{ text: "Snow up high:", figure: "nws-snow-lcc" }, { text: "Again:", figure: "nws-snow-lcc" }, { text: "Unknown:", figure: "radar" }] },
        ],
      }),
      d,
    );
    expect(r.sections.map((s) => s.id)).toEqual(["update"]);
    expect(r.sections[0].paragraphs.map((p) => p.figure)).toEqual(["nws-snow-lcc", null, null]);
  });
  it("rejects invented amounts and thin posts", () => {
    const d = withData();
    expect(() => validateDailySnow(answer([], { summary: "A whopping 45″ fell overnight." }), d)).toThrow(/not in the data: 45/);
    expect(() => validateDailySnow(answer([], { title: "" }), d)).toThrow(/no title or summary/);
    expect(() => validateDailySnow(answer([], { sections: [] }), d)).toThrow(/sections/);
  });
  it("clips over-long paragraphs at a sentence boundary and keeps the figure", () => {
    const d = withData();
    const text = `${"b".repeat(500)}. Middle sentence one. Middle sentence two. ${"c".repeat(500)}`;
    const raw = answer([], { sections: [{ id: "update", paragraphs: [{ text, figure: "plume-snow-cln" }] }] });
    const r = validateDailySnow(raw, d);
    expect(r.sections[0].paragraphs[0]).toEqual({
      // 1044 characters in; the clip ends after the last sentence that keeps
      // most of the 800-character budget, without an ellipsis.
      text: `${"b".repeat(500)}. Middle sentence one. Middle sentence two.`,
      figure: "plume-snow-cln",
    });
  });
  it.each([['update', 'short-term'], ['short-term', 'update']])("preserves the outlook and plume when %s is followed by %s", (first, second) => {
    const d = withData();
    const raw = answer([], { sections: [
      { id: first, paragraphs: [{ text: "Reported snowfall:", figure: "resort-totals" }] },
      { id: second, paragraphs: [{ text: "The next system:", figure: "nws-snow-lcc" }, { text: "University of Utah ensemble guidance:", figure: "plume-snow-cln" }] },
    ] });
    const validated = validateDailySnow(raw, d);
    expect(validated.sections).toEqual([{ id: first, paragraphs: [
      { text: "Reported snowfall:", figure: "resort-totals" },
      { text: "The next system:", figure: "nws-snow-lcc" },
      { text: "University of Utah ensemble guidance:", figure: "plume-snow-cln" },
    ] }]);
    // Recovered paragraphs still undergo the same amount validation.
    raw.sections[1].paragraphs[0].text = "Expect 999″ tomorrow.";
    expect(() => validateDailySnow(raw, d)).toThrow(/not in the data: 999/);
  });
  it("constrains figures to the available ids in the schema", () => {
    const d = withData();
    const input = buildModelInput(PRIMARY_MODEL, d) as { response_format: { json_schema: { schema: { properties: { sections: { items: { properties: { paragraphs: { items: { properties: { figure: { enum: string[] } } } } } } } } } } } };
    const figureEnum = input.response_format.json_schema.schema.properties.sections.items.properties.paragraphs.items.properties.figure.enum;
    expect(figureEnum).toEqual([...d.figures.map((f) => f.id), "none"]);
  });
});

describe("posting", () => {
  async function seeded() {
    const kv = new MemoryKV();
    await writeSnapshot(kv, captured);
    await kv.put("plume-panel:v1:CLN:2026103012:snow", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer as ArrayBuffer);
    return kv;
  }
  it("writes the post, archives it with its figures, and does not post twice", async () => {
    const kv = await seeded();
    const { ai, calls } = fakeAi(() => answer(["plume-snow-cln", "nws-snow-level"]));
    const env = { SNOW_KV: kv, AI: ai };
    const summary = await runCollection(env, { now: SIX_AM, sources: [] });
    expect(summary.dailySnow).toMatchObject({ date: "2026-11-01", model: PRIMARY_MODEL, trigger: "morning", error: null, fallbackReason: null });
    const state = (await readSnapshot(kv))!.dailySnow!;
    const post = state.current!;
    expect(post.title).toBe("Storm Underway");
    expect(post).not.toHaveProperty("fallbackReason");
    expect(post.phase).toBe("storm");
    expect(post.figures["plume-snow-cln"]).toMatchObject({ kind: "image", url: "/api/daily-snow/figure/2026-11-01/plume-snow-cln" });
    // The time axis is frozen with the still so the post keeps the run it was written about.
    const plumes = captured.sources.plumes!.payload as PlumePayload;
    const cln = plumes.charts.find((c) => c.stationCode === "CLN")!;
    expect(post.figures["plume-snow-cln"]).toMatchObject({
      axis: { plot: cln.panels!.find((p) => p.id === "snow")!.plot, initTime: cln.initTime, forecastHours: cln.forecastHours },
    });
    expect(post.figures["nws-snow-level"].kind).toBe("snow-level");
    expect(await kv.get(dailySnowFigureKey("2026-11-01", "plume-snow-cln"), "arrayBuffer")).not.toBeNull();
    expect(JSON.parse((await kv.get(dailySnowKey("2026-11-01"), "text"))!).title).toBe("Storm Underway");
    expect(state.history[0]).toMatchObject({ date: "2026-11-01", title: "Storm Underway" });
    expect(state.attempts).toEqual({ date: "2026-11-01", count: 1, calls: 2 });

    const report = buildReport(await readSnapshot(kv), at("2026-11-01T15:00:00Z"));
    expect(report.dailySnow).toMatchObject({ title: "Storm Underway", outdated: false, failing: false, archive: [{ date: "2026-11-01", title: "Storm Underway" }] });
    expect(buildReport(await readSnapshot(kv), at("2026-11-02T15:00:00Z")).dailySnow?.outdated).toBe(true);

    const n = calls.filter((c) => c.schema === "daily_snow").length;
    await runCollection(env, { now: at("2026-11-01T13:05:00Z"), sources: [] });
    expect(calls.filter((c) => c.schema === "daily_snow")).toHaveLength(n);
  });
  it("archives posts and stills without expiry and keeps the snapshot index to the public window", async () => {
    const kv = await seeded();
    const options: unknown[] = [];
    const put = kv.put.bind(kv);
    kv.put = async (key: string, value: string | ArrayBuffer, opts?: unknown) => {
      if (key.startsWith("dailysnow")) options.push(opts);
      return put(key, value);
    };
    // A full index of earlier posts: the new post pushes the oldest out of the snapshot (not out of KV).
    const snapshot = (await readSnapshot(kv))!;
    const history = Array.from({ length: DAILY_SNOW_PUBLIC_POSTS }, (_, i) => ({ date: `2026-10-${String(31 - i).padStart(2, "0")}`, title: "Earlier", phase: "quiet" as const, forecast: [] }));
    await writeSnapshot(kv, { ...snapshot, dailySnow: { ...emptyDailySnowState(), history } });
    const { ai } = fakeAi(() => answer(["plume-snow-cln"]));
    await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    expect(options.length).toBeGreaterThanOrEqual(2); // the post and its plume still
    expect(options.every((o) => o === undefined)).toBe(true);
    const state = (await readSnapshot(kv))!.dailySnow!;
    expect(state.history).toHaveLength(DAILY_SNOW_PUBLIC_POSTS);
    expect(state.history.map((h) => h.date).slice(0, 2)).toEqual(["2026-11-01", "2026-10-31"]);
  });
  it("drops figures whose still cannot be stored", async () => {
    const kv = new MemoryKV(); // no plume panel stored
    await writeSnapshot(kv, captured);
    const { ai } = fakeAi(() => answer(["plume-snow-cln", "nws-snow-lcc"]));
    await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    const post = (await readSnapshot(kv))!.dailySnow!.current!;
    expect(post.figures["plume-snow-cln"]).toBeUndefined();
    expect(post.sections[0].paragraphs.map((p) => p.figure)).toEqual([null, "nws-snow-lcc"]);
  });
  it("adds a frozen snow plume when the model omits it, without adding model prose or calls", async () => {
    const kv = await seeded();
    const { ai, calls } = fakeAi(() => answer(["resort-totals", "nws-snow-level"]));
    await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    const post = (await readSnapshot(kv))!.dailySnow!.current!;
    expect(Object.keys(post.figures)).toEqual(expect.arrayContaining(["resort-totals", "nws-snow-level", "plume-snow-cln"]));
    expect(post.sections[0].paragraphs.map((p) => p.figure)).toEqual(["resort-totals", "nws-snow-level"]);
    expect(post.figures["plume-snow-cln"]).toMatchObject({ axis: { forecastHours: 240 } });
    expect(JSON.parse((await kv.get(dailySnowKey("2026-11-01"), "text"))!).figures).toEqual(post.figures);
    expect(calls.filter((c) => c.schema === "daily_snow")).toHaveLength(1);
  });
  it("uses another snow plume if the preferred still is missing", async () => {
    const kv = new MemoryKV();
    await writeSnapshot(kv, captured);
    const candidate = buildDailyDigest(captured, null, [], SIX_AM).figures.find((c) => c.figure.id === "plume-snow-pkcu1")!;
    if (candidate.source?.kind !== "kv") throw new Error("expected stored plume");
    await kv.put(candidate.source.key, new Uint8Array([1, 2, 3]).buffer);
    const { ai } = fakeAi(() => answer(["plume-snow-cln", "nws-snow-level"]));
    await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    const post = (await readSnapshot(kv))!.dailySnow!.current!;
    expect(post.figures["plume-snow-cln"]).toBeUndefined();
    expect(post.figures["plume-snow-pkcu1"]).toBeDefined();
    expect(post.sections[0].paragraphs[0].figure).toBeNull();
  });
  it("publishes normally when the plume source is unavailable", async () => {
    const kv = new MemoryKV();
    const snapshot = snap();
    delete snapshot.sources.plumes;
    await writeSnapshot(kv, snapshot);
    const { ai } = fakeAi(() => answer(["resort-totals", "nws-snow-level"]));
    const result = await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    expect(result.dailySnow?.error).toBeNull();
    expect(Object.keys((await readSnapshot(kv))!.dailySnow!.current!.figures)).toEqual(["nws-snow-level", "resort-totals"]);
  });
  it("reserves a slot for the required snow plume when six optional figures were selected", async () => {
    const kv = await seeded();
    const candidates = buildDailyDigest(captured, null, [], SIX_AM).figures;
    const ids = ["resort-totals", "nws-snow-level", "nws-snow-lcc", "nws-snow-bcc", "plume-slr-cln", "plume-slr-pkcu1"];
    for (const c of candidates.filter((c) => ids.includes(c.figure.id))) {
      if (c.source?.kind === "kv") await kv.put(c.source.key, new Uint8Array([1, 2, 3]).buffer);
    }
    const { ai } = fakeAi(() => answer([], { sections: [{ id: "update", paragraphs: ids.map((figure) => ({ text: "Forecast guidance:", figure })) }] }));
    await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    const post = (await readSnapshot(kv))!.dailySnow!.current!;
    expect(Object.keys(post.figures)).toHaveLength(6);
    expect(post.figures["plume-snow-cln"]).toBeDefined();
    expect(post.figures["plume-slr-pkcu1"]).toBeUndefined();
    expect(post.sections[0].paragraphs.at(-1)?.figure).toBeNull();
  });
  it("falls back to the second model, then keeps yesterday's post when both fail", async () => {
    const kv = await seeded();
    const { ai } = fakeAi((model) => (model === PRIMARY_MODEL ? { title: "" } : answer([])));
    const fellBack = await runCollection({ SNOW_KV: kv, AI: ai }, { now: SIX_AM, sources: [] });
    const fallbackPost = (await readSnapshot(kv))!.dailySnow!.current!;
    expect(fallbackPost.model).toBe(FALLBACK_MODEL);
    expect(fallbackPost.fallbackReason).toBe(`${PRIMARY_MODEL}: Model output has no title or summary`);
    expect(fellBack.dailySnow?.fallbackReason).toBe(fallbackPost.fallbackReason);

    const yesterday = (await readSnapshot(kv))!;
    yesterday.dailySnow!.current!.date = "2026-10-31";
    await writeSnapshot(kv, yesterday);
    const failing = fakeAi(() => ({ nonsense: true }));
    const summary = await runCollection({ SNOW_KV: kv, AI: failing.ai }, { now: at("2026-11-02T13:00:00Z"), sources: [] });
    expect(summary.dailySnow?.error).toMatch(/no title or summary/);
    const state = (await readSnapshot(kv))!.dailySnow!;
    expect(state.current!.date).toBe("2026-10-31");
    expect(state.consecutiveFailures).toBe(1);
  });
  it("skips the off-season and needs the AI binding", () => {
    const s = snap();
    for (const p of (s.sources.nws!.payload as { points: Array<{ sixHourSnow: unknown[] }> }).points) p.sixHourSnow = [];
    for (const id of ["alta", "snowbird", "solitude", "brighton"] as const) s.sources[id] = undefined;
    const { ai } = fakeAi(() => answer([]));
    expect(planDailySnow(undefined, s, { SNOW_KV: new MemoryKV(), AI: ai }, SIX_AM)).toMatchObject({ skipped: "off-season" });
    expect(planDailySnow(undefined, s, { SNOW_KV: new MemoryKV() }, SIX_AM)).toBeUndefined();
  });
});
