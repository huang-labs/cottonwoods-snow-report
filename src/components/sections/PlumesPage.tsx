import type { ApiSource, PlumeChart, PlumePanel, PlumePayload } from "@/lib/types";
import { formatDenver } from "@/lib/time";
import { PlumePanelSvg } from "../PlumePanelSvg";
import { SourceLine, Unavailable } from "../ui";

const utcFmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "2-digit", hourCycle: "h23" });

function initLabel(iso: string) {
  return `${utcFmt.format(new Date(iso)).replace(/, (\d{2})$/, " $1")}Z`;
}

/** One cropped panel with a Mountain Time axis and a "now" line. */
function Panel({ chart, panel, now }: { chart: PlumeChart; panel: PlumePanel; now: Date }) {
  return (
    <figure className="plume">
      <figcaption className="plume__title">{chart.stationName.replace(/, UT$/, "")}</figcaption>
      <PlumePanelSvg
        src={panel.url}
        width={panel.width}
        height={panel.height}
        plot={panel.plot}
        initTime={chart.initTime}
        forecastHours={chart.forecastHours}
        marker={{ time: now, label: "now" }}
        label={`${panel.title} plume for ${chart.stationName}, run ${chart.runCode}, times in Mountain Time`}
      />
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

export function PlumesPage({ source, now }: { source: ApiSource; now: Date }) {
  const p = source.payload as PlumePayload | null;
  return (
    <section className="page page--plumes">
      <header className="page__header">
        <h1>Utah ensemble snow plumes</h1>
        {p && (
          <p className="page__sub">
            Run <strong>{p.runCode}</strong> · initialized <strong>{formatDenver(p.initTime, now)} MT</strong> ({initLabel(p.initTime)}). Times in MT (source charts use UTC); dashed lines mark midnight, the orange line is now.
          </p>
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
      <SourceLine source={source} now={now} reportLabel="Model initialization" />
    </section>
  );
}
