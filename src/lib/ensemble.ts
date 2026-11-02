import { ENSEMBLE_MAX_AGE_MS, ENSEMBLE_URL } from "./sources/ensemble";
import { HOUR, MINUTE } from "./sources/types";
import type { EnsemblePayload, Snapshot } from "./types";

const periodLabel = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", timeZoneName: "short" });

/** The only ensemble facts offered to either model. No arithmetic on marginal percentiles. */
export function ensembleGuidance(snapshot: Snapshot, now: Date) {
  const rec = snapshot.sources.ensemble;
  const p = rec?.payload as EnsemblePayload | null | undefined;
  const age = p ? now.getTime() - Date.parse(p.initializedAt) : NaN;
  const fetchedAge = rec?.lastSuccessfulFetchAt ? now.getTime() - Date.parse(rec.lastSuccessfulFetchAt) : NaN;
  const usable = !!p && rec?.status === "ok" && Number.isFinite(age) && age >= -5 * MINUTE && age <= ENSEMBLE_MAX_AGE_MS && Number.isFinite(fetchedAge) && fetchedAge >= -MINUTE && fetchedAge <= 47 * MINUTE;
  if (!usable) return { status: "unavailable" as const, sourceUrl: ENSEMBLE_URL, reason: !p ? "Not collected" : rec?.status !== "ok" ? "Latest numerical collection failed; last good payload retained but withheld" : "Numerical guidance is stale or has invalid freshness", lastRun: p?.initializedAt ?? null, lastSuccessfulFetchAt: rec?.lastSuccessfulFetchAt ?? null };
  const periods = p.periodEnds.flatMap((end, i) => {
    const start = new Date(Date.parse(end) - 6 * HOUR);
    // Partly elapsed periods are not remaining snow. No prorating or cumulative subtraction.
    if (start.getTime() < now.getTime()) return [];
    const q = (key: "snowIn" | "liquidIn" | "slr") => [1, 3, 5].map((j) => p.values[key][j][i]);
    return [{ start: start.toISOString(), end, local: `${periodLabel.format(start)}–${periodLabel.format(new Date(end))}`, snowIn: q("snowIn"), liquidIn: q("liquidIn"), slr: q("slr") }];
  });
  return { status: "current" as const, sourceUrl: p.sourceUrl, model: p.model, scope: p.scope, station: p.station, elevationFt: p.elevationFt, initializedAt: p.initializedAt, lastSuccessfulFetchAt: rec.lastSuccessfulFetchAt, members: p.members, traceLiquidCorrections: p.traceLiquidCorrections, percentileOrder: "P10, P50, P90 (marginal, per variable and period)", interpretation: "Forecast, not observation. Only wholly future six-hour periods. Do not sum period percentiles, subtract cumulative percentiles, derive total ranges, or divide snow/liquid percentiles. SLR is supplied separately. Wet-bulb height is not a measured snow level. CLN/LCC guidance cannot establish BCC amounts or a canyon comparison.", periods };
}
