import Link from "next/link";
import { sectionHref } from "@/lib/sections";
import type { ApiSource, Metric, ReportResponse, ResortReport, SnowfallSet, SourceId } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";
import { FreshnessBadge, MetricValue } from "../ui";
import { RecommendationCard } from "../RecommendationCard";

const PRIMARY: SourceId[] = ["alta", "snowbird", "solitude", "brighton"];

const COLUMNS: Array<{ key: keyof SnowfallSet | "base"; title: string }> = [
  { key: "overnight", title: "Overnight / 12 h" },
  { key: "h24", title: "24 h" },
  { key: "h48", title: "48 h" },
  { key: "storm", title: "Storm" },
  { key: "base", title: "Base" },
];

/** Overnight column: use the source's overnight field, else its 12-hour field — always labelled. */
function cell(r: ResortReport, key: (typeof COLUMNS)[number]["key"]): Metric {
  if (key === "base") return r.base;
  if (key === "overnight" && r.snowfall.overnight.state === "unavailable" && r.snowfall.h12.state !== "unavailable") {
    return r.snowfall.h12;
  }
  return r.snowfall[key];
}

function Row({ source, now, recommended }: { source: ApiSource; now: Date; recommended: boolean }) {
  const r = source.payload as ResortReport | null;
  return (
    <tr className={`row--primary${recommended ? " row--recommended" : ""}`}>
      <th scope="row">
        <div className="resort-name">
          <Link href={sectionHref(source.id)}>{source.label}</Link>
        </div>
        <FreshnessBadge freshness={source.freshness} />
        {recommended && <span className="badge badge--ai">AI pick</span>}
      </th>
      {COLUMNS.map((c) => {
        if (!r) return <td key={c.key} className="muted">—</td>;
        const m = cell(r, c.key);
        return (
          <td key={c.key}>
            <MetricValue m={m} size="xl" />
            <div className="cell-label">{m.label}</div>
          </td>
        );
      })}
      <td className="report-time">
        <div>{r ? formatDenver(r.reportTime, now) : "no data"}</div>
        <div className="muted small">checked {formatAge(source.lastSuccessfulFetchAt, now)}</div>
        {source.status === "error" && <div className="small source-line__error">latest check failed</div>}
      </td>
    </tr>
  );
}

export function RegionalSlide({ report, now }: { report: ReportResponse; now: Date }) {
  return (
    <section className="slide slide--regional">
      <header className="slide__header">
        <h1>Regional snowfall</h1>
        <p className="slide__sub">Resort-reported totals. Measurement windows and sites are source-defined and not strictly comparable — each cell shows the resort’s own label.</p>
      </header>
      <RecommendationCard recommendation={report.recommendation} now={now} />
      <table className="snow-table">
        <thead>
          <tr>
            <th scope="col">Resort</th>
            {COLUMNS.map((c) => (
              <th scope="col" key={c.key}>{c.title}</th>
            ))}
            <th scope="col">Report time (MT)</th>
          </tr>
        </thead>
        <tbody>
          {PRIMARY.map((id) => (
            <Row key={id} source={report.sources[id]} now={now} recommended={report.recommendation?.pick === id && !report.recommendation.outdated && !report.recommendation.failing} />
          ))}
        </tbody>
      </table>
      <p className="legend">
        <span className="metric__value metric__value--zero">0″</span> reported zero · <span className="metric__missing">not reported</span> field empty in source · <span className="metric__na">n/a</span> not provided by source
      </p>
    </section>
  );
}
