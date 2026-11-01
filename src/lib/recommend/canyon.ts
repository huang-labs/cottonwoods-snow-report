import { denverParts, denverToUtc, to24h } from "../time";
import type { CanyonId, CanyonStatus, ResortReport, RoadsPayload } from "../types";

/**
 * Canyon road state for the recommendation, derived from the roads feed and
 * the resorts' own road notices.
 *
 * The roads feed's severity is not usable here: it marks the season-long
 * "GUARDSMAN PASS / CLOSED FOR WINTER" signs critical, and those sit on both
 * canyons' mouth signs all winter. Texts are therefore split into sentences or
 * sign phases, seasonal ones are dropped, and the rest are classified.
 */

/** Season-long gate closures; not about the canyon roads to the resorts. */
const SEASONAL = /GUARDSMAN|BONANZA|SEASONAL|FOR (THE )?(WINTER|SEASON)|WINTER GATE/i;
/** Closures of things other than the road. */
const NOT_ROAD = /PARKING|\bLOTS?\b|TRAIL|LIFT|TERRAIN/i;
const INTERLODGE = /INTERLODGE/i;
const INTERLODGE_OVER = /\bNO INTERLODGE\b|INTERLODGE[^.]{0,40}\b(LIFTED|ENDED|OVER|NO LONGER|CANCEL)/i;
const FUTURE_CLOSE = /\b(WILL CLOSE|WILL BE CLOSED|TO CLOSE|CLOSING|CLOSES)\b|CLOSURE[^.]{0,20}\b(TONIGHT|BEGINNING|STARTING|AT \d)/i;
const CLOSED_NOW = /\bCLOSED\b|\bCLOSURE IN EFFECT\b|\bROAD CLOSURE\b/i;
const OPEN_NOW = /\b(RE)?OPEN(ED)?\b/i;
const RESTRICTION = /TRACTION|CHAINS?|4WD|AWD|4X4|SNOW TIRES/i;
const TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*([AP])\.?\s*M\b\.?`;
const OPEN_TIME = new RegExp(String.raw`(?:\b(?:RE)?OPEN(?:S|ING|ED)?\b|\bUNTIL\b)[^.]{0,40}?\b` + TIME, "i");
const CLOSE_TIME = new RegExp(String.raw`\bCLOS(?:E|ES|ING|URE)\b[^.]{0,30}?\b` + TIME, "i");

const MAX_NOTICE_AGE_MS = 24 * 3_600_000;

interface Text {
  canyon: CanyonId | "both" | "other";
  text: string;
}

function canyonOfText(text: string, fallback: Text["canyon"]): Text["canyon"] {
  const lcc = /SR-?210|SR-?209|LITTLE COTTONWOOD|\bLCC\b/i.test(text);
  const bcc = /SR-?190|BIG COTTONWOOD|\bBCC\b/i.test(text);
  if (lcc && bcc) return "both";
  if (lcc) return "LCC";
  if (bcc) return "BCC";
  return fallback;
}

/** Sentences of a notice, or the phases of a sign. */
function pieces(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\s+\/\s+|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Next occurrence of a Denver wall time, allowing one hour in the past (an opening running late). */
export function nextDenverTime(hour: number, minute: number, now: Date): string {
  const p = denverParts(now);
  for (let d = 0; d < 2; d++) {
    const t = denverToUtc(p.year, p.month, p.day + d, hour, minute);
    if (t.getTime() >= now.getTime() - 3_600_000) return t.toISOString();
  }
  return denverToUtc(p.year, p.month, p.day + 1, hour, minute).toISOString();
}

function timeIn(re: RegExp, text: string, now: Date): string | null {
  const m = re.exec(text);
  if (!m) return null;
  const hour = to24h(Number(m[1]), `${m[3]}M`);
  if (Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2] ?? 0) > 59) return null;
  const minute = m[2] ? Number(m[2]) : 0;
  // A delayed opening stays today; do not silently move a missed estimate to tomorrow.
  if (re === OPEN_TIME) {
    const p = denverParts(now);
    return denverToUtc(p.year, p.month, p.day + (/tomorrow/i.test(text) ? 1 : 0), hour, minute).toISOString();
  }
  return nextDenverTime(hour, minute, now);
}

/** Road-relevant texts per canyon, newest sources only. */
export function canyonTexts(
  roads: RoadsPayload | null,
  resorts: Partial<Record<"alta" | "snowbird" | "solitude" | "brighton", ResortReport | null>>,
  now: Date,
): Text[] {
  const out: Text[] = [];
  const fresh = (updatedAt: string | null | undefined) =>
    !updatedAt || now.getTime() - Date.parse(updatedAt) <= MAX_NOTICE_AGE_MS;
  if (roads) {
    // Signs are read per phase from `signs`; the notices built from them are skipped.
    for (const n of roads.notices) {
      if (n.title.startsWith("Sign:") || !fresh(n.updatedAt) || SEASONAL.test(n.title)) continue;
      const fallback = n.canyon;
      for (const s of pieces(n.text)) out.push({ canyon: canyonOfText(s, fallback), text: s });
    }
    for (const sign of roads.signs) {
      const roadCanyon: Text["canyon"] = /SR-?19\d/.test(sign.roadway) ? "BCC" : /SR-?2(09|10)/.test(sign.roadway) ? "LCC" : "other";
      // Site signs encode one message as several lines in the messages array.
      if (SEASONAL.test(sign.messages.join(" "))) continue;
      for (const msg of sign.messages) {
        if (SEASONAL.test(msg)) continue;
        for (const s of pieces(msg)) out.push({ canyon: canyonOfText(s, roadCanyon), text: s });
      }
    }
  }
  // Alta publishes an LCC road status; the other resorts' road rows are already in the roads feed.
  for (const n of resorts.alta?.notices ?? []) {
    if (/road/i.test(n.title) && fresh(n.updatedAt)) out.push({ canyon: "LCC", text: `Alta road status: ${n.text}` });
  }
  return out.filter((t) => !SEASONAL.test(t.text));
}

export function classifyCanyon(canyon: CanyonId, texts: Text[], now: Date): CanyonStatus {
  const mine = texts.filter((t) => t.canyon === canyon || t.canyon === "both");
  const evidence = [...new Set(mine.map((t) => t.text))];
  let interlodge = false;
  let closed = false;
  let expectedOpenAt: string | null = null;
  let closureAnnounced: CanyonStatus["closureAnnounced"] = null;
  const restrictions: string[] = [];
  for (const text of evidence) {
    if (RESTRICTION.test(text)) restrictions.push(text);
    if (canyon === "LCC" && INTERLODGE.test(text) && !INTERLODGE_OVER.test(text)) interlodge = true;
    if (NOT_ROAD.test(text)) continue;
    if (FUTURE_CLOSE.test(text) && !/\b(?:IS |REMAINS? |CURRENTLY )?CLOSED\b/i.test(text.replace(/WILL BE CLOSED/i, ""))) {
      closureAnnounced ??= { text, at: timeIn(CLOSE_TIME, text, now) };
      continue;
    }
    if (CLOSED_NOW.test(text) && !/\bNOT CLOSED\b|CLOSURE (?:HAS )?(?:ENDED|LIFTED|CANCELLED)/i.test(text)) {
      closed = true;
      expectedOpenAt ??= timeIn(OPEN_TIME, text, now);
    } else if (!OPEN_NOW.test(text)) {
      // e.g. "AVALANCHE CONTROL" / "EST OPENING 9:30 AM" phases following a "CLOSED" phase.
      expectedOpenAt ??= /OPEN/i.test(text) ? timeIn(OPEN_TIME, text, now) : null;
    } else {
      expectedOpenAt ??= timeIn(OPEN_TIME, text, now);
    }
  }
  // An opening time only means something while the road is closed.
  if (!closed && !interlodge) expectedOpenAt = null;
  const state: CanyonStatus["state"] = interlodge
    ? "interlodge"
    : closed
      ? expectedOpenAt
        ? "closed-expected-open"
        : "closed"
      : evidence.some((text) => OPEN_NOW.test(text) && !/\b(?:WILL|EXPECTED|ESTIMATED)\b|OPEN AT/i.test(text)) ? "open" : "unknown";
  return { canyon, state, expectedOpenAt, closureAnnounced, restrictions, evidence: evidence.slice(0, 12) };
}
