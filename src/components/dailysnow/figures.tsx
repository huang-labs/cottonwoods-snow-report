import type { DailySnowFigure, SixHourSnow } from "@/lib/types";
import { PlumePanelSvg } from "../PlumePanelSvg";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
const newDay = (xs: Array<{ start: string }>, i: number) => i === 0 || dayKeyFmt.format(new Date(xs[i].start)) !== dayKeyFmt.format(new Date(xs[i - 1].start));

/** NWS 6-hour snowfall, as stored with the post (same look as the weather page). */
function SnowBars({ bars, label }: { bars: SixHourSnow[]; label: string }) {
  const maxSnow = Math.max(4, ...bars.map((b) => b.snowIn));
  const w = 1000;
  const h = 170;
  const bw = w / Math.max(1, bars.length);
  return (
    <svg className="snow-bars" viewBox={`0 -24 ${w} ${h + 52}`} role="img" aria-label={label}>
      {bars.map((b, i) => {
        const bh = (b.snowIn / maxSnow) * h;
        return (
          <g key={b.start}>
            {newDay(bars, i) && (
              <>
                <line x1={i * bw} x2={i * bw} y1={0} y2={h} className="snow-bars__grid" />
                <text x={i * bw + 4} y={h + 22} className="snow-bars__day">{dayFmt.format(new Date(b.start))}</text>
              </>
            )}
            <rect x={i * bw + 2} y={h - bh} width={bw - 4} height={Math.max(bh, b.snowIn > 0 ? 2 : 0)} className="snow-bars__bar" />
            {b.snowIn >= 0.5 && <text x={i * bw + bw / 2} y={h - bh - 6} textAnchor="middle" className="snow-bars__val">{b.snowIn.toFixed(1)}</text>}
          </g>
        );
      })}
      <line x1={0} x2={w} y1={h} y2={h} className="snow-bars__axis" />
    </svg>
  );
}

/** Forecast snow level, one line per canyon. */
function SnowLevel({ series, label }: { series: Extract<DailySnowFigure, { kind: "snow-level" }>["series"]; label: string }) {
  const all = series.flatMap((s) => s.points);
  const t0 = Math.min(...all.map((p) => Date.parse(p.start)));
  const t1 = Math.max(...all.map((p) => Date.parse(p.start)));
  const lo = Math.floor(Math.min(...all.map((p) => p.ft)) / 1000) * 1000;
  const hi = Math.ceil(Math.max(...all.map((p) => p.ft)) / 1000) * 1000 || lo + 1000;
  const w = 1000;
  const h = 170;
  const x = (iso: string) => (t1 === t0 ? 0 : ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 60) + 60);
  const y = (ft: number) => h - ((ft - lo) / Math.max(1, hi - lo)) * h;
  const ticks = [];
  for (let ft = lo; ft <= hi; ft += hi - lo > 4000 ? 2000 : 1000) ticks.push(ft);
  const ref = series[0].points;
  return (
    <svg className="snow-bars dailysnow-level" viewBox={`0 -24 ${w} ${h + 52}`} role="img" aria-label={label}>
      {ticks.map((ft) => (
        <g key={ft}>
          <line x1={60} x2={w} y1={y(ft)} y2={y(ft)} className="snow-bars__grid" />
          <text x={0} y={y(ft) + 6} className="snow-bars__day">{(ft / 1000).toFixed(0)}k ft</text>
        </g>
      ))}
      {ref.map((p, i) => newDay(ref, i) && <text key={p.start} x={x(p.start) + 4} y={h + 22} className="snow-bars__day">{dayFmt.format(new Date(p.start))}</text>)}
      {series.map((s) => (
        <polyline key={s.canyon} className={`dailysnow-level__line dailysnow-level__line--${s.canyon.toLowerCase()}`} points={s.points.map((p) => `${x(p.start)},${y(p.ft)}`).join(" ")} />
      ))}
    </svg>
  );
}

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

export function Figure({ figure: f, postedAt }: { figure: DailySnowFigure; postedAt: string }) {
  let body;
  let plume = false;
  switch (f.kind) {
    case "snow-bars":
      body = <SnowBars bars={f.bars} label={f.caption} />;
      break;
    case "snow-level":
      body = <SnowLevel series={f.series} label={f.caption} />;
      break;
    case "totals":
      body = <Totals rows={f.rows} label={f.caption} />;
      break;
    case "image":
      plume = f.id.startsWith("plume-");
      // Plume panels are drawn exactly as on the plumes page; posts written
      // before the axis was stored fall back to the padded bare crop.
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
        <img src={f.url} alt={f.caption} width={f.width ?? undefined} height={f.height ?? undefined} loading="lazy" />
      );
      break;
  }
  return (
    <figure className={`dailysnow-figure dailysnow-figure--${f.kind}${plume ? " dailysnow-figure--plume" : ""}`}>
      {body}
      <figcaption>
        {f.caption}
        {f.kind === "snow-level" && (
          <span className="dailysnow-level__legend">
            {f.series.map((s) => <span key={s.canyon} className={`dailysnow-level__key dailysnow-level__key--${s.canyon.toLowerCase()}`}>{s.canyon}</span>)}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
