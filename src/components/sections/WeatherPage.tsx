import type { ApiSource, NwsPayload, PointForecast } from "@/lib/types";
import { formatDenver } from "@/lib/time";
import { SnowBars } from "../charts";
import { SourceLine, Unavailable } from "../ui";

const fmt = (v: number | null, suffix = "") => (v === null ? "—" : `${v}${suffix}`);
const range = (a: number | null, b: number | null, suffix = "") =>
  a === null || b === null ? "—" : a === b ? `${a}${suffix}` : `${a}–${b}${suffix}`;
const ft = (v: number | null) => (v === null ? null : Math.round(v / 100) / 10);

function Point({ p, now }: { p: PointForecast; now: Date }) {
  return (
    <div className="weather-point">
      <header>
        <h2>{p.name}</h2>
        <p className="weather-point__grid">NWS grid {p.gridId} {p.gridX},{p.gridY}{p.elevationFt ? ` · grid elev ${p.elevationFt.toLocaleString()} ft` : ""}</p>
      </header>
      <div className="next-storm">
        {p.nextStorm ? (
          <>
            <span className="eyebrow">Next storm (≥1″ in NWS grid)</span>
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
      <div className="table-scroll">
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
      </div>
      {p.sixHourSnow.length > 0 && (
        <figure className="weather-point__chart">
          <figcaption>6-hour snowfall, next 7 days (inches)</figcaption>
          <SnowBars bars={p.sixHourSnow} label={`NWS 6-hour snowfall, ${p.name}`} />
        </figure>
      )}
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

export function WeatherPage({ source, now }: { source: ApiSource; now: Date }) {
  const payload = source.payload as NwsPayload | null;
  return (
    <section className="page page--weather">
      <header className="page__header">
        <h1>Cottonwoods mountain weather</h1>
        <p className="page__sub">NWS Salt Lake City gridpoint forecast. Day = 6 AM–6 PM, night = 6 PM–6 AM Mountain Time; maxima/minima within each block.</p>
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
