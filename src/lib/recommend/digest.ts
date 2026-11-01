import { classify } from "../report";
import { SOURCE_BY_ID } from "../sources";
import { denverParts, denverToUtc } from "../time";
import type {
  CanyonId,
  CanyonStatus,
  ForecastBlock,
  Metric,
  NwsPayload,
  PrimaryResortId,
  ResortReport,
  RoadsPayload,
  Snapshot,
  SourceId,
  TravelTimesPayload,
} from "../types";
import { canyonTexts, classifyCanyon } from "./canyon";

/**
 * Compact, typed facts for the recommendation: what the model reasons over,
 * and what change detection fingerprints. Everything the model would get
 * wrong by itself (season state, canyon state, snow-to-liquid ratios, target
 * day, storm vs fair-weather mode) is computed here.
 */

export const RESORTS: Array<{ id: PrimaryResortId; name: string; canyon: CanyonId }> = [
  { id: "alta", name: "Alta", canyon: "LCC" },
  { id: "snowbird", name: "Snowbird", canyon: "LCC" },
  { id: "solitude", name: "Solitude", canyon: "BCC" },
  { id: "brighton", name: "Brighton", canyon: "BCC" },
];

/** The pick switches from today to tomorrow at this Denver hour. */
export const TOMORROW_FROM_HOUR = 14;
/** A resort seen with lifts running this recently is in season (covers storm-closure days). */
export const IN_SEASON_MEMORY_MS = 4 * 24 * 3_600_000;
/** Storm mode: recent or overnight snowfall, or snowfall forecast during the ski day. */
export const STORM_RECENT_IN = 6;
export const STORM_DAY_FORECAST_IN = 4;

/** UDOT travel-time segment from the canyon base to each resort. */
const TRAVEL_SEGMENT: Record<PrimaryResortId, string> = {
  alta: "9000 S to Alta",
  snowbird: "9000 S to Snowbird Entry 1",
  solitude: "6200 S to Silver Fork",
  brighton: "6200 S to Brighton",
};
const TRAVEL_LIVE_MS = 30 * 60_000;

export interface ResortDigest {
  id: PrimaryResortId;
  name: string;
  canyon: CanyonId;
  /** Lifts running now, or seen running in the last four days and not closed for the season. */
  inSeason: boolean;
  operatingNow: boolean;
  dataFreshness: string;
  reportTime: string | null;
  operatingStatus: string | null;
  lifts: string;
  snowfall: Record<string, string>;
  terrain: string[];
  parking: string[];
  notices: string[];
  conditions: string | null;
  weatherNow: string | null;
  travelFromCanyonBase: string | null;
}

export interface CanyonDigest extends Omit<CanyonStatus, "expectedOpenAt" | "closureAnnounced"> {
  expectedOpen: string | null;
  closureAnnounced: string | null;
}

export interface ForecastDigest {
  canyon: CanyonId;
  point: string;
  dataFreshness: string;
  blocks: Array<Record<string, string | number | null>>;
  nextStorm: string | null;
  text: Array<{ period: string; forecast: string }>;
}

export interface Digest {
  nowLocal: string;
  target: { date: string; day: "today" | "tomorrow"; weekday: string };
  mode: "storm" | "fair";
  modeReason: string;
  canyons: CanyonDigest[];
  resorts: ResortDigest[];
  forecast: ForecastDigest[];
  travelTimesLive: boolean;
  roadsFreshness: string;
  /** Ids of resorts that may be picked (in season). */
  eligible: PrimaryResortId[];
  /** Raw values for change detection; not sent to the model. */
  signals: {
    canyonKeys: string[];
    resortKeys: string[];
    snowKeys: string[];
    nwsUpdated: string[];
    travelKeys: string[];
  };
}

const localFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long" });
const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" });

export function denverDate(d: Date): string {
  const p = denverParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Target day: today until 2 PM Denver, tomorrow after. */
export function targetFor(now: Date): Digest["target"] {
  const p = denverParts(now);
  const tomorrow = p.hour >= TOMORROW_FROM_HOUR;
  const noon = denverToUtc(p.year, p.month, p.day + (tomorrow ? 1 : 0), 12);
  return { date: denverDate(noon), day: tomorrow ? "tomorrow" : "today", weekday: weekdayFmt.format(noon) };
}

/** "9:30 AM today" / "6:00 AM tomorrow" relative to now, Denver time. */
export function localTime(iso: string, now: Date): string {
  const d = new Date(iso);
  const days = Math.round((denverToUtc(...ymd(d)).getTime() - denverToUtc(...ymd(now)).getTime()) / 86_400_000);
  const day = days === 0 ? "today" : days === 1 ? "tomorrow" : days === -1 ? "yesterday" : localFmt.format(d);
  return days >= -1 && days <= 1 ? `${timeFmt.format(d)} ${day}` : day;
}
function ymd(d: Date): [number, number, number] {
  const p = denverParts(d);
  return [p.year, p.month, p.day];
}

const metricText = (m: Metric | undefined): string =>
  !m ? "n/a" : m.state === "reported" ? `${m.value}${m.unit === "in" ? "″" : ` ${m.unit}`}` : m.state === "not_reported" ? "not reported" : "n/a";
const metricValue = (m: Metric | undefined): number | null => (m?.state === "reported" ? m.value : null);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Snow-to-liquid ratio of a forecast block, with a quality word. */
export function slrOf(snowIn: number | null, qpfIn: number | null): string | null {
  if (snowIn === null || qpfIn === null || qpfIn < 0.05 || snowIn < 0.5) return null;
  const r = snowIn / qpfIn;
  const word = r < 8 ? "dense/wet" : r < 12 ? "average density" : r < 16 ? "light" : "very light (blower)";
  return `${Math.round(r)}:1 ${word}`;
}

/** Terrain open/closed: grouped by area when the source names areas, else per item. */
function terrainSummary(r: ResortReport): string[] {
  const t = r.terrain ?? [];
  if (!t.length) return [];
  const generic = t.every((x) => /^terrain( area)?$/i.test(x.kind));
  if (generic) return t.slice(0, 20).map((x) => `${x.name}: ${x.status}`);
  const groups = new Map<string, { open: number; total: number }>();
  for (const x of t) {
    const g = groups.get(x.kind) ?? { open: 0, total: 0 };
    g.total++;
    if (x.status === "open") g.open++;
    groups.set(x.kind, g);
  }
  return [...groups].slice(0, 20).map(([k, g]) => `${k}: ${g.open}/${g.total} open`);
}

function resortDigest(
  def: (typeof RESORTS)[number],
  snapshot: Snapshot,
  travel: TravelTimesPayload | null,
  lastOperatingAt: string | undefined,
  now: Date,
): ResortDigest {
  const rec = snapshot.sources[def.id];
  const r = (rec?.payload ?? null) as ResortReport | null;
  const freshness = classify(SOURCE_BY_ID[def.id], rec, now);
  const lifts = r?.lifts ?? [];
  const usable = freshness.freshness === "current" || freshness.freshness === "time-unknown";
  const operatingNow = usable && ((r?.liftsOpen ?? 0) > 0 || lifts.some((l) => l.status === "open" || l.status === "hold"));
  const scheduled = lifts.some((l) => l.status === "scheduled");
  const closedForSeason =
    /closed for (the )?season/i.test(r?.operatingStatus ?? "") ||
    (lifts.length > 0 && lifts.every((l) => /closed for (the )?season/i.test(`${l.rawStatus} ${l.hours ?? ""}`)));
  const recent = !!lastOperatingAt && now.getTime() - Date.parse(lastOperatingAt) <= IN_SEASON_MEMORY_MS;
  const inSeason = !!r && !closedForSeason && (operatingNow || (usable && scheduled) || recent);
  const hold = lifts.filter((l) => l.status === "hold").length;
  const seg = travel?.segments.find((s) => s.name === TRAVEL_SEGMENT[def.id]);
  const obs = r?.observations[0];
  return {
    id: def.id,
    name: def.name,
    canyon: def.canyon,
    inSeason,
    operatingNow,
    dataFreshness: `${freshness.freshness}: ${freshness.note}`,
    reportTime: r?.reportTime ? localTime(r.reportTime, now) : null,
    operatingStatus: r?.operatingStatus ?? null,
    lifts: r
      ? `${r.liftsOpen ?? "?"}/${r.liftsTotal ?? "?"} open${hold ? `, ${hold} on hold` : ""}${closedForSeason ? " (closed for the season)" : ""}`
      : "no data",
    snowfall: r
      ? {
          overnight: metricText(r.snowfall.overnight),
          "12h": metricText(r.snowfall.h12),
          "24h": metricText(r.snowfall.h24),
          "48h": metricText(r.snowfall.h48),
          storm: metricText(r.snowfall.storm),
          base: metricText(r.base),
        }
      : {},
    terrain: r ? terrainSummary(r) : [],
    parking: (r?.parking ?? []).map((p) => `${p.name}: ${p.status}${p.note ? ` (${p.note})` : ""}`),
    notices: (r?.notices ?? []).slice(0, 6).map((n) => clip(`${n.title}: ${n.text}`, 200)),
    conditions: r?.narrative ? clip(r.narrative, 280) : null,
    weatherNow: obs
      ? [`${obs.location}`, metricText(obs.temperature), obs.wind.state === "reported" ? `wind ${metricText(obs.wind)}` : null, obs.sky]
          .filter(Boolean)
          .join(", ")
      : null,
    travelFromCanyonBase: seg
      ? `${seg.name}: ${seg.currentMin ?? "?"} min (free flow ${seg.freeFlowMin ?? "?"} min)`
      : null,
  };
}

function blockDigest(b: ForecastBlock): Record<string, string | number | null> {
  return {
    period: b.label,
    snowIn: b.snowIn,
    liquidIn: b.qpfIn,
    snowToLiquid: slrOf(b.snowIn, b.qpfIn),
    snowLevelFt: b.snowLevelMinFt === null ? null : `${b.snowLevelMinFt}–${b.snowLevelMaxFt}`,
    tempF: b.tempMinF === null ? null : `${b.tempMinF}–${b.tempMaxF}`,
    windMph: b.windMaxMph === null ? null : `${b.windMaxMph} gust ${b.gustMaxMph ?? "?"}`,
    precipChancePct: b.popMax,
  };
}

/** Max forecast snow (over both points) in the day block of `date`, and the night block before it. */
function forecastSnow(nws: NwsPayload | null, date: string): { day: number; nightBefore: number } {
  let day = 0;
  let nightBefore = 0;
  for (const p of nws?.points ?? []) {
    const dayBlock = p.blocks.find((b) => b.label.endsWith("day") && denverDate(new Date(b.start)) === date);
    if (!dayBlock) continue;
    day = Math.max(day, dayBlock.snowIn ?? 0);
    const night = p.blocks.find((b) => b.end === dayBlock.start);
    nightBefore = Math.max(nightBefore, night?.snowIn ?? 0);
  }
  return { day, nightBefore };
}

export function buildDigest(
  snapshot: Snapshot,
  resortLastOperatingAt: Partial<Record<PrimaryResortId, string>>,
  now: Date,
): Digest {
  const payload = <P>(id: SourceId) => (snapshot.sources[id]?.payload ?? null) as P | null;
  const roads = payload<RoadsPayload>("roads");
  const nws = payload<NwsPayload>("nws");
  const travel = payload<TravelTimesPayload>("traveltimes");
  const target = targetFor(now);

  const reports = Object.fromEntries(RESORTS.map((r) => [r.id, payload<ResortReport>(r.id)]));
  const texts = canyonTexts(roads, reports, now);
  const canyonStatus = (["LCC", "BCC"] as const).map((c) => classifyCanyon(c, texts, now));
  const resorts = RESORTS.map((def) => resortDigest(def, snapshot, travel, resortLastOperatingAt[def.id], now));

  // Mode: today = what fell overnight or falls during the day; tomorrow = tonight's and tomorrow's forecast.
  const recent = Math.max(
    0,
    ...RESORTS.map((def) => {
      const r = reports[def.id];
      return r ? Math.max(metricValue(r.snowfall.overnight) ?? 0, metricValue(r.snowfall.h12) ?? 0, metricValue(r.snowfall.h24) ?? 0) : 0;
    }),
  );
  const fc = forecastSnow(nws, target.date);
  const fallen = target.day === "today" ? recent : fc.nightBefore;
  const storm = fallen >= STORM_RECENT_IN || fc.day >= STORM_DAY_FORECAST_IN;
  const modeReason =
    target.day === "today"
      ? `${recent}″ reported in the last 12–24 h (max across resorts); ${fc.day}″ forecast during today's ski day`
      : `${fc.nightBefore}″ forecast tonight; ${fc.day}″ forecast during tomorrow's ski day`;

  const travelLive =
    !!travel?.newestMeasurementAt && now.getTime() - Date.parse(travel.newestMeasurementAt) <= TRAVEL_LIVE_MS &&
    now.getTime() - Date.parse(travel.newestMeasurementAt) >= -60_000 &&
    classify(SOURCE_BY_ID.traveltimes, snapshot.sources.traveltimes, now).freshness !== "stale";

  // Frozen measurements must not be available for the model to quote accidentally.
  if (!travelLive) for (const r of resorts) r.travelFromCanyonBase = null;

  const forecast: ForecastDigest[] = (nws?.points ?? []).map((p) => ({
    canyon: /BCC/.test(p.name) ? "BCC" : "LCC",
    point: p.name,
    dataFreshness: classify(SOURCE_BY_ID.nws, snapshot.sources.nws, now).freshness,
    blocks: p.blocks.filter((b) => Date.parse(b.end) > now.getTime()).slice(0, 4).map(blockDigest),
    nextStorm: p.nextStorm
      ? `${p.nextStorm.totalSnowIn}″ from ${localTime(p.nextStorm.start, now)} to ${localTime(p.nextStorm.end, now)}${p.nextStorm.minSnowLevelFt ? `, snow level down to ${p.nextStorm.minSnowLevelFt} ft` : ""}`
      : null,
    text: p.periods.slice(0, 3).map((x) => ({ period: x.name, forecast: clip(x.detailedForecast, 320) })),
  }));

  const segMin = (id: PrimaryResortId) => travel?.segments.find((s) => s.name === TRAVEL_SEGMENT[id])?.currentMin ?? null;
  return {
    nowLocal: localFmt.format(now),
    target,
    mode: storm ? "storm" : "fair",
    modeReason,
    canyons: canyonStatus.map(({ expectedOpenAt, closureAnnounced, ...c }) => ({
      ...c,
      expectedOpen: expectedOpenAt ? localTime(expectedOpenAt, now) : null,
      closureAnnounced: closureAnnounced
        ? `${closureAnnounced.text}${closureAnnounced.at ? ` (at ${localTime(closureAnnounced.at, now)})` : ""}`
        : null,
    })),
    resorts,
    forecast,
    travelTimesLive: travelLive,
    roadsFreshness: classify(SOURCE_BY_ID.roads, snapshot.sources.roads, now).freshness,
    eligible: resorts.filter((r) => r.inSeason && (target.day === "tomorrow" || canyonStatus.find((c) => c.canyon === r.canyon)?.state !== "interlodge")).map((r) => r.id),
    signals: {
      canyonKeys: canyonStatus.map((c) => `${c.canyon}:${c.state}:${c.expectedOpenAt ?? ""}:${c.closureAnnounced?.text ?? ""}:${c.restrictions.join(",")}`),
      resortKeys: resorts.map((r) => `${r.id}:${r.inSeason}:${r.operatingNow}`),
      snowKeys: resorts.map((r) => `${r.id}:${r.snowfall.overnight}:${r.snowfall["24h"]}:${r.lifts}:${r.parking.join(",")}:${r.terrain.join(",")}:${r.dataFreshness.split(":")[0]}`),
      nwsUpdated: [classify(SOURCE_BY_ID.nws, snapshot.sources.nws, now).freshness, classify(SOURCE_BY_ID.roads, snapshot.sources.roads, now).freshness, ...(nws?.points ?? []).map((p) => p.gridUpdatedAt ?? "")],
      travelKeys: travelLive ? RESORTS.map((r) => `${r.id}:${Math.round((segMin(r.id) ?? 0) / 5)}`) : [],
    },
  };
}

/** Resorts with lifts running now get their last-operating time refreshed. */
export function updateLastOperating(
  digest: Digest,
  prev: Partial<Record<PrimaryResortId, string>>,
  now: Date,
): Partial<Record<PrimaryResortId, string>> {
  const out = { ...prev };
  for (const r of digest.resorts) if (r.operatingNow) out[r.id] = now.toISOString();
  return out;
}
