import type { PrimaryResortId } from "../types";

/** An observation, not a sum of overlapping reporting windows. */
export interface StormObservation {
  amountIn: number;
  window: "storm" | "48h" | "24h";
  reportTime: string | null;
  collectedAt: string;
  sourceUrl: string;
  /** Present only when a later positive storm report explicitly revises the amount. */
  previousAmountIn?: number;
}

export interface StormResort {
  id: PrimaryResortId;
  name: string;
  total: StormObservation | null;
  /** Highest observed rolling amount, retained as a labeled observation, never a storm total. */
  rolling: StormObservation | null;
  /** A source counter restarted during our event; segments cannot establish a full-event total. */
  counterResetAt?: string;
  latestSegment?: StormObservation;
}

export interface StormRecord {
  id: string;
  /** First evidence we captured; not a claim about the meteorological onset. */
  firstObservedAt: string;
  lastSnowAt: string;
  updatedAt: string;
  status: "active" | "wrapping-up" | "closed";
  closedAt: string | null;
  closureReason: "dry-forecast" | "no-new-evidence" | null;
  resorts: StormResort[];
}

export interface StormCursor {
  collectedAt: string;
  reportTime: string | null;
  seasonIn: number | null;
  stormIn: number | null;
  h24In: number | null;
  h48In: number | null;
}

export interface StormTrackingState {
  checkedAt: string;
  cursors: Partial<Record<PrimaryResortId, StormCursor>>;
  /** Bounded working set; every record also has its own permanent KV archive. */
  events: StormRecord[];
}
