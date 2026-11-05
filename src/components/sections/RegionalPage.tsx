import Link from "next/link";
import type { ApiRecommendation, ApiSource, NwsPayload, PrimaryResortId, ReportResponse, ResortReport } from "@/lib/types";
import { sectionHref } from "@/lib/sections";
import { RESORT_CANYON, SNOW_LOG_RESORTS } from "@/lib/snowlog/record";
import { formatDenver } from "@/lib/time";
import { DailySnowTeaser } from "../dailysnow/DailySnow";
import { buildSnowTimeline, timelineScale } from "../timeline/model";
import { SnowTimeline } from "../timeline/SnowTimeline";
import { FreshnessBadge, MetricValue, SourceLine, StatusBadge } from "../ui";
import { ResortsSourceLine } from "./ResortsSourceLine";

function PickReasoning({ pick, now }: { pick: ApiRecommendation; now: Date }) {
  return (
    <div className="pick-reasoning" aria-label="AI recommendation reasoning">
      <strong>{pick.headline}</strong>
      <p>{pick.summary || pick.plan}</p>
      {pick.summary && <p className="muted">{pick.plan}</p>}
      {!!pick.caveats.length && <p className="pick-reasoning__caveats">{pick.caveats.join(" · ")}</p>}
      <div className="pick-reasoning__meta">
        AI · {pick.model ?? "Model not recorded"} · For {pick.targetDate} · Updated {formatDenver(pick.generatedAt, now)}
        {pick.outdated && <StatusBadge tone="warn">Recommendation needs updating</StatusBadge>}
        {pick.failing && <StatusBadge tone="bad">Updates failing</StatusBadge>}
      </div>
    </div>
  );
}

/** Badges a resort header shows only when something is wrong; the AI pick badge when endorsed. */
function ResortMeta({ source, report, endorsed }: { source: ApiSource; report: ResortReport | null; endorsed: boolean }) {
  return (
    <>
      {endorsed && <span className="badge badge--ai">AI pick</span>}
      {source.freshness !== "current" && <FreshnessBadge freshness={source.freshness} />}
      {source.status === "error" && <StatusBadge tone="bad">Latest check failed</StatusBadge>}
      {report && (
        <span className="resort-facts">
          <span>Storm <MetricValue m={report.snowfall.storm} size="sm" /></span>
          <span>Base <MetricValue m={report.base} size="sm" /></span>
        </span>
      )}
    </>
  );
}

export function RegionalPage({ report, now }: { report: ReportResponse; now: Date }) {
  const pick = report.recommendation;
  const nws = report.sources.nws;
  const points = (nws?.payload as NwsPayload | null | undefined)?.points ?? [];
  const resorts = SNOW_LOG_RESORTS.map((id: PrimaryResortId) => {
    const source = report.sources[id];
    const payload = source.payload as ResortReport | null;
    const canyon = RESORT_CANYON[id];
    const model = buildSnowTimeline({
      resort: id,
      name: source.label,
      canyon,
      report: payload,
      log: report.snowLog,
      forecast: points.find((p) => p.name.includes(`(${canyon})`)) ?? null,
      now,
    });
    return { id, source, payload, model };
  });
  const scale = timelineScale(resorts.map((r) => r.model));
  return (
    <section className="page page--regional">
      <DailySnowTeaser post={report.dailySnow} now={now} />
      <header className="page__header">
        <h1>Resort snowfall</h1>
        <p className="page__sub">Each resort’s morning 24 h reports for the past week, its latest 24 h total, and the NWS forecast for the week ahead. Resorts measure at their own sites and times.</p>
      </header>
      <div className="resort-timelines">
        {resorts.map(({ id, source, payload, model }) => {
          const picked = pick?.pick === id ? pick : null;
          return (
            <article key={id} className={`resort-timeline${picked ? " resort-timeline--picked" : ""}`} aria-label={source.label}>
              <SnowTimeline
                model={model}
                scale={scale}
                label={source.label}
                now={now}
                heading={<h2 className="resort-name"><Link className="resort-name__link" href={sectionHref(id)}>{source.label}</Link></h2>}
                meta={<ResortMeta source={source} report={payload} endorsed={!!picked && !picked.outdated && !picked.failing} />}
              />
              {picked && <PickReasoning pick={picked} now={now} />}
            </article>
          );
        })}
      </div>
      <p className="legend">
        <span className="legend__key legend__key--reported" /> reported · <span className="legend__key legend__key--forecast" /> NWS forecast · <span className="legend__key legend__key--ghost" /> what NWS forecast · <span className="metric__value metric__value--zero">0</span> reported zero · <span className="metric__na">–</span> not reported or no new report · <span className="legend__key legend__key--none" /> not recorded. Days end at the morning report (5 AM MST / 6 AM MDT); tap a day for details.
      </p>
      <div className="source-lines">
        <ResortsSourceLine sources={SNOW_LOG_RESORTS.map((id) => report.sources[id])} now={now} />
        {nws && <SourceLine source={nws} now={now} reportLabel="Forecast grid updated" />}
      </div>
    </section>
  );
}
