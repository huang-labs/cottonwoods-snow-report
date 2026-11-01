import { denverParts, denverToUtc } from "../time";
import type { ForecastBlock, NextStorm, NwsPayload, PointForecast, SixHourSnow } from "../types";
import { assertValid, HOUR, MINUTE, type SourceDefinition } from "./types";

/** Gridpoints resolved from api.weather.gov/points for each resort area (2026-10-30). */
export const NWS_POINTS = [
  { name: "Alta / Snowbird (LCC)", gridId: "SLC", gridX: 108, gridY: 167 },
  { name: "Brighton / Solitude (BCC)", gridId: "SLC", gridX: 110, gridY: 168 },
] as const;

const gridUrl = (p: { gridId: string; gridX: number; gridY: number }) =>
  `https://api.weather.gov/gridpoints/${p.gridId}/${p.gridX},${p.gridY}`;

interface Series {
  uom?: string;
  values: Array<{ validTime: string; value: number | null }>;
}

interface GridData {
  properties: {
    updateTime?: string;
    elevation?: { value: number | null; unitCode?: string };
    temperature?: Series;
    windSpeed?: Series;
    windGust?: Series;
    snowfallAmount?: Series;
    snowLevel?: Series;
    probabilityOfPrecipitation?: Series;
    quantitativePrecipitation?: Series;
  };
}

interface TextForecast {
  properties: { periods: Array<{ name: string; detailedForecast: string; startTime: string }> };
}

/** Parse ISO 8601 duration (subset used by NWS: PnDTnHnM). */
export function durationHours(d: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(d);
  if (!m) return 1;
  return (+(m[1] ?? 0)) * 24 + +(m[2] ?? 0) + +(m[3] ?? 0) / 60;
}

type Kind = "level" | "accum";

/**
 * Expand an NWS series to an hourly map (epoch-hour → value). "level" values
 * apply to every hour of the interval; "accum" values are spread evenly.
 */
export function expandHourly(series: Series | undefined, kind: Kind, convert: (v: number) => number): Map<number, number> {
  const out = new Map<number, number>();
  for (const v of series?.values ?? []) {
    if (v.value === null) continue;
    const [start, dur] = v.validTime.split("/");
    const t0 = Date.parse(start);
    const hours = Math.max(1, Math.round(durationHours(dur)));
    const value = convert(v.value);
    for (let h = 0; h < hours; h++) {
      out.set(t0 + h * HOUR, kind === "accum" ? value / hours : value);
    }
  }
  return out;
}

const mmToIn = (v: number) => v / 25.4;
const mToFt = (v: number) => v * 3.28084;
const kmhToMph = (v: number) => v / 1.609344;
const cToF = (v: number) => v * 1.8 + 32;
const ident = (v: number) => v;

function convertWith(uom: string | undefined, fallback: (v: number) => number) {
  switch (uom) {
    case "wmoUnit:mm":
      return mmToIn;
    case "wmoUnit:m":
      return mToFt;
    case "wmoUnit:km_h-1":
      return kmhToMph;
    case "wmoUnit:degC":
      return cToF;
    case "wmoUnit:percent":
      return ident;
    default:
      return fallback;
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function hoursIn(map: Map<number, number>, start: number, end: number): number[] {
  const vals: number[] = [];
  for (let t = start; t < end; t += HOUR) {
    const v = map.get(t);
    if (v !== undefined) vals.push(v);
  }
  return vals;
}

const sum = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) : null);
const min = (a: number[]) => (a.length ? Math.min(...a) : null);
const max = (a: number[]) => (a.length ? Math.max(...a) : null);

const blockFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });

/** Start of the Denver 6 AM / 6 PM block containing `now`. */
export function currentBlockStart(now: Date): Date {
  const p = denverParts(now);
  if (p.hour >= 18) return denverToUtc(p.year, p.month, p.day, 18);
  if (p.hour >= 6) return denverToUtc(p.year, p.month, p.day, 6);
  const prev = denverParts(new Date(now.getTime() - 12 * HOUR));
  return denverToUtc(prev.year, prev.month, prev.day, 18);
}

export function summarizeGrid(grid: GridData, now: Date, blockCount = 6): Omit<PointForecast, "name" | "gridId" | "gridX" | "gridY" | "periods"> {
  const p = grid.properties;
  assertValid(p && p.snowfallAmount && p.temperature, "NWS gridpoint data missing snowfall/temperature");
  const snow = expandHourly(p.snowfallAmount, "accum", convertWith(p.snowfallAmount.uom, mmToIn));
  const qpf = expandHourly(p.quantitativePrecipitation, "accum", convertWith(p.quantitativePrecipitation?.uom, mmToIn));
  const snowLevel = expandHourly(p.snowLevel, "level", convertWith(p.snowLevel?.uom, mToFt));
  const temp = expandHourly(p.temperature, "level", convertWith(p.temperature.uom, cToF));
  const wind = expandHourly(p.windSpeed, "level", convertWith(p.windSpeed?.uom, kmhToMph));
  const gust = expandHourly(p.windGust, "level", convertWith(p.windGust?.uom, kmhToMph));
  const pop = expandHourly(p.probabilityOfPrecipitation, "level", ident);

  // Day/night blocks (6 AM–6 PM, 6 PM–6 AM Denver). DST-safe: compute each boundary.
  const blocks: ForecastBlock[] = [];
  let start = currentBlockStart(now);
  for (let i = 0; i < blockCount; i++) {
    const sp = denverParts(start);
    const day = sp.hour === 6;
    const next = new Date(start.getTime() + 12 * HOUR);
    const np = denverParts(next);
    const end = denverToUtc(np.year, np.month, np.day, day ? 18 : 6);
    const s = start.getTime();
    const e = end.getTime();
    const snowVals = hoursIn(snow, s, e);
    const qpfVals = hoursIn(qpf, s, e);
    const sl = hoursIn(snowLevel, s, e);
    const tv = hoursIn(temp, s, e);
    blocks.push({
      start: start.toISOString(),
      end: end.toISOString(),
      label: `${blockFmt.format(start)} ${day ? "day" : "night"}`,
      snowIn: snowVals.length ? round1(sum(snowVals)!) : null,
      qpfIn: qpfVals.length ? Math.round(sum(qpfVals)! * 100) / 100 : null,
      snowLevelMinFt: sl.length ? Math.round(min(sl)! / 100) * 100 : null,
      snowLevelMaxFt: sl.length ? Math.round(max(sl)! / 100) * 100 : null,
      tempMinF: tv.length ? Math.round(min(tv)!) : null,
      tempMaxF: tv.length ? Math.round(max(tv)!) : null,
      windMaxMph: hoursIn(wind, s, e).length ? Math.round(max(hoursIn(wind, s, e))!) : null,
      gustMaxMph: hoursIn(gust, s, e).length ? Math.round(max(hoursIn(gust, s, e))!) : null,
      popMax: hoursIn(pop, s, e).length ? Math.round(max(hoursIn(pop, s, e))!) : null,
    });
    start = end;
  }

  // 6-hour snow bars, aligned to UTC synoptic hours for the next 7 days.
  const sixHourSnow: SixHourSnow[] = [];
  const t0 = Math.floor(now.getTime() / (6 * HOUR)) * 6 * HOUR;
  for (let t = t0; t < t0 + 7 * 24 * HOUR; t += 6 * HOUR) {
    const vals = hoursIn(snow, t, t + 6 * HOUR);
    if (!vals.length) continue;
    const sl = hoursIn(snowLevel, t, t + 6 * HOUR);
    sixHourSnow.push({ start: new Date(t).toISOString(), snowIn: round1(sum(vals)!), snowLevelFt: sl.length ? Math.round(min(sl)!) : null });
  }

  return {
    elevationFt: p.elevation?.value != null ? Math.round(mToFt(p.elevation.value)) : null,
    gridUpdatedAt: p.updateTime ? new Date(p.updateTime).toISOString() : null,
    blocks,
    sixHourSnow,
    nextStorm: findNextStorm(snow, snowLevel, now),
  };
}

/**
 * First forecast snow episode with ≥1" total. Hours with snow separated by
 * <12 dry hours belong to the same episode. Totals are NWS grid values.
 */
export function findNextStorm(snow: Map<number, number>, snowLevel: Map<number, number>, now: Date): NextStorm | null {
  const startHour = Math.floor(now.getTime() / HOUR) * HOUR;
  const hours = [...snow.keys()].filter((t) => t >= startHour).sort((a, b) => a - b);
  let ep: { start: number; end: number; total: number; minSl: number | null } | null = null;
  for (const t of hours) {
    const v = snow.get(t)!;
    if (v < 0.005) continue;
    if (ep && t - ep.end > 12 * HOUR) {
      if (ep.total >= 1) break;
      ep = null;
    }
    const sl = snowLevel.get(t);
    if (!ep) ep = { start: t, end: t, total: 0, minSl: null };
    ep.end = t;
    ep.total += v;
    if (sl !== undefined) ep.minSl = ep.minSl === null ? sl : Math.min(ep.minSl, sl);
  }
  if (!ep || ep.total < 1) return null;
  return {
    start: new Date(ep.start).toISOString(),
    end: new Date(ep.end + HOUR).toISOString(),
    totalSnowIn: round1(ep.total),
    minSnowLevelFt: ep.minSl === null ? null : Math.round(ep.minSl / 100) * 100,
  };
}

export const nwsSource: SourceDefinition<NwsPayload> = {
  id: "nws",
  // Gridpoint forecasts update about hourly.
  intervalMs: 15 * MINUTE,
  label: "NWS mountain forecast",
  category: "weather",
  required: false,
  attribution: "National Weather Service Salt Lake City — api.weather.gov gridpoint forecasts",
  sourceUrl: "https://www.weather.gov/slc/",
  reportMaxAgeMs: 12 * HOUR,
  async collect(ctx) {
    const points = await Promise.all(
      NWS_POINTS.map(async (pt) => {
        const [grid, text] = await Promise.all([
          ctx.fetchJson<GridData>(gridUrl(pt), { headers: { Accept: "application/geo+json" } }),
          ctx.fetchJson<TextForecast>(`${gridUrl(pt)}/forecast`, { headers: { Accept: "application/geo+json" } }).catch(() => null),
        ]);
        const summary = summarizeGrid(grid, ctx.now);
        const point: PointForecast = {
          ...pt,
          ...summary,
          periods: (text?.properties.periods ?? []).slice(0, 4).map((p) => ({
            name: p.name,
            detailedForecast: p.detailedForecast,
            start: new Date(p.startTime).toISOString(),
          })),
        };
        return point;
      }),
    );
    const updated = points.map((p) => p.gridUpdatedAt).filter((x): x is string => !!x).sort()[0] ?? null;
    return { payload: { points }, sourceUpdatedAt: updated };
  },
};
