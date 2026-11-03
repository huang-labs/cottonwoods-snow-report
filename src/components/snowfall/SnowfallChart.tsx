import type { SixHourSnow } from "@/lib/types";
import { dateLabel, dayLabel, snowfallDays, timeLabel } from "./model";
import "./snowfall.css";

export function SnowfallChart({ bars, label, detail = false }: { bars: SixHourSnow[]; label: string; detail?: boolean }) {
  const days = snowfallDays(bars);
  const max = Math.max(1, ...days.map(d => d.total));
  if (!days.length) return <p className="muted">Snowfall forecast unavailable.</p>;
  return <div className="snowfall" aria-label={label}>
    <p className="snowfall__heading">Snowfall outlook · inches</p>
    <ol className="snowfall__days" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map(d => <li key={d.key}>
        <div className="snowfall__plot">
          <strong className="snowfall__amount">{d.count ? `${d.total.toFixed(1)}″` : "—"}</strong>
          <span className="snowfall__bar" style={{ height: `${d.total / max * 100}px` }} />
        </div>
        <span>{dayLabel.format(new Date(d.start))}</span>
        <span className="snowfall__date">{dateLabel.format(new Date(d.start))}</span>
        {d.partial && <span className="snowfall__partial">{d.count ? "partial" : "missing"}</span>}
      </li>)}
    </ol>
    <p className="snowfall__note">Six-hour periods grouped by start date (Mountain Time), not midnight-to-midnight totals. Partial = fewer periods available; — = no data.</p>
    {detail && <details className="snowfall__detail">
      <summary>Six-hour amounts and times</summary>
      <p className="snowfall__note">Each amount covers six hours from the time shown. Scroll for later periods.</p>
      <div className="snowfall__scroll" tabIndex={0} role="region" aria-label="Six-hour snowfall detail">
        <ol className="snowfall__periods">
          {bars.map(b => <li key={b.start}>
            <div className="snowfall__plot">
              <strong className="snowfall__amount">{b.snowIn.toFixed(1)}″</strong>
              <span className="snowfall__bar" style={{ height: `${b.snowIn / Math.max(1, ...bars.map(x => x.snowIn)) * 100}px` }} />
            </div>
            <span>{dayLabel.format(new Date(b.start))} {dateLabel.format(new Date(b.start))}</span>
            <span className="snowfall__date">{timeLabel.format(new Date(b.start))}</span>
          </li>)}
        </ol>
      </div>
    </details>}
  </div>;
}
