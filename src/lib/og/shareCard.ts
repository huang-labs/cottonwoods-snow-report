import { metricValue } from "../metric";
import { formatDenver } from "../time";
import type { NwsPayload, ReportResponse, ResortReport, SourceId } from "../types";

/** What the link-preview image shows, derived from the stored report. */
export interface ShareCardData {
  /** Absolute Denver date/time, so cached previews remain unambiguous. */
  updated: string | null;
  resorts: Array<{
    name: string;
    /** Resort-reported 24-hour snowfall; null when not current or not reported. */
    snow24: number | null;
    /** "Storm 6″ · Base 12″" — whichever of the two the resort reports. */
    detail: string | null;
    /** "8/12 lifts" when anything is spinning, else the resort's status or "Lifts closed". */
    status: string | null;
  }>;
  /** Largest upcoming NWS snow episode across the forecast points. */
  storm: { inches: number; where: string; when: string } | null;
}

const updatedFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric",
  hour: "numeric", minute: "2-digit",
});

const RESORTS: SourceId[] = ["alta", "snowbird", "solitude", "brighton"];

export const formatInches = (n: number) => `${Math.round(n * 10) / 10}″`;

export function shareCardData(report: ReportResponse, now: Date = new Date()): ShareCardData {
  const resorts = RESORTS.map((id) => {
    const src = report.sources[id];
    const r = src.payload as ResortReport | null;
    const usable = r && src.freshness !== "stale" && src.freshness !== "unavailable" && src.freshness !== "old-report";
    if (!usable) return { name: src.label, snow24: null, detail: null, status: "No current report" };
    const storm = metricValue(r.snowfall.storm);
    const base = metricValue(r.base);
    const detail = [storm !== null && `Storm ${formatInches(storm)}`, base !== null && `Base ${formatInches(base)}`]
      .filter(Boolean)
      .join(" · ");
    let status: string | null;
    if (r.liftsOpen && r.liftsTotal) status = `${r.liftsOpen}/${r.liftsTotal} lifts`;
    else if (r.operatingStatus) status = r.operatingStatus;
    else status = r.liftsOpen === 0 ? "Lifts closed" : null;
    return { name: src.label, snow24: metricValue(r.snowfall.h24), detail: detail || null, status };
  });

  let storm: ShareCardData["storm"] = null;
  const nws = report.sources.nws;
  if (nws.payload && nws.freshness !== "stale" && nws.freshness !== "unavailable" && nws.freshness !== "old-report") {
    for (const p of (nws.payload as NwsPayload).points) {
      const s = p.nextStorm;
      if (s && Date.parse(s.end) > now.getTime() && (!storm || s.totalSnowIn > storm.inches)) {
        storm = { inches: s.totalSnowIn, where: p.name, when: `${formatDenver(s.start, now)} → ${formatDenver(s.end, now)}` };
      }
    }
  }

  return {
    updated: report.snapshotWrittenAt ? updatedFormatter.format(new Date(report.snapshotWrittenAt)) : null,
    resorts,
    storm,
  };
}
