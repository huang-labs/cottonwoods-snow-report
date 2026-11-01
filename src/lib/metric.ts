import type { Metric, MetricUnit, SnowfallSet } from "./types";

const EMPTY = new Set(["", "--", "-", "n/a", "na", "null", "undefined"]);

/** Parse a numeric source value; returns null for "--"/empty markers. */
export function parseNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (EMPTY.has(s.toLowerCase())) return null;
  const m = /^-?\d+(?:\.\d+)?/.exec(s.replace(/,/g, ""));
  if (!m) return null;
  const n = Number(m[0]);
  // Sensor loggers use -7999 as a missing-value sentinel.
  if (!Number.isFinite(n) || n <= -999) return null;
  return n;
}

export function reported(value: number, unit: MetricUnit, label: string, note?: string): Metric {
  return note ? { state: "reported", value, unit, label, note } : { state: "reported", value, unit, label };
}

export function unavailable(label: string, note = "Not provided by this source"): Metric {
  return { state: "unavailable", label, note };
}

export function notReported(label: string, note?: string): Metric {
  return note ? { state: "not_reported", label, note } : { state: "not_reported", label };
}

/** Field exists in the source: reported if numeric, otherwise not_reported. */
export function fromField(raw: unknown, unit: MetricUnit, label: string, note?: string): Metric {
  const n = parseNumber(raw);
  return n === null ? notReported(label, note) : reported(n, unit, label, note);
}

export function emptySnowfall(): SnowfallSet {
  return {
    overnight: unavailable("Overnight"),
    h12: unavailable("12 h"),
    h24: unavailable("24 h"),
    h48: unavailable("48 h"),
    h72: unavailable("72 h"),
    d7: unavailable("7 day"),
    storm: unavailable("Storm total"),
    season: unavailable("Season total"),
  };
}

export function metricValue(m: Metric | undefined): number | null {
  return m && m.state === "reported" ? m.value : null;
}

/** Strip HTML to plain text (server-side, no DOM). */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
