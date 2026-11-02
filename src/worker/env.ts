import type { CollectorEnv } from "../lib/collect";

/** The Worker receives bindings directly; the static frontend never sees them. */
export interface WorkerEnv extends CollectorEnv {
  ASSETS: Pick<Fetcher, "fetch">;
  ADMIN_TOKEN?: string;
}
