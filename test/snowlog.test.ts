import { describe, expect, it } from "vitest";
import { barLabel, buildSnowTimeline, timelineScale } from "@/components/timeline/model";
import { runCollection } from "@/lib/collect";
import { addDays, forecastForDay, morningOf, snowDayOf } from "@/lib/snowlog/days";
import { mergeSnowLog, recordSnowLog } from "@/lib/snowlog/record";
import type { SnowLogState } from "@/lib/snowlog/types";
import { mergeSnapshot, MemoryKV, readSnapshot } from "@/lib/store";
import type { Metric, NwsPayload, PrimaryResortId, ResortReport, Snapshot, SourceRecord } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

const HOUR = 3_600_000;
const inches = (value: number, label = "Last 24 hrs"): Metric => ({ state: "reported", value, unit: "in", label });

function resortRecord(id: PrimaryResortId, collectedAt: string, reportTime: string | null, h24: Metric): SourceRecord {
  const payload = { resort: id, reportTime, snowfall: { h24 } } as unknown as ResortReport;
  return { id, lastAttemptAt: collectedAt, lastSuccessfulFetchAt: collectedAt, sourceUpdatedAt: reportTime, status: "ok", lastError: null, lastErrorAt: null, consecutiveFailures: 0, diagnostics: null, payload };
}

function hourly(from: string, hours: number, snowIn = 0.1) {
  return Array.from({ length: hours }, (_, i) => ({ start: new Date(Date.parse(from) + i * HOUR).toISOString(), snowIn }));
}

function nwsRecord(collectedAt: string, lcc: Array<{ start: string; snowIn: number }>): SourceRecord {
  const point = (name: string) => ({ name, gridUpdatedAt: "2026-12-01T09:00:00Z", hourlySnow: lcc }) as unknown as NwsPayload["points"][number];
  const payload: NwsPayload = { points: [point("Alta / Snowbird (LCC)"), point("Brighton / Solitude (BCC)")] };
  return { id: "nws", lastAttemptAt: collectedAt, lastSuccessfulFetchAt: collectedAt, sourceUpdatedAt: null, status: "ok", lastError: null, lastErrorAt: null, consecutiveFailures: 0, diagnostics: null, payload };
}

const snap = (sources: Snapshot["sources"]): Snapshot => ({ schemaVersion: 1, writtenAt: "2026-12-01T13:00:00Z", sources });

describe("snow days", () => {
  it("end at 12:00 UTC, keyed by that morning", () => {
    expect(snowDayOf(Date.parse("2026-12-01T11:59:00Z"))).toBe("2026-12-01");
    expect(snowDayOf(Date.parse("2026-12-01T12:00:00Z"))).toBe("2026-12-02");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("read morning reports for five hours after a day ends, in winter and summer time", () => {
    // 5 AM MST (12:00Z) and 6 AM MDT (12:00Z) alike.
    expect(morningOf(Date.parse("2026-12-01T12:00:00Z"))).toBe("2026-12-01");
    expect(morningOf(Date.parse("2026-12-01T16:59:00Z"))).toBe("2026-12-01");
    expect(morningOf(Date.parse("2026-12-01T17:00:00Z"))).toBeNull();
    expect(morningOf(Date.parse("2026-12-01T11:59:00Z"))).toBeNull();
    expect(morningOf(Date.parse("2027-03-15T13:00:00Z"))).toBe("2027-03-15");
  });

  it("totals a forecast only over a fully covered day, from now when the day is under way", () => {
    const h = hourly("2026-11-30T12:00:00Z", 48);
    expect(forecastForDay(h, "2026-12-01")).toBe(2.4);
    expect(forecastForDay(h, "2026-12-01", Date.parse("2026-12-01T06:30:00Z"))).toBe(0.6);
    expect(forecastForDay(h.slice(0, 40), "2026-12-02")).toBeNull();
  });
});

describe("recordSnowLog", () => {
  it("records a morning's 24 h report and lets a later morning correction replace it", () => {
    let log = recordSnowLog(undefined, snap({ alta: resortRecord("alta", "2026-12-01T13:00:00Z", "2026-12-01T08:00:00Z", inches(5)) }), new Date("2026-12-01T13:00:00Z"));
    expect(log.resorts.alta?.["2026-12-01"]).toMatchObject({ state: "reported", valueIn: 5, label: "Last 24 hrs", windowEnd: "2026-12-01T08:00:00Z" });
    log = recordSnowLog(log, snap({ alta: resortRecord("alta", "2026-12-01T15:00:00Z", "2026-12-01T14:30:00Z", inches(6)) }), new Date("2026-12-01T15:00:00Z"));
    expect(log.resorts.alta?.["2026-12-01"]?.valueIn).toBe(6);
  });

  it("records nothing outside the morning window", () => {
    const log = recordSnowLog(undefined, snap({ alta: resortRecord("alta", "2026-12-01T20:00:00Z", "2026-12-01T19:00:00Z", inches(5)) }), new Date("2026-12-01T20:00:00Z"));
    expect(log.resorts.alta).toBeUndefined();
  });

  it("marks yesterday afternoon's report as no new report, so its snow isn't counted twice", () => {
    // 3 PM MST the day before: its 24 h window mostly covers the previous snow day.
    const log = recordSnowLog(undefined, snap({ alta: resortRecord("alta", "2026-12-01T13:00:00Z", "2026-11-30T22:00:00Z", inches(8)) }), new Date("2026-12-01T13:00:00Z"));
    expect(log.resorts.alta?.["2026-12-01"]).toMatchObject({ state: "no_report" });
    expect(log.resorts.alta?.["2026-12-01"]?.valueIn).toBeUndefined();
    // …and a fresh report later that morning replaces it, while a stale one never replaces a report.
    const fresh = recordSnowLog(log, snap({ alta: resortRecord("alta", "2026-12-01T14:00:00Z", "2026-12-01T13:50:00Z", inches(2)) }), new Date("2026-12-01T14:00:00Z"));
    expect(fresh.resorts.alta?.["2026-12-01"]).toMatchObject({ state: "reported", valueIn: 2 });
    const stale = recordSnowLog(fresh, snap({ alta: resortRecord("alta", "2026-12-01T14:05:00Z", "2026-11-30T22:00:00Z", inches(8)) }), new Date("2026-12-01T14:05:00Z"));
    expect(stale.resorts.alta?.["2026-12-01"]).toMatchObject({ state: "reported", valueIn: 2 });
  });

  it("treats Snowbird's 24 h as ending at fetch time, whatever its publish time", () => {
    const log = recordSnowLog(undefined, snap({ snowbird: resortRecord("snowbird", "2026-12-01T13:00:00Z", "2026-11-29T23:00:00Z", inches(0, "24 Hour")) }), new Date("2026-12-01T13:00:00Z"));
    expect(log.resorts.snowbird?.["2026-12-01"]).toMatchObject({ state: "reported", valueIn: 0, windowEnd: "2026-12-01T13:00:00Z" });
  });

  it("keeps the resort's not-reported and unavailable states", () => {
    const at = "2026-12-01T13:00:00Z";
    const log = recordSnowLog(undefined, snap({
      solitude: resortRecord("solitude", at, at, { state: "not_reported", label: "Last 24 hours" }),
      brighton: resortRecord("brighton", at, at, { state: "unavailable", label: "Snow 24 Hrs." }),
    }), new Date(at));
    expect(log.resorts.solitude?.["2026-12-01"]?.state).toBe("not_reported");
    expect(log.resorts.brighton?.["2026-12-01"]?.state).toBe("unavailable");
  });

  it("keeps each day's last NWS forecast from before the day began", () => {
    const evening = "2026-12-01T03:00:00Z"; // 8 PM MST Nov 30, during snow day Dec 1
    let log = recordSnowLog(undefined, snap({ nws: nwsRecord(evening, hourly("2026-12-01T03:00:00Z", 7 * 24, 0.25)) }), new Date(evening));
    // Dec 1 is under way, so only later days are recorded.
    expect(log.forecasts.LCC?.["2026-12-01"]).toBeUndefined();
    expect(log.forecasts.LCC?.["2026-12-02"]).toMatchObject({ snowIn: 6, issuedAt: "2026-12-01T09:00:00Z" });
    expect(log.forecasts.BCC?.["2026-12-02"]?.snowIn).toBe(6);
    // A newer forecast before Dec 2 begins replaces it; one after it begins doesn't.
    log = recordSnowLog(log, snap({ nws: nwsRecord("2026-12-01T11:45:00Z", hourly("2026-12-01T11:00:00Z", 7 * 24, 0.5)) }), new Date("2026-12-01T11:45:00Z"));
    expect(log.forecasts.LCC?.["2026-12-02"]?.snowIn).toBe(12);
    log = recordSnowLog(log, snap({ nws: nwsRecord("2026-12-01T13:00:00Z", hourly("2026-12-01T13:00:00Z", 6 * 24, 0)) }), new Date("2026-12-01T13:00:00Z"));
    expect(log.forecasts.LCC?.["2026-12-02"]?.snowIn).toBe(12);
  });

  it("drops days older than two weeks", () => {
    const previous: SnowLogState = { resorts: { alta: { "2026-11-10": { state: "reported", valueIn: 3, label: "x", windowEnd: null, collectedAt: "2026-11-10T13:00:00Z" }, "2026-11-25": { state: "reported", valueIn: 1, label: "x", windowEnd: null, collectedAt: "2026-11-25T13:00:00Z" } } }, forecasts: {} };
    const log = recordSnowLog(previous, snap({}), new Date("2026-12-01T20:00:00Z"));
    expect(Object.keys(log.resorts.alta!)).toEqual(["2026-11-25"]);
  });
});

describe("snapshot storage", () => {
  it("merges concurrent runs' logs day by day", () => {
    const reading = (state: "reported" | "no_report", collectedAt: string, valueIn?: number) => ({ state, valueIn, label: "x", windowEnd: null, collectedAt });
    const a: SnowLogState = { resorts: { alta: { "2026-12-01": reading("reported", "2026-12-01T13:00:00Z", 4), "2026-11-30": reading("reported", "2026-11-30T13:00:00Z", 1) } }, forecasts: {} };
    const b: SnowLogState = { resorts: { alta: { "2026-12-01": reading("no_report", "2026-12-01T14:00:00Z") }, snowbird: { "2026-12-01": reading("reported", "2026-12-01T14:00:00Z", 2) } }, forecasts: {} };
    const merged = mergeSnowLog(a, b)!;
    expect(merged.resorts.alta?.["2026-12-01"]?.valueIn).toBe(4);
    expect(merged.resorts.alta?.["2026-11-30"]?.valueIn).toBe(1);
    expect(merged.resorts.snowbird?.["2026-12-01"]?.valueIn).toBe(2);
    expect(mergeSnapshot({ ...snap({}), snowLog: a }, { ...snap({}), snowLog: b }).snowLog).toEqual(merged);
  });

  it("is written by collection and served by the report", async () => {
    const kv = new MemoryKV();
    await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl: createFixtureFetch().fetchImpl });
    const log = (await readSnapshot(kv))?.snowLog;
    // Outside a morning window: forecasts for the coming days, no resort readings yet.
    expect(Object.keys(log?.forecasts.LCC ?? {}).length).toBeGreaterThan(3);
    expect(log?.resorts).toEqual({});
  });
});

describe("timeline model", () => {
  const now = new Date("2026-11-02T03:00:00Z"); // 8 PM MST Nov 1, the evening DST ended
  const log: SnowLogState = {
    resorts: { alta: {
      "2026-11-01": { state: "reported", valueIn: 7, label: "Last 24 hrs", windowEnd: "2026-11-01T08:00:00Z", collectedAt: "2026-11-01T13:00:00Z" },
      "2026-10-31": { state: "no_report", label: "Last 24 hrs", windowEnd: "2026-10-30T22:00:00Z", collectedAt: "2026-10-31T13:00:00Z" },
    } },
    forecasts: { LCC: { "2026-11-01": { snowIn: 9.5, issuedAt: null, collectedAt: "2026-10-31T11:00:00Z" } } },
  };
  const model = buildSnowTimeline({
    resort: "alta", name: "Alta", canyon: "LCC", log, now,
    report: { reportTime: "2026-11-01T22:00:00Z", snowfall: { h24: inches(3) } } as unknown as ResortReport,
    forecast: { hourlySnow: hourly("2026-11-02T03:00:00Z", 6 * 24, 0.05) } as unknown as NwsPayload["points"][number],
  });

  it("lays out the 7 days before the current snow day and 7 from it, labeled by the morning they end", () => {
    expect(model.past.map((d) => d.key)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(model.future.map((d) => d.key)[0]).toBe("2026-11-02");
    expect(model.future).toHaveLength(7);
    expect(model.past.at(-1)).toMatchObject({ weekday: "Sun", dayOfMonth: "1", weekend: true, state: "reported", amountIn: 7, forecastIn: 9.5 });
    expect(model.past.at(-1)!.detail).toBe("Sun, Nov 1 · 7″ reported by Alta (“Last 24 hrs” at 1:00 AM) · NWS forecast 9.5″");
    expect(model.past.at(-2)).toMatchObject({ state: "no_report", amountIn: null });
    expect(model.past[0]).toMatchObject({ state: "not_recorded", amountIn: null });
  });

  it("names the day boundary in local time across the daylight-saving change", () => {
    // Nov 2's snow day ends at 5 AM MST; the evening before DST ended it would have been 6 AM.
    expect(model.future[0]).toMatchObject({ partial: true, state: "forecast", amountIn: 0.5 });
    expect(model.future[0].detail).toBe("Mon, Nov 2 · 0.5″ NWS forecast, now to 5 AM (LCC grid point)");
    expect(model.future[1].detail).toMatch(/1\.2″ NWS forecast, 24h to 5 AM/);
    // This forecast ends 6 days out, partway through the last day: no partial total.
    expect(model.future.at(-1)).toMatchObject({ state: "no_forecast", amountIn: null });
    expect(model.last24.detail).toBe("Last 24h · 3″ reported by Alta (“Last 24 hrs”, report 3:00 PM)");
  });

  it("shares one bar scale, between 6″ and 18″", () => {
    expect(timelineScale([model])).toBe(9.5);
    expect(timelineScale([{ ...model, past: [], future: [], last24: { ...model.last24, metric: inches(30) } }])).toBe(18);
    expect(timelineScale([{ ...model, past: [], future: [], last24: { ...model.last24, metric: inches(1) } }])).toBe(6);
  });

  it("labels bars in whole inches, keeping a trace apart from zero", () => {
    expect([0, 0.3, 0.99, 1.4, 12.6].map(barLabel)).toEqual(["0", "<1", "<1", "1", "13"]);
  });
});
