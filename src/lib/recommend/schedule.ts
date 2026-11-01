import { denverParts, denverToUtc } from "../time";
import type { RecommendationState } from "../types";
import { denverDate, type Digest } from "./digest";

/**
 * When to ask the model again. The check runs on every collection cron (5 min);
 * the model is called only when something it would care about changed:
 *
 *  1. No pick yet, the target day changed (2 PM switch to tomorrow), or a
 *     resort became eligible while the rule-based "no pick" was shown.
 *  2. Critical change: a canyon opens/closes, an opening time is posted,
 *     interlodge, a resort starts/stops running lifts, storm/fair mode flips.
 *     Runs at any hour, at most every 10 minutes (signs can flicker).
 *  3. Quiet hours (9 PM – 4:30 AM): nothing else.
 *  4. Morning refreshes at 5:30 AM (before the canyon line-up) and 7:15 AM
 *     (resorts' morning reports are out).
 *  5. Conditions changed (snow totals, lifts, parking, NWS update, live travel
 *     times): at most every 30 minutes.
 *  6. Daytime (5 AM – 4 PM): never older than 2 hours.
 *
 * Failed attempts retry after 10 minutes, and calls are capped per day.
 */

export const CRITICAL_MIN_INTERVAL_MS = 10 * 60_000;
export const CHANGE_MIN_INTERVAL_MS = 30 * 60_000;
export const MAX_AGE_MS = 2 * 3_600_000;
export const RETRY_AFTER_MS = 10 * 60_000;
export const DAILY_CALL_CAP = 40;
const MORNING_ANCHORS: Array<[number, number]> = [
  [5, 30],
  [7, 15],
];

export function fingerprintOf(d: Digest): string {
  const s = d.signals;
  return [d.target.date, d.mode, ...s.canyonKeys, ...s.resortKeys, ...s.snowKeys, ...s.nwsUpdated, ...s.travelKeys].join("|");
}

export function criticalKeyOf(d: Digest): string {
  return [d.target.date, d.mode, ...d.signals.canyonKeys, ...d.signals.resortKeys].join("|");
}

/** Returns the trigger name when the model should be called now, else null. */
export function shouldRun(state: RecommendationState | undefined, digest: Digest, now: Date): string | null {
  const t = now.getTime();
  const cur = state?.current ?? null;
  if (state?.lastAttemptAt && state.lastError && t - Date.parse(state.lastAttemptAt) < RETRY_AFTER_MS) return null;
  if (state && state.calls.date === denverDate(now) && state.calls.count >= DAILY_CALL_CAP) return null;

  if (state?.lastError) return "retry";
  if (!cur || cur.targetDate !== digest.target.date) return "target-day";
  // The current entry is the rule-based "no pick" and a resort is now eligible.
  if (cur.model === null) return "resort-eligible";
  const since = t - Date.parse(cur.generatedAt);
  if (state?.criticalKey !== criticalKeyOf(digest) && since >= CRITICAL_MIN_INTERVAL_MS) return "critical-change";

  const p = denverParts(now);
  const minutes = p.hour * 60 + p.minute;
  if (minutes >= 21 * 60 || minutes < 4 * 60 + 30) return null;

  for (const [h, m] of MORNING_ANCHORS) {
    const anchor = denverToUtc(p.year, p.month, p.day, h, m).getTime();
    if (t >= anchor && t < anchor + 2 * 3_600_000 && Date.parse(cur.generatedAt) < anchor) return "morning-refresh";
  }
  if (state?.fingerprint !== fingerprintOf(digest) && since >= CHANGE_MIN_INTERVAL_MS) return "conditions-changed";
  if (minutes >= 5 * 60 && minutes < 16 * 60 && since >= MAX_AGE_MS) return "max-age";
  return null;
}
