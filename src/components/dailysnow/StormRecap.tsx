import type { StormRecord } from "@/lib/dailysnow/storm-types";

/** The same retained observations supplied to the model, frozen with this edition. */
export function StormRecap({ storm }: { storm: StormRecord }) {
  return (
    <table className="dailysnow-totals dailysnow-storm" aria-label="Observations for this storm">
      <thead><tr><th scope="col">Resort</th><th scope="col">Storm observations</th></tr></thead>
      <tbody>{storm.resorts.map((r) => {
        const o = r.total ?? r.rolling;
        return (
          <tr key={r.id}>
            <th scope="row">{r.name}</th>
            <td>{o ? <>
              <strong>{o.amountIn}″</strong>{" "}<span className="muted">· {o.window === "storm" ? r.counterResetAt ? "Earlier reported storm total" : "Reported storm total" : `Earlier ${o.window === "48h" ? "48 h" : "24 h"} observation`}</span>
            </> : <span className="muted">— · Storm total unavailable</span>}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}
