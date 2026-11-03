import { denverDate } from "../recommend/digest";
import { denverParts, denverToUtc } from "../time";
import type { DailySnowPublicationStatus, DailySnowState } from "../types";
import { attemptsToday, DAILY_CALL_CAP, inFlight, LAST_ATTEMPT_HOUR, MAX_ATTEMPTS, POST_HOUR } from "./schedule";

/** Publication availability, separate from the age of an immutable edition. */
export function dailySnowPublicationStatus(
  editionDate: string,
  state: DailySnowState | undefined,
  now: Date,
  expected: boolean,
): DailySnowPublicationStatus {
  if (editionDate >= denverDate(now)) return "current";
  if (!expected) return "paused";
  const p = denverParts(now);
  const yesterday = denverDate(denverToUtc(p.year, p.month, p.day - 1, 12));
  // A missed previous edition remains a delay overnight, even before today's window.
  if (editionDate < yesterday) return "delayed";
  if (p.hour < POST_HOUR) return "scheduled";
  // A final attempt started before the cutoff can still finish after it.
  if (inFlight(state, now)) return "pending";
  const used = attemptsToday(state, now);
  if (p.hour >= LAST_ATTEMPT_HOUR || used.count >= MAX_ATTEMPTS || used.calls + 2 > DAILY_CALL_CAP) return "delayed";
  return "pending";
}
