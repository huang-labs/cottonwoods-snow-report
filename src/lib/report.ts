import { SOURCES } from "./sources";
import type { SourceDefinition } from "./sources/types";
import type { ApiSource, Freshness, ReportResponse, Snapshot, SourceId, SourceRecord } from "./types";

export const COLLECTION_INTERVAL_MIN = 5;
/**
 * A source is stale when its last successful fetch is older than this. Four
 * missed five-minute runs plus KV propagation (up to ~60 s) and slack.
 */
export const STALE_AFTER_MS = 22 * 60_000;

export function classify(
  def: Pick<SourceDefinition, "reportMaxAgeMs">,
  rec: SourceRecord | undefined,
  now: Date,
): { freshness: Freshness; note: string } {
  if (!rec || !rec.lastSuccessfulFetchAt || rec.payload === null) {
    return {
      freshness: "unavailable",
      note: rec?.lastError ? `Never collected successfully (${rec.lastError})` : "Not collected yet",
    };
  }
  const sinceSuccess = now.getTime() - Date.parse(rec.lastSuccessfulFetchAt);
  if (sinceSuccess > STALE_AFTER_MS) {
    return {
      freshness: "stale",
      note: `Collection failing${rec.consecutiveFailures ? ` (${rec.consecutiveFailures} consecutive failures)` : ""}; showing last successful data`,
    };
  }
  if (def.reportMaxAgeMs === null) {
    return { freshness: "time-unknown", note: "Source does not publish an update time" };
  }
  if (!rec.sourceUpdatedAt) {
    return { freshness: "time-unknown", note: "Source report time unknown" };
  }
  const age = now.getTime() - Date.parse(rec.sourceUpdatedAt);
  if (age > def.reportMaxAgeMs) {
    return { freshness: "old-report", note: "Fetched recently, but the upstream report itself is old" };
  }
  return { freshness: "current", note: "Collected on schedule; report within its normal update window" };
}

/** Strip operational detail that should not be public (e.g. upstream URLs with tokens are already redacted). */
function publicRecord(rec: SourceRecord): SourceRecord {
  return {
    ...rec,
    diagnostics: rec.diagnostics
      ? {
          durationMs: rec.diagnostics.durationMs,
          upstream: rec.diagnostics.upstream.map((u) => ({ url: u.url.split("?")[0], status: u.status, ms: u.ms })),
        }
      : null,
  };
}

export function buildReport(snapshot: Snapshot | null, now: Date = new Date(), defs: SourceDefinition[] = SOURCES): ReportResponse {
  const sources = {} as Record<SourceId, ApiSource>;
  const requiredMissing: SourceId[] = [];
  for (const def of defs) {
    const rec = snapshot?.sources[def.id];
    const { freshness, note } = classify(def, rec, now);
    const base: SourceRecord = rec ? publicRecord(rec) : {
      id: def.id,
      lastAttemptAt: null,
      lastSuccessfulFetchAt: null,
      sourceUpdatedAt: null,
      status: "never",
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      diagnostics: null,
      payload: null,
    };
    sources[def.id] = {
      ...base,
      label: def.label,
      category: def.category,
      required: def.required,
      attribution: def.attribution,
      sourceUrl: def.sourceUrl,
      freshness,
      freshnessNote: note,
    };
    if (def.required && (freshness === "unavailable" || freshness === "stale")) requiredMissing.push(def.id);
  }
  return {
    generatedAt: now.toISOString(),
    snapshotWrittenAt: snapshot?.writtenAt ?? null,
    collectionIntervalMinutes: COLLECTION_INTERVAL_MIN,
    sources,
    requiredMissing,
  };
}
