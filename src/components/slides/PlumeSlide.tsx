import type { ApiSource, PlumeChart, PlumePanel, PlumePayload } from "@/lib/types";
import { denverMidnightsBetween, formatDenver } from "@/lib/time";
import { SourceLine, Unavailable } from "../ui";

const HOUR = 3_600_000;
const AXIS_H = 66;
/** White margin around each panel, in chart pixels (≈10 px on a 1080p TV). */
const PAD = 20;
const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "numeric", day: "numeric" });
const utcFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "2-digit", hourCycle: "h23" });

function initLabel(iso: string) {
  return `${utcFmt.format(new Date(iso)).replace(/, (\d{2})$/, " $1")}Z`;
}

/**
 * One cropped University of Utah panel with a Mountain Time axis drawn in
 * place of the original UTC labels. The panel's plot frame spans the model
 * init time to init + forecastHours, so any instant maps linearly to x.
 */
function Panel({ chart, panel, now }: { chart: PlumeChart; panel: PlumePanel; now: Date }) {
  const { plot, width, height } = panel;
  const start = new Date(chart.initTime);
  const end = new Date(start.getTime() + chart.forecastHours * HOUR);
  const x = (t: Date) => plot.left + ((t.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * (plot.right - plot.left);
  const midnights = denverMidnightsBetween(start, end);
  // Day labels centred in each Mountain Time day (partial days at the edges included when wide enough).
  const bounds = [start, ...midnights, end];
  const days = bounds.slice(0, -1).map((d, i) => ({ from: d, to: bounds[i + 1] }));
  const nowVisible = now > start && now < end;
  return (
    <figure className="plume">
      <figcaption className="plume__title">{chart.stationName.replace(/, UT$/, "")}</figcaption>
      <svg
        className="plume__svg"
        viewBox={`${-PAD} ${-PAD} ${width + 2 * PAD} ${height + AXIS_H + 2 * PAD}`}
        role="img"
        aria-label={`${panel.title} plume for ${chart.stationName}, run ${chart.runCode}, times in Mountain Time`}
      >
        <rect x={-PAD} y={-PAD} width={width + 2 * PAD} height={height + AXIS_H + 2 * PAD} fill="#fff" />
        <image href={panel.url} x={0} y={0} width={width} height={height} />
        {midnights.map((m) => (
          <g key={m.getTime()}>
            <line x1={x(m)} x2={x(m)} y1={plot.top} y2={plot.bottom} className="plume__midnight" />
            <line x1={x(m)} x2={x(m)} y1={plot.bottom} y2={plot.bottom + 14} className="plume__tick" />
          </g>
        ))}
        {days.map(({ from, to }) => {
          const w = x(to) - x(from);
          if (w < 50) return null;
          const mid = new Date((from.getTime() + to.getTime()) / 2);
          return (
            <g key={from.getTime()}>
              <text x={(x(from) + x(to)) / 2} y={plot.bottom + 34} className="plume__day">{dowFmt.format(mid)}</text>
              {w >= 70 && (
                <text x={(x(from) + x(to)) / 2} y={plot.bottom + 58} className="plume__date">{dateFmt.format(mid)}</text>
              )}
            </g>
          );
        })}
        {nowVisible && (
          <g>
            <line x1={x(now)} x2={x(now)} y1={plot.top} y2={plot.bottom} className="plume__now" />
            {/* Above the frame, clear of the legend; runs are recent, so "now" sits left of the centred title. */}
            <text x={x(now)} y={plot.top - 6} className="plume__nowlabel">now</text>
          </g>
        )}
      </svg>
    </figure>
  );
}

function FullChart({ chart, product }: { chart: PlumeChart; product: string }) {
  return (
    <figure className="plume plume--full">
      <figcaption className="plume__title">
        {chart.stationName} · <span className="source-line__error">cropping failed, showing the original chart (times in UTC)</span>
      </figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={chart.imageUrl} alt={`${product} plume for ${chart.stationName}, run ${chart.runCode}`} />
    </figure>
  );
}

export function PlumeSlide({ source, now }: { source: ApiSource; now: Date }) {
  const p = source.payload as PlumePayload | null;
  return (
    <section className="slide slide--plumes">
      <header className="slide__header slide__header--row">
        <h1>Utah ensemble snow plumes</h1>
        {p && (
          <div className="slide__meta">
            <span>
              Run <strong>{p.runCode}</strong> · initialized <strong>{formatDenver(p.initTime, now)} MT</strong> ({initLabel(p.initTime)})
            </span>
          </div>
        )}
      </header>
      {p ? (
        // One column per station (snow on top, SLR below): the grid flows by column.
        <div className="plume-grid">
          {p.charts.flatMap((c) =>
            c.panels?.length
              ? c.panels.map((panel) => <Panel key={`${c.stationCode}-${panel.id}`} chart={c} panel={panel} now={now} />)
              : [<FullChart key={c.stationCode} chart={c} product={p.product} />],
          )}
        </div>
      ) : (
        <Unavailable source={source} what="Plume charts" />
      )}
      {p && <p className="plume__note">Times in Mountain Time (the original charts are labelled in UTC). Dashed lines mark midnight; the orange line is now.</p>}
      <SourceLine source={source} now={now} reportLabel="Model initialization" />
    </section>
  );
}
