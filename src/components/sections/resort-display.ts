import type { LiftStatus, SnowfallSet } from "@/lib/types";

/** Shared measurement order; each layout chooses its own emphasis. */
export const SNOW_ORDER = [
  "overnight",
  "h12",
  "h24",
  "h48",
  "h72",
  "d7",
  "storm",
  "season",
] as const satisfies readonly (keyof SnowfallSet)[];

const STATUS_ORDER: Record<LiftStatus, number> = {
  open: 0,
  hold: 1,
  scheduled: 2,
  unknown: 3,
  closed: 4,
};

/** Open and pending items first; preserve source order within each status. */
export function byStatus<T extends { status: LiftStatus }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
}
