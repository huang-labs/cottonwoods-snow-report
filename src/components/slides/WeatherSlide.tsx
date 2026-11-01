import type { ApiSource, NwsPayload, PointForecast } from "@/lib/types";
import { formatDenver } from "@/lib/time";
import { SourceLine, Unavailable } from "../ui";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });

const fmt = (v: number | null, suffix = "") => (v === null ? "—" : `${v}${suffix}`);
const range = (a: number | null, b: number | null, suffix = "") =>
  a === null || b === null ? "—" : a === b ? `${a}${suffix}` : `${a}–${b}${suffix}`;
const ft = (v: number | null) => (v === null ? null : Math.round(v / 100) / 10);

function SnowBars({ p }: { p: PointForecast }) {
  const bars = p.sixHourSnow;
  if (!bars.length) return null;
  const maxSnow = Math.max(4, ...bars.map((b) => b.snowIn));
  const w = 1000;
  const top = 24;
  const h = 170;
  const bw = w / bars.length;
  return (
    <svg className="snow-bars" viewBox={`0 ${-top} ${w} ${h + top + 28}`} role="img" aria-label={`NWS 6-hour snowfall, ${p.name}`}>
      {bars.map((b, i) => {
        const bh = (b.snowIn / maxSnow) * h;
        const t = new Date(b.start);
        // Label the first bar of each Denver calendar day (robust across DST).
        const dayStart = i === 0 || dayKeyFmt.format(t) !== dayKeyFmt.format(new Date(bars[i - 1].start));
        return (
          <g key={b.start}>
            {dayStart && (
              <>
                <line x1={i * bw} x2={i * bw} y1={0} y2={h} className="snow-bars__grid" />
                <text x={i * bw + 4} y={h + 22} className="snow-bars__day">{dayFmt.format(t)}</text>
              </>
            )}
            <rect x={i * bw + 2} y={h - bh} width={bw - 4} height={Math.max(bh, b.snowIn > 0 ? 2 : 0)} className="snow-bars__bar" />
            {b.snowIn >= 0.5 && (
              <text x={i * bw + bw / 2} y={h - bh - 6} textAnchor="middle" className="snow-bars__val">{b.snowIn.toFixed(1)}</text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={w} y1={h} y2={h} className="snow-bars__axis" />
    </svg>
  );
}

function Point({ p, now }: { p: PointForecast; now: Date }) {
  return (
    <div className="panel weather-point">
      <h2>
        {p.name} <span className="muted small">NWS grid {p.gridId} {p.gridX},{p.gridY}{p.elevationFt ? ` · grid elev ${p.elevationFt.toLocaleString()} ft` : ""}</span>
      </h2>
      <div className="next-storm">
        {p.nextStorm ? (
          <>
            <span className="next-storm__label">Next storm (≥1″ in NWS grid)</span>
            <span className="next-storm__value">{p.nextStorm.totalSnowIn.toFixed(1)}″</span>
            <span>
              {formatDenver(p.nextStorm.start, now)} → {formatDenver(p.nextStorm.end, now)}
              {p.nextStorm.minSnowLevelFt !== null && <> · snow level down to {p.nextStorm.minSnowLevelFt.toLocaleString()} ft</>}
            </span>
          </>
        ) : (
          <span className="muted">No ≥1″ snow episode in the NWS 7-day grid.</span>
        )}
      </div>
      <table className="wx-table">
        <thead>
          <tr>
            <th></th>
            {p.blocks.map((b) => (
              <th key={b.start} scope="col">{b.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="wx-table__snow">
            <th scope="row">Snow</th>
            {p.blocks.map((b) => <td key={b.start}>{b.snowIn === null ? "—" : `${b.snowIn.toFixed(1)}″`}</td>)}
          </tr>
          <tr>
            <th scope="row">Snow level (k ft)</th>
            {p.blocks.map((b) => <td key={b.start}>{range(ft(b.snowLevelMinFt), ft(b.snowLevelMaxFt))}</td>)}
          </tr>
          <tr>
            <th scope="row">Temp °F</th>
            {p.blocks.map((b) => <td key={b.start}>{range(b.tempMinF, b.tempMaxF)}</td>)}
          </tr>
          <tr>
            <th scope="row">Wind / gust mph</th>
            {p.blocks.map((b) => <td key={b.start}>{fmt(b.windMaxMph)} / {fmt(b.gustMaxMph)}</td>)}
          </tr>
          <tr>
            <th scope="row">PoP max</th>
            {p.blocks.map((b) => <td key={b.start}>{fmt(b.popMax, "%")}</td>)}
          </tr>
          <tr>
            <th scope="row">Liquid</th>
            {p.blocks.map((b) => <td key={b.start}>{b.qpfIn === null ? "—" : `${b.qpfIn.toFixed(2)}″`}</td>)}
          </tr>
        </tbody>
      </table>
      <div className="snow-bars-wrap">
        <div className="muted small">6-hour snowfall, next 7 days (inches)</div>
        <SnowBars p={p} />
      </div>
      <dl className="periods">
        {p.periods.slice(0, 2).map((per) => (
          <div key={per.start}>
            <dt>{per.name}</dt>
            <dd>{per.detailedForecast}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function WeatherSlide({ source, now }: { source: ApiSource; now: Date }) {
  const payload = source.payload as NwsPayload | null;
  return (
    <section className="slide slide--weather">
      <header className="slide__header">
        <h1>Cottonwoods mountain weather</h1>
        <p className="slide__sub">NWS Salt Lake City gridpoint forecast. Day = 6 AM–6 PM, night = 6 PM–6 AM Mountain Time; maxima/minima within each block.</p>
      </header>
      {payload ? (
        <div className="weather-grid">
          {payload.points.map((p) => (
            <Point key={p.name} p={p} now={now} />
          ))}
        </div>
      ) : (
        <Unavailable source={source} what="Mountain forecast" />
      )}
      <SourceLine source={source} now={now} reportLabel="Forecast grid updated" />
    </section>
  );
}
