import { Fragment } from "react";
import type { ApiSource, Metric, ReportResponse, ResortReport, SnowfallSet, SourceId } from "@/lib/types";
import { sectionHref } from "@/lib/sections";
import { formatAge, formatDenver } from "@/lib/time";
import { DailySnowTeaser } from "../dailysnow/DailySnow";
import { FreshnessBadge, MetricValue } from "../ui";
import { newSnowKey, SNOW_LABEL, snowQualifier } from "./resort-display";

const PRIMARY: SourceId[] = ["alta", "snowbird", "solitude", "brighton"];

/** `short` heads the column on phones, where five columns share the screen width. */
const COLUMNS: Array<{ key: keyof SnowfallSet | "base"; title: string; short: string }> = [
  { key: "overnight", title: "Overnight / 12 h", short: "Overnight" },
  { key: "h24", title: SNOW_LABEL.h24, short: SNOW_LABEL.h24 },
  { key: "h48", title: SNOW_LABEL.h48, short: SNOW_LABEL.h48 },
  { key: "storm", title: SNOW_LABEL.storm, short: SNOW_LABEL.storm },
  { key: "base", title: "Base", short: "Base" },
];

/**
 * The value for a column and the note under it. Column headers name the window on
 * every screen; the note appears only where the resort's window differs from the
 * column's, like Alta's 12 h in the overnight column or Solitude's "since lifts closed".
 */
function cell(r: ResortReport, key: (typeof COLUMNS)[number]["key"]): { m: Metric; qualifier: string | null } {
  if (key === "base") return { m: r.base, qualifier: null };
  const used = key === "overnight" ? newSnowKey(r.snowfall) : key;
  const m = r.snowfall[used];
  return {
    m,
    qualifier: used !== key ? SNOW_LABEL[used] : m.state === "unavailable" ? null : snowQualifier(used, m.label),
  };
}

function Row({ source, now, recommended }: { source: ApiSource; now: Date; recommended: boolean }) {
  const r = source.payload as ResortReport | null;
  return (
    <tr className={`row--primary${recommended ? " row--recommended" : ""}`}>
      <th scope="row">
        <div className="resort-name"><a className="resort-name__link" href={sectionHref(source.id)}>{source.label}</a></div>
        <FreshnessBadge freshness={source.freshness} />
        {recommended && <span className="badge badge--ai">AI pick</span>}
      </th>
      {COLUMNS.map((c) => {
        if (!r) return <td key={c.key} className="muted">—</td>;
        const { m, qualifier } = cell(r, c.key);
        return (
          <td key={c.key}>
            <MetricValue m={m} size="xl" />
            {qualifier && <div className="cell-label">{qualifier}</div>}
          </td>
        );
      })}
      <td className="report-time">
        <div>{r ? formatDenver(r.reportTime, now) : "no data"}</div>
        <div className="report-time__checked">checked {formatAge(source.lastSuccessfulFetchAt, now)}</div>
        {source.status === "error" && <div className="report-time__failed">latest check failed</div>}
      </td>
    </tr>
  );
}

export function RegionalPage({ report, now }: { report: ReportResponse; now: Date }) {
  const pick = report.recommendation;
  return (
    <section className="page page--regional">
      <header className="page__header">
        <h1>Regional snowfall</h1>
        <p className="page__sub">Resort-reported totals in the same windows for every resort. Each resort measures at its own site and time, so totals aren’t strictly comparable; a note under a value marks where a resort’s window differs.</p>
      </header>
      <DailySnowTeaser post={report.dailySnow} now={now} />
      <table className="snow-table">
        <thead>
          <tr>
            <th scope="col">Resort</th>
            {COLUMNS.map((c) => (
              <th scope="col" key={c.key} aria-label={c.title}>
                <span className="col-full" aria-hidden="true">{c.title}</span>
                <span className="col-short" aria-hidden="true">{c.short}</span>
              </th>
            ))}
            <th scope="col">Report time (MT)</th>
          </tr>
        </thead>
        <tbody>
          {PRIMARY.map((id) => (
            <Fragment key={id}>
              <Row source={report.sources[id]} now={now} recommended={pick?.pick === id && !pick.outdated && !pick.failing} />
              {pick?.pick === id && (
                <tr className="recommendation-row">
                  <td colSpan={COLUMNS.length + 2}>
                    <div className="recommendation-row__body" aria-label="AI recommendation reasoning">
                      <strong>{pick.headline}</strong>
                      <p>{pick.summary || pick.plan}</p>
                      {pick.summary && <p className="muted">{pick.plan}</p>}
                      {!!pick.caveats.length && <p className="recommendation-row__caveats">{pick.caveats.join(" · ")}</p>}
                      <div className="recommendation-row__meta">
                        AI · {pick.model ?? "Model not recorded"} · For {pick.targetDate} · Updated {formatDenver(pick.generatedAt, now)}{pick.outdated ? " · Outdated" : ""}{pick.failing ? " · Updates failing" : ""}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <p className="legend">
        <span className="metric__value metric__value--zero">0″</span> reported zero · <span className="metric__missing">not reported</span> field empty in source · <span className="metric__na">—</span> not provided by source
      </p>
    </section>
  );
}
