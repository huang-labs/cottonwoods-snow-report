import type { Freshness } from "./types";

export type StatusTone = "neutral" | "ok" | "warn" | "bad";

/** Public wording and visual meaning; API states and source thresholds stay independent. */
export const FRESHNESS_STATUS: Record<Freshness, { label: string; tone: StatusTone; description: string }> = {
  current: { label: "Current", tone: "ok", description: "Checked on schedule; report time is within this source’s expected window." },
  "old-report": { label: "Old report", tone: "warn", description: "Checked recently, but the upstream report is older than this source’s expected window." },
  "time-unknown": { label: "Time unknown", tone: "neutral", description: "Checked recently; the information’s publication time cannot be established." },
  stale: { label: "Updates delayed", tone: "warn", description: "No successful check within this source’s expected window; showing the last successful data." },
  unavailable: { label: "Unavailable", tone: "bad", description: "No usable collected data is available." },
};
