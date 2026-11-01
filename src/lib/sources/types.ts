import type { FetchContext } from "../http";
import type { SourceCategory, SourceId } from "../types";

export interface CollectResult<P> {
  payload: P;
  /** Upstream publication/observation time; null when the source gives none. */
  sourceUpdatedAt: string | null;
}

export interface SourceDefinition<P = unknown> {
  id: SourceId;
  label: string;
  category: SourceCategory;
  /** Required for a successful v1 release (four primary resorts + plumes). */
  required: boolean;
  attribution: string;
  sourceUrl: string;
  /**
   * Upstream report age beyond which a successfully fetched payload is shown as
   * an old report rather than current. null = the source has no publication time.
   */
  reportMaxAgeMs: number | null;
  collect(ctx: FetchContext): Promise<CollectResult<P>>;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function assertValid(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ValidationError(message);
}

export const HOUR = 3_600_000;
