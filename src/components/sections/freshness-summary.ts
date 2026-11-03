import type { ApiSource, Freshness } from "@/lib/types";

/** Freshness states from most to least in need of attention. */
const FRESHNESS_ORDER: Freshness[] = ["unavailable", "stale", "old-report", "time-unknown", "current"];

export type FreshnessSummary = {
  /** The state of the source that needs the most attention. */
  worst: Freshness;
  /** Source labels grouped by state, worst first; states with no sources are left out. */
  groups: Array<{ freshness: Freshness; labels: string[] }>;
  /** The oldest last successful check across the sources, or null if any was never checked. */
  oldestCheck: string | null;
};

/**
 * Rolls several sources' freshness into one summary, for a footer that speaks for a
 * group of sources (the Snowfall table's four resorts). Each source keeps its own
 * classification; this only orders and groups them.
 */
export function summarizeFreshness(sources: Pick<ApiSource, "freshness" | "label" | "lastSuccessfulFetchAt">[]): FreshnessSummary {
  const groups = FRESHNESS_ORDER.map((freshness) => ({
    freshness,
    labels: sources.filter((s) => s.freshness === freshness).map((s) => s.label),
  })).filter((g) => g.labels.length > 0);
  return { worst: groups[0]?.freshness ?? "current", groups, oldestCheck: oldestCheck(sources) };
}

function oldestCheck(sources: Pick<ApiSource, "lastSuccessfulFetchAt">[]): string | null {
  let oldest: string | null = null;
  for (const { lastSuccessfulFetchAt: at } of sources) {
    if (!at) return null;
    if (oldest === null || Date.parse(at) < Date.parse(oldest)) oldest = at;
  }
  return oldest;
}
