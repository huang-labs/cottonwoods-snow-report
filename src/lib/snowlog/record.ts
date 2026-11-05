import type { CanyonId, Metric, NwsPayload, PrimaryResortId, ResortReport, Snapshot } from "../types";
import { addDays, forecastForDay, liquidForDay, morningOf, snowDayOf, snowDayStart } from "./days";
import type { DayAheadForecast, MorningReading, SnowDayKey, SnowLogState } from "./types";

export const SNOW_LOG_RESORTS: PrimaryResortId[] = ["alta", "snowbird", "solitude", "brighton"];
export const RESORT_CANYON: Record<PrimaryResortId, CanyonId> = { alta: "LCC", snowbird: "LCC", solitude: "BCC", brighton: "BCC" };

/** Days kept, counting back from the current snow day. The homepage shows 7. */
export const SNOW_LOG_RETENTION_DAYS = 14;

/**
 * Snowbird computes its 24 h total from its report history at fetch time, so its
 * window ends when we fetch, not at its publish time (docs/IMPLEMENTATION_NOTES.md).
 */
const ROLLING_AT_FETCH = new Set<PrimaryResortId>(["snowbird"]);

/**
 * A morning's 24 h figure must end after ~8–9 PM the evening before (9 h before the
 * snow day ends). An older window is yesterday's report, and recording it again would
 * count the same snow twice. Alta and Brighton publish around 1 AM; Solitude near 7 AM.
 */
const MAX_WINDOW_LEAD_MS = 9 * 3_600_000;

/** Morning reports win over "no fresh report"; otherwise the later collection wins (corrections). */
export function preferReading(a: MorningReading | undefined, b: MorningReading | undefined): MorningReading | undefined {
  if (!a) return b;
  if (!b) return a;
  const rank = (r: MorningReading) => (r.state === "no_report" ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) > rank(b) ? a : b;
  return Date.parse(b.collectedAt) >= Date.parse(a.collectedAt) ? b : a;
}

/** Of two forecasts for one day, the later collection is closer to the day's start. */
export function preferForecast(a: DayAheadForecast | undefined, b: DayAheadForecast | undefined): DayAheadForecast | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.collectedAt) >= Date.parse(a.collectedAt) ? b : a;
}

function reading(id: PrimaryResortId, report: ResortReport, collectedAt: string, day: SnowDayKey): MorningReading {
  const m: Metric = report.snowfall.h24;
  const windowEnd = ROLLING_AT_FETCH.has(id) ? collectedAt : report.reportTime;
  const fresh = windowEnd !== null && Date.parse(windowEnd) >= Date.parse(`${day}T12:00:00Z`) - MAX_WINDOW_LEAD_MS;
  if (!fresh) return { state: "no_report", label: m.label, windowEnd, collectedAt };
  if (m.state === "reported") return { state: "reported", valueIn: m.value, label: m.label, windowEnd, collectedAt };
  return { state: m.state, label: m.label, windowEnd, collectedAt };
}

function canyonOf(name: string): CanyonId | null {
  return /\(LCC\)/.test(name) ? "LCC" : /\(BCC\)/.test(name) ? "BCC" : null;
}

function prune<T>(days: Record<SnowDayKey, T> | undefined, oldest: SnowDayKey): Record<SnowDayKey, T> {
  return Object.fromEntries(Object.entries(days ?? {}).filter(([k]) => k >= oldest));
}

/**
 * Advance the log from this run's snapshot. Resorts collected during a morning window
 * record that morning's 24 h figure; every NWS collection records its whole-day snow
 * and liquid totals for days that haven't begun yet, so the last one before a day
 * starts is what stays.
 * Pure: the caller stores the result in the snapshot.
 */
export function recordSnowLog(previous: SnowLogState | undefined, snapshot: Snapshot, now: Date): SnowLogState {
  const oldest = addDays(snowDayOf(now.getTime()), -SNOW_LOG_RETENTION_DAYS);
  const log: SnowLogState = { resorts: {}, forecasts: {} };
  for (const id of SNOW_LOG_RESORTS) {
    const days = prune(previous?.resorts[id], oldest);
    const rec = snapshot.sources[id];
    const report = rec?.payload as ResortReport | null | undefined;
    const collectedAt = rec?.lastSuccessfulFetchAt;
    const day = collectedAt ? morningOf(Date.parse(collectedAt)) : null;
    if (report && collectedAt && day) days[day] = preferReading(days[day], reading(id, report, collectedAt, day))!;
    if (Object.keys(days).length) log.resorts[id] = days;
  }
  const nws = snapshot.sources.nws;
  const payload = nws?.payload as NwsPayload | null | undefined;
  const collectedAt = nws?.lastSuccessfulFetchAt;
  for (const canyon of ["LCC", "BCC"] as CanyonId[]) {
    const days = prune(previous?.forecasts[canyon], oldest);
    const point = payload?.points.find((p) => canyonOf(p.name) === canyon);
    if (point?.hourlySnow && collectedAt) {
      const t = Date.parse(collectedAt);
      // Days that haven't started at collection time: whole-day forecasts only.
      for (let key = addDays(snowDayOf(t), 1); snowDayStart(key) - t < 8 * 86_400_000; key = addDays(key, 1)) {
        const snowIn = forecastForDay(point.hourlySnow, key);
        // An incomplete day (a missing hour, or the forecast's end) is skipped; later
        // complete days are still recorded.
        if (snowIn === null) continue;
        const liquidIn = point.hourlyLiquidIn ? liquidForDay(point.hourlySnow, point.hourlyLiquidIn, key) : null;
        days[key] = preferForecast(days[key], { snowIn, ...(liquidIn === null ? {} : { liquidIn }), issuedAt: point.gridUpdatedAt, collectedAt })!;
      }
    }
    if (Object.keys(days).length) log.forecasts[canyon] = days;
  }
  return log;
}

/**
 * Merge two runs' logs (see store.ts): each day keeps its preferred entry, and days
 * past retention at `now` are dropped. The stored log still holds days a run has just
 * pruned, so retention must apply here too or the union would restore them.
 */
export function mergeSnowLog(a: SnowLogState | undefined, b: SnowLogState | undefined, now: Date): SnowLogState | undefined {
  if (!a && !b) return undefined;
  const oldest = addDays(snowDayOf(now.getTime()), -SNOW_LOG_RETENTION_DAYS);
  const out: SnowLogState = { resorts: {}, forecasts: {} };
  for (const id of new Set([...Object.keys(a?.resorts ?? {}), ...Object.keys(b?.resorts ?? {})]) as Set<PrimaryResortId>) {
    const days = prune(a?.resorts[id], oldest);
    for (const [k, v] of Object.entries(prune(b?.resorts[id], oldest))) days[k] = preferReading(days[k], v)!;
    if (Object.keys(days).length) out.resorts[id] = days;
  }
  for (const c of new Set([...Object.keys(a?.forecasts ?? {}), ...Object.keys(b?.forecasts ?? {})]) as Set<CanyonId>) {
    const days = prune(a?.forecasts[c], oldest);
    for (const [k, v] of Object.entries(prune(b?.forecasts[c], oldest))) days[k] = preferForecast(days[k], v)!;
    if (Object.keys(days).length) out.forecasts[c] = days;
  }
  return out;
}
