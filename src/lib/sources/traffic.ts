import { denverToUtc } from "../time";
import type { TravelSegment, TravelTimesPayload, Webcam, WebcamsPayload } from "../types";
import { decodeEntities } from "../metric";
import { UDOT_CC_URL } from "./roads";
import { assertValid, type SourceDefinition } from "./types";

export const TRAVEL_LAYER =
  "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/CC_Routes_TT/FeatureServer/0";
export const TRAVEL_DASHBOARD = "https://uplan.maps.arcgis.com/apps/dashboards/2f5973a7e20a4a5689eee2074c980009";

interface Attr {
  Route_Name: string;
  Label?: string | null;
  CANYON: string;
  DIRECTION: string;
  LATEST_LOCAL_DATETIME: number | null;
  Current_Travel_Time__min_: number | null;
  Free_Flow_Travel_Time__min_: number | null;
  Distance__miles_: number | null;
}

/**
 * LATEST_LOCAL_DATETIME is an Esri date field holding a *local* (Mountain)
 * wall-clock time stored as if it were UTC. Re-interpret its UTC fields as
 * America/Denver local time.
 */
export function esriLocalToIso(ms: number | null): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  return denverToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()).toISOString();
}

export function splitEndpoints(name: string): { from: string; to: string } {
  const [from, to] = name.split(/\s+to\s+/i);
  return { from: (from ?? name).replace(/\.$/, "").trim(), to: (to ?? "").trim() };
}

export function parseTravelTimes(
  json: { features?: Array<{ attributes: Attr & { EditDate?: number } }> },
  now: Date,
): TravelTimesPayload {
  assertValid(Array.isArray(json.features) && json.features.length > 0, "Travel-time layer returned no features");
  const segments: TravelSegment[] = json.features.map(({ attributes: a }) => {
    const label = a.Label ?? a.Route_Name;
    const { from, to } = splitEndpoints(label);
    const measuredAt = esriLocalToIso(a.LATEST_LOCAL_DATETIME);
    // The field's time zone is undocumented. A "future" time means our local-time
    // interpretation is wrong, so treat the measurement time as unknown.
    const plausible = measuredAt && Date.parse(measuredAt) <= now.getTime() + 5 * 60_000 ? measuredAt : null;
    return {
      canyon: /little/i.test(a.CANYON) ? "LCC" : "BCC",
      name: label,
      from,
      to,
      direction: a.DIRECTION,
      currentMin: a.Current_Travel_Time__min_,
      freeFlowMin: a.Free_Flow_Travel_Time__min_,
      distanceMi: a.Distance__miles_,
      measuredAt: plausible,
    };
  });
  segments.sort((x, y) => x.canyon.localeCompare(y.canyon) || x.direction.localeCompare(y.direction) || x.name.localeCompare(y.name));
  const measured = segments.map((s) => s.measuredAt).filter((x): x is string => !!x).sort();
  const edits = json.features.map((f) => f.attributes.EditDate ?? 0).filter(Boolean);
  return {
    segments,
    newestMeasurementAt: measured.at(-1) ?? null,
    layerEditedAt: edits.length ? new Date(Math.max(...edits)).toISOString() : null,
  };
}

export const travelTimesSource: SourceDefinition<TravelTimesPayload> = {
  id: "traveltimes",
  label: "Canyon travel times",
  category: "travel-times",
  required: false,
  attribution: "UDOT Cottonwood Canyons travel-time dashboard (ArcGIS)",
  sourceUrl: TRAVEL_DASHBOARD,
  // A travel time older than 30 minutes is not a current travel time.
  reportMaxAgeMs: 30 * 60_000,
  async collect(ctx) {
    const url = `${TRAVEL_LAYER}/query?where=1%3D1&outFields=*&returnGeometry=false&f=json`;
    const payload = parseTravelTimes(await ctx.fetchJson(url), ctx.now);
    // sourceUpdatedAt reflects measurement time, not the layer's edit time.
    return { payload, sourceUpdatedAt: payload.newestMeasurementAt };
  },
};

// ---------------- Webcams ----------------

/** Two road-evidence cameras, one per canyon (ids from the UDOT Cottonwood Canyons page). */
export const WEBCAMS: Array<{ id: string; canyon: "LCC" | "BCC"; title: string }> = [
  { id: "171450", canyon: "LCC", title: "SR-210 Seven Turns (MP 7.4)" },
  { id: "171447", canyon: "BCC", title: "SR-190 S-Curves (MP 6.38)" },
];
export const cctvUrl = (id: string) => `https://www.udottraffic.utah.gov/map/Cctv/${id}`;

/** Camera captions published on the UDOT page, keyed by camera id. */
export function parseCameraCaptions(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/map\/Cctv\/(\d+)"\s+alt="([^"]*)"/g)) {
    if (!out.has(m[1])) out.set(m[1], decodeEntities(m[2]));
  }
  return out;
}

export const webcamsSource: SourceDefinition<WebcamsPayload> = {
  id: "webcams",
  label: "UDOT canyon webcams",
  category: "webcams",
  required: false,
  attribution: "UDOT Traffic cameras",
  sourceUrl: UDOT_CC_URL,
  // Camera images carry no capture timestamp the browser can read.
  reportMaxAgeMs: null,
  async collect(ctx) {
    let captions = new Map<string, string>();
    try {
      captions = parseCameraCaptions(await ctx.fetchText(UDOT_CC_URL, { browserLike: true }));
    } catch {
      // Captions are cosmetic; availability is checked per image below.
    }
    const cameras: Webcam[] = await Promise.all(
      WEBCAMS.map(async (c) => {
        const url = cctvUrl(c.id);
        let available = false;
        try {
          const res = await ctx.probe(url, { browserLike: true });
          available = res.status === 200 && (res.headers.get("content-type") ?? "").startsWith("image/");
        } catch {
          available = false;
        }
        return { ...c, description: captions.get(c.id) ?? c.title, imageUrl: url, available };
      }),
    );
    assertValid(cameras.some((c) => c.available), "No webcam image reachable");
    return { payload: { cameras }, sourceUpdatedAt: null };
  },
};
