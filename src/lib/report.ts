import { SOURCES } from "./sources";
import { CRON_INTERVAL_MS, type SourceDefinition } from "./sources/types";
import { denverDate, targetFor } from "./recommend/digest";
import type { ApiDailySnow, ApiRecommendation, ApiSource, DailySnowPost, DailySnowState, Freshness, RecommendationState, ReportResponse, Snapshot, SourceId, SourceRecord } from "./types";

export const COLLECTION_INTERVAL_MIN = 5;
/**
 * A source is stale when its last successful fetch is older than this. Four
 * missed five-minute runs plus KV propagation (up to ~60 s) and slack.
 */
export const STALE_AFTER_MS = 22 * 60_000;

/**
 * Stale threshold for a source: four missed runs plus KV propagation at the
 * 5-minute cadence, extended by a slower source's own collection interval.
 */
export function staleAfterMs(def: Pick<SourceDefinition, "intervalMs">): number {
  return STALE_AFTER_MS + Math.max(0, (def.intervalMs ?? CRON_INTERVAL_MS) - CRON_INTERVAL_MS);
}

export function classify(
  def: Pick<SourceDefinition, "reportMaxAgeMs" | "intervalMs">,
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
  if (sinceSuccess > staleAfterMs(def)) {
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

/** A pick not refreshed for this long (outside quiet hours' natural gap) is shown as outdated. */
export const RECOMMENDATION_MAX_AGE_MS = 12 * 3_600_000;
/** Consecutive failed model calls before the slide says updates are failing. */
export const RECOMMENDATION_FAILING_AFTER = 3;

export function publicRecommendation(state: RecommendationState | undefined, now: Date): ApiRecommendation | null {
  const cur = state?.current;
  if (!cur) return null;
  return {
    ...cur,
    outdated: cur.targetDate !== targetFor(now).date || now.getTime() - Date.parse(cur.generatedAt) > RECOMMENDATION_MAX_AGE_MS,
    failing: (state?.consecutiveFailures ?? 0) >= RECOMMENDATION_FAILING_AFTER,
  };
}

/** Consecutive failed Daily Snow attempts before the post says updates are failing. */
export const DAILY_SNOW_FAILING_AFTER = 2;

/** Posts the API lists in `archive` and serves by date, newest first. Older posts stay in KV
    (stored without expiry as the business archive) but are not public. */
export const DAILY_SNOW_PUBLIC_POSTS = 10;

/** The public archive: the most recent posts, newest first. */
export function publicArchive(state: DailySnowState | undefined): ApiDailySnow["archive"] {
  return (state?.history ?? []).slice(0, DAILY_SNOW_PUBLIC_POSTS).map((h) => ({ date: h.date, title: h.title }));
}

/** A Daily Snow post (current or archived) as the API serves it. */
export function publicDailySnow(post: DailySnowPost | null | undefined, state: DailySnowState | undefined, now: Date): ApiDailySnow | null {
  if (!post) return null;
  const today = denverDate(now);
  return {
    ...post,
    outdated: post.date !== today,
    failing: post.date !== today && (state?.consecutiveFailures ?? 0) >= DAILY_SNOW_FAILING_AFTER,
    archive: publicArchive(state),
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
    recommendation: publicRecommendation(snapshot?.recommendation, now),
    dailySnow: publicDailySnow(snapshot?.dailySnow?.current, snapshot?.dailySnow, now),
  };
}
