import type { PlumeChart } from "./types";

const HOUR = 3_600_000;

/** Stored cropped panels expire on their own once newer runs replace them. */
export const PLUME_PANEL_TTL_S = 4 * 24 * 3600;
/** A run still current this long after cropping is re-cropped, restarting the TTL. */
export const PLUME_PANEL_REFRESH_MS = PLUME_PANEL_TTL_S * 1000 - 24 * HOUR;
/** Failed crops of one run are retried at most this often, this many times in all. */
export const PLUME_CROP_RETRY_MS = HOUR;
export const PLUME_MAX_CROP_ATTEMPTS = 3;

/**
 * When the panels were stored. Payloads from before this field existed were
 * cropped no earlier than the run's initialization, so that is a safe lower bound.
 */
export function panelsStoredAt(chart: Pick<PlumeChart, "panelsStoredAt" | "initTime">): number {
  return Date.parse(chart.panelsStoredAt ?? chart.initTime);
}

/** Whether a chart's referenced panels can still be served from storage. */
export function plumePanelsLive(chart: PlumeChart, now: Date): boolean {
  if (!chart.panels?.length) return false;
  const stored = panelsStoredAt(chart);
  return Number.isFinite(stored) && now.getTime() - stored < PLUME_PANEL_TTL_S * 1000;
}

/** Whether a failed or due crop of the same run may be attempted again now. */
export function plumeCropRetryDue(chart: PlumeChart, now: Date): boolean {
  const attempts = chart.cropAttempts ?? (chart.cropError ? 1 : 0);
  if (attempts >= PLUME_MAX_CROP_ATTEMPTS) return false;
  const failed = chart.cropFailedAt ? Date.parse(chart.cropFailedAt) : NaN;
  return !Number.isFinite(failed) || now.getTime() - failed >= PLUME_CROP_RETRY_MS;
}
