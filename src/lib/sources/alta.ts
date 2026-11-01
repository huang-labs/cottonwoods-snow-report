import { emptySnowfall, fromField, htmlToText, notReported, parseNumber, reported, unavailable } from "../metric";
import { parseDenverDateTime } from "../time";
import type { Lift, LiftStatus, NamedTerrain, Notice, ResortReport, WeatherObservation } from "../types";
import { assertValid, HOUR, type SourceDefinition } from "./types";

export const ALTA_URL = "https://www.alta.com/lift-terrain-status";

interface AltaData {
  seasonal?: Record<string, boolean | string>;
  alerts?: Array<{ name: string; type: string; status: string | null; message: string | null; enabled: boolean; updated_at: string | null }>;
  conditions?: {
    dated_at: string;
    last12: string | null;
    last24: string | null;
    base_depth: string | null;
    storm_total: string | null;
    year_to_date: string | null;
    base_temp: string | null;
    mid_temp: string | null;
    top_temp: string | null;
    wind_direction_text: string | null;
    wind_speed: string | null;
    sky_cover: string | null;
    notes: string | null;
    updated_at: string | null;
  };
  operations?: { lifts?: { open: number; total: number }; runs?: { open: number; total: number } };
  liftStatus?: {
    lifts: Array<{ name: string; open: boolean; opening_at_formatted: string | null; closing_at_formatted: string | null; notes: string | null }>;
    accessGates?: Array<{ name: string; open: boolean; notes: string | null }>;
    terrainAreas?: Array<{ name: string; status: string | null; notes: string | null }>;
  };
}

/** Extract the `window.Alta = {...};` JSON blob embedded in alta.com pages. */
export function extractAltaJson(html: string): AltaData {
  const marker = "window.Alta = ";
  const start = html.indexOf(marker);
  assertValid(start >= 0, "window.Alta blob not found");
  const end = html.indexOf(";</script>", start);
  assertValid(end > start, "window.Alta blob not terminated");
  return JSON.parse(html.slice(start + marker.length, end)) as AltaData;
}

function terrainStatus(raw: string | null | undefined): LiftStatus {
  const s = (raw ?? "").toLowerCase();
  if (s === "open") return "open";
  if (s === "closed") return "closed";
  if (s.includes("hold")) return "hold";
  if (s.includes("expected") || s.includes("scheduled")) return "scheduled";
  return "unknown";
}

export function parseAlta(html: string): { report: ResortReport; sourceUpdatedAt: string | null } {
  const data = extractAltaJson(html);
  const c = data.conditions;
  assertValid(c && c.dated_at, "Alta conditions missing");
  const reportTime = parseDenverDateTime(c.dated_at);
  assertValid(reportTime, `Unparseable Alta dated_at: ${c.dated_at}`);

  const snowfall = emptySnowfall();
  snowfall.h12 = fromField(c.last12, "in", "Last 12 hrs");
  snowfall.h24 = fromField(c.last24, "in", "Last 24 hrs");
  snowfall.storm = fromField(c.storm_total, "in", "Storm total");
  snowfall.season = fromField(c.year_to_date, "in", "Year to date");
  snowfall.overnight = unavailable("Overnight", "Alta reports 12/24-hour windows, not overnight");
  snowfall.h48 = unavailable("48 h", "Not reported by Alta");

  const windSpeed = parseNumber(c.wind_speed);
  const observations: WeatherObservation[] = [
    { location: "Base", value: c.base_temp },
    { location: "Mid", value: c.mid_temp },
    { location: "Top", value: c.top_temp },
  ].map(({ location, value }) => ({
    location,
    observedAt: reportTime,
    temperature: fromField(value, "°F", `${location} temp`),
    wind: unavailable("Wind", "Alta reports one wind value; see wind row"),
    gust: unavailable("Gust", "Alta does not report gusts"),
    direction: null,
    sky: null,
  }));
  // Alta publishes a single wind value without naming the measurement site.
  observations.push({
    location: "Wind (site not stated)",
    observedAt: reportTime,
    temperature: unavailable("Temp"),
    wind: windSpeed !== null ? reported(windSpeed, "mph", "Wind") : notReported("Wind"),
    gust: unavailable("Gust", "Alta does not report gusts"),
    direction: c.wind_direction_text ?? null,
    sky: c.sky_cover ?? null,
  });

  const lifts: Lift[] | null = data.liftStatus?.lifts
    ? data.liftStatus.lifts.map((l) => ({
        name: l.name,
        status: l.open ? "open" : "closed",
        rawStatus: l.open ? "Open" : "Closed",
        hours:
          l.opening_at_formatted && l.closing_at_formatted
            ? `${l.opening_at_formatted}–${l.closing_at_formatted}`
            : null,
        note: l.notes,
      }))
    : null;

  const terrain: NamedTerrain[] | null = data.liftStatus
    ? [
        ...(data.liftStatus.terrainAreas ?? []).map((t) => ({
          name: t.name,
          kind: "terrain area",
          status: terrainStatus(t.status),
          rawStatus: t.status ?? "unknown",
          note: t.notes,
        })),
        ...(data.liftStatus.accessGates ?? []).map((g) => ({
          name: g.name,
          kind: "access gate",
          status: (g.open ? "open" : "closed") as LiftStatus,
          rawStatus: g.open ? "Open" : "Closed",
          note: g.notes,
        })),
      ]
    : null;

  const notices: Notice[] = [];
  const parking: ResortReport["parking"] = [];
  for (const a of data.alerts ?? []) {
    if (!a.enabled || a.type === "unsupported-browser") continue;
    const updatedAt = parseDenverDateTime(a.updated_at);
    if (a.type === "parking-status") {
      parking.push({ name: "Alta parking", status: a.status ?? "unknown", note: htmlToText(a.message) || null });
      continue;
    }
    const closed = /closed/i.test(a.status ?? "");
    notices.push({
      title: a.name,
      text: [a.status, htmlToText(a.message)].filter(Boolean).join(" — "),
      severity: a.type === "road-status" && closed ? "critical" : closed ? "warning" : "info",
      updatedAt,
    });
  }

  const report: ResortReport = {
    resort: "Alta",
    sourceName: "alta.com",
    sourceUrl: ALTA_URL,
    reportTimeLabel: "Conditions observation time",
    reportTime,
    operatingStatus: null,
    snowfall,
    base: fromField(c.base_depth, "in", "Base depth"),
    observations,
    liftsOpen: data.operations?.lifts?.open ?? null,
    liftsTotal: data.operations?.lifts?.total ?? null,
    lifts,
    terrain,
    notices,
    parking,
    narrative: c.notes ? htmlToText(c.notes) : null,
  };
  return { report, sourceUpdatedAt: reportTime };
}

export const altaSource: SourceDefinition<ResortReport> = {
  id: "alta",
  label: "Alta",
  category: "resort",
  required: true,
  attribution: "Alta Ski Area — alta.com",
  sourceUrl: ALTA_URL,
  reportMaxAgeMs: 26 * HOUR,
  async collect(ctx) {
    const html = await ctx.fetchText(ALTA_URL, { browserLike: true });
    const { report, sourceUpdatedAt } = parseAlta(html);
    return { payload: report, sourceUpdatedAt };
  },
};
