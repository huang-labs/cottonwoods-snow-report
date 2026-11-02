import { collectSource } from "../src/lib/collect";
import { ensembleSource } from "../src/lib/sources/ensemble";
import type { Snapshot } from "../src/lib/types";

/** Opt-in read-only source fetch for tuning before the new collector is deployed. */
export async function addLiveEnsemble(snapshot: Snapshot, now: Date) {
  if (process.argv.includes("--live-ensemble")) {
    snapshot.sources.ensemble = await collectSource(ensembleSource, undefined, {}, now);
    if (snapshot.sources.ensemble.status !== "ok") throw new Error(snapshot.sources.ensemble.lastError ?? "Ensemble unavailable");
  }
}
