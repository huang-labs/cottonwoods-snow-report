import type { StormRecord } from "@/lib/dailysnow/storm-types";
import { formatDenver } from "@/lib/time";

/** The same retained observations supplied to the model, frozen with this edition. */
export function StormRecap({ storm, postedAt }: { storm: StormRecord; postedAt: string }) {
  return (
    <table className="dailysnow-totals dailysnow-storm" aria-label="Observations for this storm">
      <thead><tr><th scope="col">Resort</th><th scope="col">Storm observations</th></tr></thead>
      <tbody>{storm.resorts.map((r) => {
        const o = r.total ?? r.rolling;
        return (
          <tr key={r.id}>
            <th scope="row">{o ? <a href={o.sourceUrl}>{r.name}</a> : r.name}</th>
            <td>{o ? <>
              <strong>{o.amountIn}″</strong> · {o.window === "storm" ? r.counterResetAt ? "Earlier reported storm total" : "Reported storm total" : `Earlier ${o.window === "48h" ? "48 h" : "24 h"} observation`}
              {r.counterResetAt && <span className="dailysnow-storm__note muted">Source counter reset{r.latestSegment ? `; now ${r.latestSegment.amountIn}″ since reset. Full-event total unavailable.` : "; earlier observation retained."}</span>}
              {o.window !== "storm" && <span className="dailysnow-storm__note muted">Full storm total unavailable · Checked {formatDenver(o.collectedAt, new Date(postedAt))}</span>}
              <span className="dailysnow-storm__note muted">Report {o.reportTime ? formatDenver(o.reportTime, new Date(postedAt)) : "time unavailable"}</span>
              {o.previousAmountIn !== undefined && <span className="dailysnow-storm__note muted">{o.amountIn < o.previousAmountIn ? "Source revised from" : "Previously reported"} {o.previousAmountIn}″</span>}
            </> : <span className="muted">— · Storm total unavailable</span>}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
