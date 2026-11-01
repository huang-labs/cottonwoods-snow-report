import { emptySnowfall, fromField, htmlToText, notReported, reported, unavailable } from "../metric";
import { denverParts, denverToUtc, epochSecondsToIso, parseDenverDateTime } from "../time";
import type { Lift, LiftStatus, NamedTerrain, ResortReport, WeatherObservation } from "../types";
import { assertValid, HOUR, type SourceDefinition } from "./types";

export const SNOWBIRD_API = "https://api.snowbird.com/api/v1";
export const SNOWBIRD_PAGE = "https://www.snowbird.com/the-mountain/mountain-report/current-conditions-weather/";

export interface SnowbirdSnowReport {
  date: string;
  location: { name: string };
  amount: number | null;
  overnight_amount: number | null;
  base_depth: number | null;
  unit_of_measurement: string;
  report: string | null;
  created: number;
  updated: number;
  computed?: Record<string, number | null>;
}

interface SnowbirdLift {
  name: string;
  status: string;
  hours: string | null;
  notes: string | null;
  season: string;
  type: string;
}

interface SnowbirdSensor {
  location?: string | null;
  nonstandardizedDataPoints?: Record<string, string>;
  temperature: string | null;
  wind: { low: string | null; high: string | null; current: string | null; direction: string | null };
}

export function liftStatusFrom(raw: string): LiftStatus {
  const s = raw.toLowerCase();
  if (s.startsWith("open")) return "open";
  if (s.includes("hold")) return "hold";
  if (s.includes("expected") || s.includes("scheduled") || s.includes("opening")) return "scheduled";
  if (s.startsWith("closed")) return "closed";
  return "unknown";
}

/**
 * Snowbird sensor timestamps are "MM DD" + "HHMM" without a year. Interpreted as
 * America/Denver wall time; year inferred as the most recent past occurrence.
 */
export function snowbirdSensorTime(points: Record<string, string> | undefined, now: Date): string | null {
  if (!points?.date) return null;
  const d = /^(\d{1,2})\s+(\d{1,2})$/.exec(points.date.trim());
  const t = /^(\d{1,2})(\d{2})$/.exec((points.time ?? points.time_hr ?? "").trim());
  if (!d || !t) return null;
  const { year } = denverParts(now);
  let iso = denverToUtc(year, +d[1], +d[2], +t[1], +t[2]);
  if (iso.getTime() > now.getTime() + 86_400_000) iso = denverToUtc(year - 1, +d[1], +d[2], +t[1], +t[2]);
  return iso.toISOString();
}

function sensorObservation(label: string, s: SnowbirdSensor | undefined, now: Date): WeatherObservation | null {
  if (!s) return null;
  const hasWind = s.wind && (s.wind.current !== null || s.wind.high !== null);
  return {
    location: label,
    observedAt: snowbirdSensorTime(s.nonstandardizedDataPoints, now),
    temperature: fromField(s.temperature, "°F", `${label} temp`),
    wind: hasWind ? fromField(s.wind.current, "mph", "Wind (current)") : unavailable("Wind"),
    gust: hasWind
      ? fromField(s.wind.high, "mph", "Wind high", "Sensor 'high' value for the logging interval")
      : unavailable("Gust"),
    direction: s.wind?.direction ?? null,
  };
}

export interface SnowbirdInputs {
  snowReports: SnowbirdSnowReport[];
  lifts?: SnowbirdLift[] | null;
  terrains?: Array<{ name: string; status: string }> | null;
  sensors?: Record<string, SnowbirdSensor> | null;
  parking?: { free_parking_inventory?: { value: number; max: number }; highway_parking?: string } | null;
  missingSections?: string[];
}

export function parseSnowbird(input: SnowbirdInputs, now: Date): { report: ResortReport; sourceUpdatedAt: string | null } {
  const primary = input.snowReports
    .filter((r) => r.location?.name === "Primary")
    .sort((a, b) => b.updated - a.updated || b.date.localeCompare(a.date))[0];
  assertValid(primary, "No Snowbird 'Primary' snow report");
  const reportDate = parseDenverDateTime(primary.date);
  const publishedAt = epochSecondsToIso(primary.updated) ?? reportDate;
  assertValid(publishedAt, `Unparseable Snowbird report date: ${primary.date}`);
  assertValid((primary.unit_of_measurement ?? "in") === "in", `Unexpected Snowbird unit ${primary.unit_of_measurement}`);

  const computedNote = "Rolling total computed by Snowbird from its report history at fetch time";
  const c = primary.computed ?? {};
  const snowfall = emptySnowfall();
  snowfall.overnight = fromField(primary.overnight_amount, "in", "Overnight");
  snowfall.h24 = c["24_hour"] !== undefined ? fromField(c["24_hour"], "in", "24 Hour", computedNote) : unavailable("24 Hour");
  snowfall.h48 = c["48_hour"] !== undefined ? fromField(c["48_hour"], "in", "48 Hour", computedNote) : unavailable("48 Hour");
  snowfall.h72 = c["72_hour"] !== undefined ? fromField(c["72_hour"], "in", "72 Hour", computedNote) : unavailable("72 Hour");
  snowfall.d7 = c["7_day"] !== undefined ? fromField(c["7_day"], "in", "7 Day", computedNote) : unavailable("7 Day");
  snowfall.season = c.total !== undefined ? fromField(c.total, "in", "Season total") : unavailable("Season total");
  snowfall.h12 = unavailable("12 h", "Not reported by Snowbird");
  snowfall.storm = unavailable("Storm total", "Not reported by Snowbird's report feed");

  const sensors = input.sensors ?? null;
  const observations = sensors
    ? [
        sensorObservation("Base (Snowbird Center)", sensors.snowbirdBase, now),
        sensorObservation("Hidden Peak", sensors.snowbirdHiddenPeak15min, now),
      ].filter((o): o is WeatherObservation => o !== null)
    : [];

  const winterLifts = input.lifts?.filter((l) => l.season !== "summer") ?? null;
  const lifts: Lift[] | null = winterLifts
    ? winterLifts.map((l) => ({
        name: l.name,
        status: liftStatusFrom(l.status),
        rawStatus: l.status,
        hours: l.hours || null,
        note: l.notes || null,
      }))
    : null;
  const terrain: NamedTerrain[] | null = input.terrains
    ? input.terrains.map((t) => ({ name: t.name, kind: "terrain", status: liftStatusFrom(t.status), rawStatus: t.status }))
    : null;

  const parking: ResortReport["parking"] = [];
  if (input.parking) {
    const inv = input.parking.free_parking_inventory;
    if (inv) parking.push({ name: "Free parking inventory", status: `${inv.value}/${inv.max}` });
    if (input.parking.highway_parking) parking.push({ name: "Highway parking", status: input.parking.highway_parking });
  }

  const report: ResortReport = {
    resort: "Snowbird",
    sourceName: "snowbird.com (api.snowbird.com)",
    sourceUrl: SNOWBIRD_PAGE,
    reportTimeLabel: `Snow report ${primary.date} (published)`,
    reportTime: publishedAt,
    operatingStatus: null,
    snowfall,
    base: primary.base_depth === null ? notReported("Base depth") : reported(primary.base_depth, "in", "Base depth"),
    observations,
    liftsOpen: lifts ? lifts.filter((l) => l.status === "open").length : null,
    liftsTotal: lifts ? lifts.length : null,
    lifts,
    terrain,
    notices: [],
    parking,
    narrative: htmlToText(primary.report) || null,
    missingSections: input.missingSections?.length ? input.missingSections : undefined,
  };
  return { report, sourceUpdatedAt: publishedAt };
}

export const snowbirdSource: SourceDefinition<ResortReport> = {
  id: "snowbird",
  label: "Snowbird",
  category: "resort",
  required: true,
  attribution: "Snowbird — snowbird.com mountain report API",
  sourceUrl: SNOWBIRD_PAGE,
  reportMaxAgeMs: 26 * HOUR,
  async collect(ctx) {
    const optional = async <T>(name: string, path: string, missing: string[]): Promise<T | null> => {
      try {
        return await ctx.fetchJson<T>(`${SNOWBIRD_API}${path}`);
      } catch {
        missing.push(name);
        return null;
      }
    };
    const missing: string[] = [];
    const [snowReports, lifts, terrains, sensors, parking] = await Promise.all([
      ctx.fetchJson<SnowbirdSnowReport[]>(`${SNOWBIRD_API}/dor/drupal/snow-reports?sort=date&direction=desc`),
      optional<SnowbirdLift[]>("lifts", "/dor/drupal/lifts", missing),
      optional<Array<{ name: string; status: string }>>("named terrain", "/dor/drupal/terrains", missing),
      optional<Record<string, SnowbirdSensor>>("weather sensors", "/dor/sensors", missing),
      optional<SnowbirdInputs["parking"]>("parking", "/dor/drupal/parking", missing),
    ]);
    assertValid(Array.isArray(snowReports), "Snowbird snow-reports is not an array");
    const { report, sourceUpdatedAt } = parseSnowbird(
      { snowReports, lifts, terrains, sensors, parking, missingSections: missing },
      ctx.now,
    );
    return { payload: report, sourceUpdatedAt };
  },
};
