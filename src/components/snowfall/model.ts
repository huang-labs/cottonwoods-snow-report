import type { SixHourSnow } from "@/lib/types";
const HOUR = 3600000;
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
export const dayLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });
export const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "numeric", day: "numeric" });
export const timeLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", timeZoneName: "short" });
/** Group whole source periods; never apportion a six-hour amount across midnight. */
export function snowfallDays(bars: SixHourSnow[]) {
  if (!bars.length) return [];
  const sorted = [...bars].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const slots = new Map<number, SixHourSnow>();
  sorted.forEach(b => slots.set(Date.parse(b.start), b));
  const groups = new Map<string, { start: string; total: number; count: number; expected: number }>();
  const first = Date.parse(sorted[0].start), last = Date.parse(sorted.at(-1)!.start);
  // Include every synoptic slot on the first/last local date, including missing edge slots.
  for (let t = first - 24 * HOUR; t <= last + 24 * HOUR; t += 6 * HOUR) {
    const key = date.format(t);
    if (key < date.format(first) || key > date.format(last)) continue;
    const group = groups.get(key) ?? { start: new Date(t).toISOString(), total: 0, count: 0, expected: 0 };
    group.expected++;
    const bar = slots.get(t);
    if (bar) { group.total += bar.snowIn; group.count++; }
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, g]) => ({ ...g, key, total: Math.round(g.total * 10) / 10, partial: g.count < g.expected }));
}
