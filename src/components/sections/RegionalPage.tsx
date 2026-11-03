import Link from "next/link";
import { Fragment } from "react";
import type { ApiSource, Metric, ReportResponse, ResortReport, SnowfallSet, SourceId } from "@/lib/types";
import { sectionHref } from "@/lib/sections";
import { formatAge, formatDenver } from "@/lib/time";
import { DailySnowTeaser } from "../dailysnow/DailySnow";
import { MetricValue, StatusBadge } from "../ui";
import { ResortsSourceLine } from "./ResortsSourceLine";
import { newSnowKey, SNOW_LABEL } from "./resort-display";

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
 * The value for a column and the window it actually covers. Column headers name the
 * window ("Overnight / 12 h" covers Alta's 12 h total), so the table shows no note
 * under a value; the phone summary names each figure by its own window.
 */
function cell(r: ResortReport, key: ColumnKey): { m: Metric; window: string } {
  if (key === "base") return { m: r.base, window: "Base" };
  const used = key === "overnight" ? newSnowKey(r.snowfall) : key;
  return { m: r.snowfall[used], window: SNOW_LABEL[used] };
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
      </div>
      <div className="snow-phone__rest">
        {COLUMNS.filter((c) => c.key !== PHONE_LEAD).map((c) => {
          const { m, window } = cell(r, c.key);
          return (
            <span key={c.key} className="snow-phone__item">
              <span className="snow-phone__window">{window}</span> <MetricValue m={m} size="sm" />
            </span>
          );
        })}
      </div>
    </td>
  );
}

function Row({ source, now, recommended }: { source: ApiSource; now: Date; recommended: boolean }) {
  const r = source.payload as ResortReport | null;
  return (
    <tr className={`row--primary${recommended ? " row--recommended" : ""}`}>
      <th scope="row">
        <div className="resort-name"><Link className="resort-name__link" href={sectionHref(source.id)}>{source.label}</Link></div>
        {recommended && <span className="badge badge--ai">AI pick</span>}
      </th>
      {COLUMNS.map((c) => {
        if (!r) return <td key={c.key} className="muted">—</td>;
        return (
          <td key={c.key}>
            <MetricValue m={cell(r, c.key).m} size="xl" />
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
      <DailySnowTeaser post={report.dailySnow} now={now} />
      <header className="page__header">
        <h1>Resort snowfall</h1>
        <p className="page__sub">Resort-reported totals in the same windows for every resort. Each resort measures at its own site and time, so totals aren’t strictly comparable.</p>
      </header>
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
                        AI · {pick.model ?? "Model not recorded"} · For {pick.targetDate} · Updated {formatDenver(pick.generatedAt, now)}
                        {pick.outdated && <StatusBadge tone="warn">Recommendation needs updating</StatusBadge>}
                        {pick.failing && <StatusBadge tone="bad">Updates failing</StatusBadge>}
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
      <ResortsSourceLine sources={PRIMARY.map((id) => report.sources[id])} now={now} />
    </section>
  );
}
