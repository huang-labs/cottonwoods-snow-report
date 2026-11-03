import type { DailySnowFigure } from "@/lib/types";
import { SnowLevel } from "../charts";
import { SnowfallChart } from "../snowfall/SnowfallChart";
import { PlumePanelSvg } from "../PlumePanelSvg";

/** Resort-reported totals as horizontal bars. */
function Totals({ rows, label }: { rows: Extract<DailySnowFigure, { kind: "totals" }>["rows"]; label: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.h24 ?? 0, r.h48 ?? 0, r.storm ?? 0]));
  const cols: Array<["h24" | "h48" | "storm", string]> = [["h24", "24 h"], ["h48", "48 h"], ["storm", "Storm"]];
  const present = cols.filter(([k]) => rows.some((r) => r[k] !== null));
  return (
    <table className="dailysnow-totals" aria-label={label}>
      <thead>
        <tr><th scope="col">Resort</th>{present.map(([k, t]) => <th key={k} scope="col">{t}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row">{r.name}</th>
            {present.map(([k]) => (
              <td key={k}>
                {r[k] === null ? <span className="muted">—</span> : (
                  <span className="dailysnow-totals__cell">
                    <span className="dailysnow-totals__bar" style={{ width: `${(r[k]! / max) * 100}%` }} />
                    <span>{r[k]}″</span>
                  </span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One figure in a post. Code-drawn charts sit on a pale panel; images (plumes,
 * stake cams) stand on their own white ground with no panel around them.
 */
export function Figure({ figure: f, postedAt }: { figure: DailySnowFigure; postedAt: string }) {
  let body;
  switch (f.kind) {
    case "snow-bars": {
      // Posts written before 2026-11-03 stored the NWS grid time in the caption.
      const title = f.caption.replace(/ · updated .*$/, "");
      body = <SnowfallChart bars={f.bars} label={title} title={title} />;
      break;
    }
    case "snow-level":
      body = <SnowLevel series={f.series} label={f.caption} />;
      break;
    case "totals":
      body = <Totals rows={f.rows} label={f.caption} />;
      break;
    case "image":
      // Plume panels are drawn exactly as on the plumes page; posts written
      // before the axis was stored fall back to the bare image.
      body = f.axis && f.width && f.height ? (
        <PlumePanelSvg
          src={f.url}
          width={f.width}
          height={f.height}
          plot={f.axis.plot}
          initTime={f.axis.initTime}
          forecastHours={f.axis.forecastHours}
          marker={{ time: new Date(postedAt), label: "posted" }}
          label={`${f.caption}, times in Mountain Time`}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={f.url} alt={f.caption} width={f.width ?? undefined} height={f.height ?? undefined} loading="lazy" />
      );
      break;
  }
  return (
    <figure className={`dailysnow-figure dailysnow-figure--${f.kind === "image" ? "image" : "chart"}${f.id.startsWith("plume-") ? " dailysnow-figure--plume" : ""}`}>
      {body}
      {f.kind !== "snow-bars" && (
        <figcaption>
          {f.caption}
          {f.kind === "snow-level" && (
            <span className="snow-level__legend">
              {f.series.map((s) => <span key={s.canyon} className={`snow-level__key snow-level__key--${s.canyon.toLowerCase()}`}>{s.canyon}</span>)}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
}
