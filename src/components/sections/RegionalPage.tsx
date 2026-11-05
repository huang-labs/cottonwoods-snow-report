import Link from "next/link";
import type { ApiRecommendation, NwsPayload, PrimaryResortId, ReportResponse, ResortReport } from "@/lib/types";
import { sectionHref } from "@/lib/sections";
import { RESORT_CANYON, SNOW_LOG_RESORTS } from "@/lib/snowlog/record";
import { formatDenver } from "@/lib/time";
import { DailySnowTeaser } from "../dailysnow/DailySnow";
import { buildSnowTimeline, timelineScale } from "../timeline/model";
import { SnowTimeline } from "../timeline/SnowTimeline";
import { SourceLine, StatusBadge } from "../ui";

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

/** Every resort on this page is in the same region; shown under its name. */
const REGION = "Utah · United States";

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
    return { id, source, model };
  });
  const scale = timelineScale(resorts.map((r) => r.model));
  return (
    <section className="page page--regional">
      <DailySnowTeaser post={report.dailySnow} now={now} />
      <header className="page__header">
        <h1>Resorts</h1>
        <p className="page__sub">Snowfall at each resort: the past week, the last 24h, and the NWS forecast for the week ahead.</p>
      </header>
      <div className="resort-timelines">
        {resorts.map(({ id, source, model }) => {
          const picked = pick?.pick === id ? pick : null;
          return (
            <article key={id} className={`resort-timeline${picked ? " resort-timeline--picked" : ""}`} aria-label={source.label}>
              <SnowTimeline
                model={model}
                scale={scale}
                label={source.label}
                now={now}
                heading={
                  <div className="resort-heading">
                    <h2 className="resort-name"><Link className="resort-name__link" href={sectionHref(id)}>{source.label}</Link></h2>
                    {picked && !picked.outdated && !picked.failing && <span className="badge badge--ai">AI pick</span>}
                  </div>
                }
                meta={REGION}
                footer={<span className="resort-timeline__more" aria-hidden="true">View more →</span>}
              />
              {picked && <PickReasoning pick={picked} now={now} />}
            </article>
          );
        })}
      </div>
      <p className="legend">
        <span className="legend__key legend__key--reported" /> reported · <span className="legend__key legend__key--forecast" /> NWS forecast · <span className="legend__key legend__key--ghost" /> what NWS forecast · <span className="metric__value metric__value--zero">0</span> reported zero · <span className="metric__na">–</span> not reported or no new report · <span className="legend__key legend__key--none" /> not recorded.
      </p>
      {nws && <SourceLine source={nws} now={now} reportLabel="Forecast grid updated" />}
    </section>
  );
}
