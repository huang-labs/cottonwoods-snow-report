import { decodeEntities, htmlToText } from "../metric";
import { epochSecondsToIso, parseOffsetIso } from "../time";
import type { RoadNotice, RoadsPayload } from "../types";
import type { FetchContext } from "../http";
import { SNOWBIRD_API } from "./snowbird";
import { BRIGHTON_ROADS_API } from "./brighton";
import { assertValid, type SourceDefinition } from "./types";

export const UDOT_CC_URL = "https://cottonwoodcanyons.udot.utah.gov/road-information/";
export const UDOT_API = "https://www.udottraffic.utah.gov/api/v2/get";

const CANYON_ROADS = new Set(["SR-190", "SR-209", "SR-210"]);

export function canyonOf(text: string): RoadNotice["canyon"] {
  const lcc = /SR-?210|SR-?209|Little Cottonwood|\bLCC\b|Alta|Snowbird/i.test(text);
  const bcc = /SR-?190|Big Cottonwood|\bBCC\b|Brighton|Solitude|Guardsman/i.test(text);
  if (lcc && bcc) return "both";
  if (lcc) return "LCC";
  if (bcc) return "BCC";
  return "other";
}

/** Severity from message text. Closures/avalanche work are critical. */
export function severityOf(text: string): RoadNotice["severity"] {
  if (/\b(CLOSED|CLOSURE|CLOSES|CLOSING|AVALANCHE|INTERLODGE)\b/i.test(text)) return "critical";
  if (/\b(TRACTION|CHAINS?|4WD|AWD|SNOW TIRES|RESTRICT|DELAYS?|ICY|SLICK)\b/i.test(text)) return "warning";
  return "info";
}

// ---- UDOT Cottonwood Canyons site (alerts + mouth-of-canyon signs) ----

export function parseUdotSite(html: string): {
  notices: RoadNotice[];
  signs: RoadsPayload["signs"];
} {
  const notices: RoadNotice[] = [];
  const alertRe =
    /x-text-content-text-primary">([^<]*Alert[^<]*)<\/div>[\s\S]*?<div class="x-text x-content[^"]*">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(alertRe)) {
    const title = decodeEntities(m[1]).trim();
    const text = htmlToText(m[2]);
    if (!text) continue;
    const seasonal = /seasonal/i.test(title);
    notices.push({
      title,
      text,
      // Seasonal gate closures (e.g. Guardsman Pass) are shown on the Roads
      // page but do not trigger the global closure banner.
      severity: seasonal ? "warning" : severityOf(text),
      canyon: canyonOf(text),
      source: "UDOT Cottonwood Canyons",
      updatedAt: null,
    });
  }

  const signs: RoadsPayload["signs"] = [];
  const signRe = /<h4[^>]*>([^<]+)<\/h4>[\s\S]*?udot-message-signs">([\s\S]*?)<\/div>\s*<\/div>/g;
  for (const m of html.matchAll(signRe)) {
    const name = decodeEntities(m[1]).replace(/​/g, "").trim();
    const messages = [...m[2].matchAll(/<p>([\s\S]*?)<\/p>/g)]
      .map((p) => htmlToText(p[1]))
      .filter((t) => t && t !== "NO_MESSAGE");
    const roadway = /SR-\d+/.exec(name)?.[0] ?? name;
    signs.push({ name: `Mouth of canyon sign — ${name}`, roadway, direction: null, messages, source: "UDOT Cottonwood Canyons" });
  }
  return { notices, signs };
}

// ---- UDOT overhead signs relayed by Snowbird's API (statewide; filtered) ----

interface SignFeed {
  [id: string]: { name: string; roadway: string; directionOfTravel: string | null; messages: string[] | null };
}

export function parseSignFeed(feed: SignFeed): RoadsPayload["signs"] {
  return Object.values(feed)
    .filter((s) => CANYON_ROADS.has(s.roadway) || /Cottonwood|Wasatch Blvd/i.test(s.name))
    .map((s) => ({
      name: s.name,
      roadway: s.roadway,
      direction: s.directionOfTravel,
      messages: (s.messages ?? []).map((m) => m.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean),
      source: "UDOT message signs (via Snowbird API)",
    }));
}

// ---- UDOT road weather/restriction for SR-190 relayed by Brighton ----

interface PassCondition {
  updated?: string;
  mountainPassName: string;
  restrictionOne?: { restrictionText?: string; travelDirection?: string } | null;
  restrictionTwo?: { restrictionText?: string; travelDirection?: string } | null;
  roadCondition?: string;
  weatherCondition?: string;
}

export function parsePassConditions(list: PassCondition[]): RoadNotice[] {
  return list.map((p) => {
    const restrictions = [p.restrictionOne, p.restrictionTwo]
      .map((r) => r?.restrictionText)
      .filter((t): t is string => !!t && t !== "None");
    const text = [
      `Road: ${p.roadCondition ?? "unknown"}`,
      `Weather: ${p.weatherCondition ?? "unknown"}`,
      `Restrictions: ${restrictions.length ? restrictions.join("; ") : "None"}`,
    ].join(" · ");
    return {
      title: p.mountainPassName,
      text,
      severity: restrictions.length ? severityOf(restrictions.join(" ")) === "info" ? "warning" : severityOf(restrictions.join(" ")) : "info",
      canyon: canyonOf(p.mountainPassName),
      source: "UDOT mountain pass conditions (via Brighton)",
      updatedAt: parseOffsetIso(p.updated),
    };
  });
}

// ---- Snowbird's SR-210 highway status ----

export function parseSnowbirdRoads(list: Array<{ name: string; status: string; description?: string; updated?: number }>): RoadNotice[] {
  // The feed also contains CMS test entries; only "Highway …" rows are real.
  return list
    .filter((r) => /^Highway\s+SR-/i.test(r.name))
    .map((r) => {
      const status = r.status.replace(/_/g, " ");
      return {
        title: r.name,
        text: [`Status: ${status}`, r.description].filter(Boolean).join(" — "),
        severity: /^closed/i.test(r.status) ? "critical" : /restrict/i.test(r.status) ? "warning" : "info",
        canyon: canyonOf(r.name),
        source: "Snowbird road status",
        updatedAt: epochSecondsToIso(r.updated),
      } satisfies RoadNotice;
    });
}

// ---- UDOT developer API (optional, requires key) ----

interface UdotEvent {
  RoadwayName: string;
  Description: string;
  EventType?: string;
  IsFullClosure?: boolean;
  LastUpdated?: number;
  DirectionOfTravel?: string;
}

export function parseUdotEvents(events: UdotEvent[]): RoadNotice[] {
  return events
    .filter((e) => [...CANYON_ROADS].some((r) => (e.RoadwayName ?? "").includes(r)))
    .map((e) => ({
      title: `${e.RoadwayName}${e.EventType ? ` — ${e.EventType}` : ""}`,
      text: e.Description,
      severity: e.IsFullClosure ? "critical" : severityOf(`${e.EventType ?? ""} ${e.Description}`),
      canyon: canyonOf(`${e.RoadwayName} ${e.Description}`),
      source: "UDOT Traffic API events",
      updatedAt: epochSecondsToIso(e.LastUpdated),
    }));
}

export function signNotices(signs: RoadsPayload["signs"]): RoadNotice[] {
  return signs
    .filter((s) => s.messages.length && CANYON_ROADS.has(s.roadway))
    .map((s) => {
      const text = s.messages.join(" / ");
      return {
        title: `Sign: ${s.name}`,
        text,
        severity: severityOf(text),
        canyon: canyonOf(`${s.roadway} ${s.name}`),
        source: s.source,
        updatedAt: null,
      };
    });
}

export async function collectRoads(ctx: FetchContext): Promise<RoadsPayload> {
  const failures: string[] = [];
  const contributors: string[] = [];
  const attempt = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      const v = await fn();
      contributors.push(name);
      return v;
    } catch (e) {
      failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const key = ctx.env.UDOT_API_KEY;
  const [site, signFeed, passes, sbRoads, events] = await Promise.all([
    attempt("UDOT Cottonwood Canyons site", async () => parseUdotSite(await ctx.fetchText(UDOT_CC_URL, { browserLike: true }))),
    attempt("UDOT signs via Snowbird", async () => parseSignFeed(await ctx.fetchJson<SignFeed>(`${SNOWBIRD_API}/dor/traffic`))),
    attempt("UDOT pass conditions via Brighton", async () =>
      parsePassConditions(await ctx.fetchJson<PassCondition[]>(BRIGHTON_ROADS_API, { browserLike: true, headers: { Accept: "application/json" } })),
    ),
    attempt("Snowbird road status", async () => parseSnowbirdRoads(await ctx.fetchJson(`${SNOWBIRD_API}/dor/drupal/roads`))),
    key
      ? attempt("UDOT Traffic API events", async () =>
          parseUdotEvents(await ctx.fetchJson<UdotEvent[]>(`${UDOT_API}/event?key=${encodeURIComponent(key)}&format=json`)),
        )
      : Promise.resolve(null),
  ]);
  assertValid(contributors.length > 0, `All road feeds failed: ${failures.join(" | ")}`);
  if (!key) failures.push("UDOT Traffic API events: not configured (UDOT_API_KEY unset)");

  const signs = [...(site?.signs ?? []), ...(signFeed ?? [])];
  const notices: RoadNotice[] = [
    ...(site?.notices ?? []),
    ...(events ?? []),
    ...(sbRoads ?? []),
    ...(passes ?? []),
    ...signNotices(signs),
  ];
  return { notices, signs, contributors, partialFailures: failures };
}

export const roadsSource: SourceDefinition<RoadsPayload> = {
  id: "roads",
  label: "Canyon road status",
  category: "roads",
  required: false,
  attribution: "UDOT (Cottonwood Canyons site, message signs, pass conditions), Snowbird, Brighton",
  sourceUrl: UDOT_CC_URL,
  // Aggregated notices have mixed or missing timestamps.
  reportMaxAgeMs: null,
  async collect(ctx) {
    return { payload: await collectRoads(ctx), sourceUpdatedAt: null };
  },
};
