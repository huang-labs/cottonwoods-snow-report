import type { SnowDayKey } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The snow day containing `t`: [D−1 12:00Z, D 12:00Z) belongs to D. */
export function snowDayOf(t: number): SnowDayKey {
  return new Date(t + 12 * HOUR).toISOString().slice(0, 10);
}

/** End of a snow day (12:00 UTC on its key's date), epoch ms. */
export function snowDayEnd(key: SnowDayKey): number {
  return Date.parse(`${key}T12:00:00Z`);
}

export function snowDayStart(key: SnowDayKey): number {
  return snowDayEnd(key) - DAY;
}

export function addDays(key: SnowDayKey, n: number): SnowDayKey {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/**
 * Collections in the five hours after a snow day ends (5–10 AM MST, 6–11 AM MDT) read
 * that day's morning report. Returns the day, or null outside the window.
 */
export const MORNING_WINDOW_MS = 5 * HOUR;
export function morningOf(t: number): SnowDayKey | null {
  const key = new Date(t).toISOString().slice(0, 10);
  const since = t - snowDayEnd(key);
  return since >= 0 && since < MORNING_WINDOW_MS ? key : null;
}

/** NWS 24 h total for a snow day from hourly amounts, from `fromMs` when the day is under way. */
export function forecastForDay(
  hourly: Array<{ start: string; snowIn: number }>,
  key: SnowDayKey,
  fromMs = -Infinity,
): number | null {
  const start = Math.max(snowDayStart(key), Math.floor(fromMs / HOUR) * HOUR);
  const end = snowDayEnd(key);
  if (start >= end) return null;
  let total = 0;
  let hours = 0;
  for (const h of hourly) {
    const t = Date.parse(h.start);
    if (t >= start && t < end) {
      total += h.snowIn;
      hours++;
    }
  }
  // Only a fully covered window is a total; a forecast that ends mid-day isn't.
  return hours === (end - start) / HOUR ? Math.round(total * 10) / 10 : null;
}
