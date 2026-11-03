import { Fragment } from "react";
import type { ApiSource, Freshness, Metric, ReportResponse, ResortReport, SnowfallSet, SourceId } from "@/lib/types";
import { sectionHref } from "@/lib/sections";
import { formatAge, formatDenver } from "@/lib/time";
import { DailySnowTeaser } from "../dailysnow/DailySnow";
import { FreshnessBadge, MetricValue } from "../ui";
import { newSnowKey, SNOW_LABEL, snowQualifier } from "./resort-display";

const PRIMARY: SourceId[] = ["alta", "snowbird", "solitude", "brighton"];

type ColumnKey = keyof SnowfallSet | "base";

const COLUMNS: Array<{ key: ColumnKey; title: string }> = [
  { key: "overnight", title: "Overnight / 12 h" },
  { key: "h24", title: SNOW_LABEL.h24 },
  { key: "h48", title: SNOW_LABEL.h48 },
  { key: "storm", title: SNOW_LABEL.storm },
  { key: "base", title: "Base" },
];

/** Phones lead with this window and list the rest on one line beneath it. */
const PHONE_LEAD: ColumnKey = "h24";

/**
 * The value for a column, the window it actually covers, and the note under it.
 * Column headers name the window; the note appears only where the resort's window
 * differs from the column's, like Alta's 12 h in the overnight column or
 * Solitude's "since lifts closed".
 */
function cell(r: ResortReport, key: ColumnKey): { m: Metric; window: string; qualifier: string | null } {
  if (key === "base") return { m: r.base, window: "Base", qualifier: null };
  const used = key === "overnight" ? newSnowKey(r.snowfall) : key;
  const m = r.snowfall[used];
  return {
    m,
    window: SNOW_LABEL[used],
    qualifier: used !== key ? SNOW_LABEL[used] : m.state === "unavailable" ? null : snowQualifier(used, m.label),
  };
}

/**
 * The phone rendering of a resort's values: the lead window as a large headline,
 * then every other window as one line of text, each named by the window it
 * actually covers. The table cells stay in the DOM for screen readers, so this
 * visual copy is hidden from them.
 */
function PhoneSummary({ r }: { r: ResortReport }) {
  const lead = cell(r, PHONE_LEAD);
  return (
    <td className="snow-phone" aria-hidden="true">
      <div className="snow-phone__lead">
        <MetricValue m={lead.m} size="xl" />
        <span className="snow-phone__window">{lead.window}</span>
        {lead.qualifier && lead.qualifier !== lead.window && <span className="snow-phone__note">{lead.qualifier}</span>}
      </div>
      <div className="snow-phone__rest">
        {COLUMNS.filter((c) => c.key !== PHONE_LEAD).map((c) => {
          const { m, window, qualifier } = cell(r, c.key);
          return (
            <span key={c.key} className="snow-phone__item">
              <span className="snow-phone__window">{window}</span> <MetricValue m={m} size="sm" />
              {qualifier && qualifier !== window && <span className="snow-phone__note">{qualifier}</span>}
            </span>
          );
        })}
      </div>
    </td>
  );
}

/** Most to least severe, so the footer badge shows the worst resort's state. */
const SEVERITY: Freshness[] = ["unavailable", "stale", "old-report", "time-unknown", "current"];

/** How each state reads in the footer's list of resorts. */
const STATUS_TEXT: Record<Freshness, string> = {
  unavailable: "Unavailable",
  stale: "Source failing",
  "old-report": "Old report",
  "time-unknown": "Report time unknown",
  current: "Current",
};

/**
 * One freshness line for the whole table, at its foot like the other pages' source
 * lines. Each resort is classified separately, so the badge shows the worst state
 * and labels the resorts in it; any other states follow, each with its own label.
 */
function ResortStatusLine({ sources }: { sources: ApiSource[] }) {
  const worst = SEVERITY.find((f) => sources.some((s) => s.freshness === f)) ?? "current";
  const groups = SEVERITY.map((f) => ({ f, names: sources.filter((s) => s.freshness === f).map((s) => s.label) })).filter((g) => g.names.length);
  return (
    <div className="source-line">
      <FreshnessBadge freshness={worst} />
      {worst === "current" ? (
        <span>All resorts reporting</span>
      ) : (
        groups.map(({ f, names }, i) => (
          <span key={f}>
            {i > 0 && `${STATUS_TEXT[f]}: `}
            <strong>{names.join(", ")}</strong>
          </span>
        ))
      )}
    </div>
  );
}

function Row({ source, now, recommended }: { source: ApiSource; now: Date; recommended: boolean }) {
  const r = source.payload as ResortReport | null;
  return (
    <tr className={`row--primary${recommended ? " row--recommended" : ""}`}>
      <th scope="row">
        <div className="resort-name"><a className="resort-name__link" href={sectionHref(source.id)}>{source.label}</a></div>
        {recommended && <span className="badge badge--ai">AI pick</span>}
      </th>
      {COLUMNS.map((c) => {
        // Every value cell keeps its note line, empty or not, so all rows share one height.
        if (!r) return <td key={c.key} className="muted">—<div className="cell-label" /></td>;
        const { m, qualifier } = cell(r, c.key);
        return (
          <td key={c.key}>
            <MetricValue m={m} size="xl" />
            <div className="cell-label">{qualifier}</div>
          </td>
        );
      })}
      <td className="report-time">
        <div>{r ? formatDenver(r.reportTime, now) : "no data"}</div>
        <div className="report-time__checked">checked {formatAge(source.lastSuccessfulFetchAt, now)}</div>
        {source.status === "error" && <div className="report-time__failed">latest check failed</div>}
      </td>
      {r && <PhoneSummary r={r} />}
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
              <th scope="col" key={c.key}>{c.title}</th>
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
      <ResortStatusLine sources={PRIMARY.map((id) => report.sources[id])} />
    </section>
  );
}
