/** Shared Daily Snow display labels and dates, used by the page and the recent posts. */

import type { DailySnowPhase } from "@/lib/types";

export const PHASE_LABEL: Record<DailySnowPhase, string> = { "pre-storm": "Storm ahead", storm: "Storm", "post-storm": "Storm ending", quiet: "Quiet" };

const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

/** "Sun Nov 1" for a YYYY-MM-DD date (no time zone shift). */
export const postDate = (date: string) => dateFmt.format(new Date(`${date}T12:00:00Z`));
