import type {
  ApiSource,
  LiftStatus,
  Metric,
  ResortReport,
  SnowfallSet,
} from "@/lib/types";
import { formatDenver } from "@/lib/time";
import {
  FreshnessBadge,
  MetricValue,
  SourceLine,
  StatusDot,
  Unavailable,
} from "../ui";
import { ResortCams } from "./ResortCams";
import "./resort-report.css";

const SNOW_ORDER: Array<keyof SnowfallSet> = [
  "overnight",
  "h12",
  "h24",
  "h48",
  "h72",
  "d7",
  "storm",
  "season",
];
const STATUS_ORDER: Record<LiftStatus, number> = {
  open: 0,
  hold: 1,
  scheduled: 2,
  unknown: 3,
  closed: 4,
};
function byStatus<T extends { status: LiftStatus }>(items: T[]) {
  return [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
}

function SnowMetric({
  metric,
  hero = false,
}: {
  metric: Metric;
  hero?: boolean;
}) {
  return (
    <div className={`resort-metric ${hero ? "resort-metric--hero" : ""}`}>
      <div className="resort-metric__label">{metric.label}</div>
      <MetricValue m={metric} size={hero ? "xl" : "lg"} />
      {metric.note && <p className="resort-metric__note">{metric.note}</p>}
    </div>
  );
}

/** Browse report: normal document flow, independent of the TV's viewport budget. */
export function ResortReportPage({
  source,
  now,
  cams,
  loadedAt,
}: {
  source: ApiSource;
  now: Date;
  cams?: ApiSource;
  loadedAt: number | null;
}) {
  const r = source.payload as ResortReport | null;
  if (!r)
    return (
      <section className="resort-report">
        <header className="resort-report__header">
          <h1>{source.label}</h1>
        </header>
        <Unavailable source={source} what={`${source.label} report`} />
        <SourceLine source={source} now={now} />
      </section>
    );

  // Keep the resort's own measurement windows; Alta supplies 12h, not overnight.
  const recentKey =
    r.snowfall.overnight.state !== "unavailable" ? "overnight" : "h12";
  const primary = [recentKey, "h24"] as const;
  const secondary = SNOW_ORDER.filter(
    (key) =>
      key !== recentKey &&
      key !== "h24" &&
      r.snowfall[key].state !== "unavailable",
  );
  const unsupported = SNOW_ORDER.filter(
    (key) => r.snowfall[key].state === "unavailable",
  );
  const observations = r.observations.filter(
    (observation) =>
      source.id !== "alta" || observation.temperature.state !== "unavailable",
  );
  const notices = r.notices
    .filter(
      (notice) =>
        !(
          notice.severity === "info" &&
          /^road status$/i.test(notice.title.trim())
        ),
    )
    .sort(
      (a, b) =>
        ({ critical: 0, warning: 1, info: 2 })[a.severity] -
        { critical: 0, warning: 1, info: 2 }[b.severity],
    );

  return (
    <article className="resort-report" aria-label={`${r.resort} resort report`}>
      <header className="resort-report__header">
        <div>
          <p className="resort-report__eyebrow">Mountain report</p>
          <h1>{r.resort}</h1>
          <p className="resort-report__time">
            {r.reportTimeLabel}:{" "}
            <strong>{formatDenver(r.reportTime, now)}</strong>
          </p>
        </div>
        <div className="resort-report__state">
          <FreshnessBadge freshness={source.freshness} />
          {r.operatingStatus && (
            <span className="pill">{r.operatingStatus}</span>
          )}
          {r.liftsOpen !== null && r.liftsTotal !== null && (
            <span>
              <strong>
                {r.liftsOpen} / {r.liftsTotal}
              </strong>{" "}
              lifts open
            </span>
          )}
        </div>
      </header>

      {notices.length > 0 && (
        <section className="resort-alerts" aria-label="Resort notices">
          {notices.map((notice, i) => (
            <div key={i} className={`notice notice--${notice.severity}`}>
              <strong>{notice.title}</strong>
              <p>{notice.text}</p>
              {notice.updatedAt && (
                <span className="muted small">
                  Updated {formatDenver(notice.updatedAt, now)}
                </span>
              )}
            </div>
          ))}
        </section>
      )}
      {!!r.missingSections?.length && (
        <p className="resort-report__gap">
          Some information is unavailable this check:{" "}
          {r.missingSections.join(", ")}. Available sections are shown below.
        </p>
      )}

      <nav className="resort-report__jump" aria-label="In this resort report">
        <a href="#resort-snow-heading">Snowfall</a>
        <a href="#resort-weather-heading">Weather</a>
        {r.narrative && <a href="#resort-narrative-heading">Resort report</a>}
        <a href="#resort-lifts-heading">Lifts &amp; terrain</a>
        <a href="#resort-webcams">Webcams</a>
      </nav>

      <section className="resort-snow" aria-labelledby="resort-snow-heading">
        <div className="resort-section-heading">
          <h2 id="resort-snow-heading">Snowfall</h2>
          <span>Reported by {r.resort}</span>
        </div>
        <div className="resort-snow__headline">
          {primary
            .filter((key) => r.snowfall[key].state !== "unavailable")
            .map((key) => (
              <SnowMetric key={key} metric={r.snowfall[key]} hero />
            ))}
          <SnowMetric metric={r.base} hero />
        </div>
        {secondary.length > 0 && (
          <div className="resort-snow__history">
            {secondary.map((key) => (
              <SnowMetric key={key} metric={r.snowfall[key]} />
            ))}
          </div>
        )}
        {unsupported.length > 0 && (
          <p className="resort-snow__unavailable">
            Not provided by {r.resort}:{" "}
            {unsupported.map((key) => r.snowfall[key].label).join(", ")}
          </p>
        )}
      </section>

      <section
        className="panel resort-weather"
        aria-labelledby="resort-weather-heading"
      >
        <div className="resort-section-heading">
          <h2 id="resort-weather-heading">On the mountain</h2>
          <a href="/weather">Forecast ↗</a>
        </div>
        {observations.length === 0 ? (
          <p className="muted">
            Temperature and wind observations aren’t provided in {r.resort}’s
            feed. Check the mountain forecast for weather guidance.
          </p>
        ) : (
          <div className="resort-observations">
            {observations.map((observation) => (
              <div key={observation.location} className="resort-observation">
                <div className="resort-observation__heading">
                  <h3>{observation.location}</h3>
                  <span className="muted small">
                    Observed {formatDenver(observation.observedAt, now)}
                  </span>
                </div>
                {observation.sky && <p className="muted">{observation.sky}</p>}
                <dl>
                  <div>
                    <dt>Temperature</dt>
                    <dd>
                      <MetricValue m={observation.temperature} size="md" />
                    </dd>
                  </div>
                  {observation.wind.state !== "unavailable" && (
                    <div>
                      <dt>Wind {observation.direction}</dt>
                      <dd>
                        <MetricValue m={observation.wind} size="md" />
                      </dd>
                    </div>
                  )}
                  {observation.gust.state !== "unavailable" && (
                    <div>
                      <dt>Gust / high</dt>
                      <dd>
                        <MetricValue m={observation.gust} size="md" />
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      {r.narrative && (
        <section
          className="panel resort-narrative"
          aria-labelledby="resort-narrative-heading"
        >
          <div className="resort-section-heading">
            <h2 id="resort-narrative-heading">From {r.resort}</h2>
            <a href={r.sourceUrl} target="_blank" rel="noreferrer">
              Resort report ↗
            </a>
          </div>
          {r.narrative.length > 240 ? (
            <>
              <p className="resort-narrative__preview">
                {r.narrative.slice(0, 240).trimEnd()}…
              </p>
              <details className="resort-narrative__disclosure" key={source.id}>
                <summary>
                  <span className="resort-narrative__more">Read more</span>
                  <span className="resort-narrative__less">Read less</span>
                </summary>
                <p>{r.narrative}</p>
              </details>
            </>
          ) : (
            <p>{r.narrative}</p>
          )}
        </section>
      )}

      <section
        className="panel resort-operations"
        aria-labelledby="resort-lifts-heading"
      >
        <div className="resort-section-heading">
          <h2 id="resort-lifts-heading">Lifts &amp; terrain</h2>
          {r.liftsOpen !== null && r.liftsTotal !== null && (
            <span>
              {r.liftsOpen} of {r.liftsTotal} lifts open
            </span>
          )}
        </div>
        <p className="resort-status-key">
          <StatusDot status="open" /> Open <StatusDot status="hold" /> Hold{" "}
          <StatusDot status="scheduled" /> Scheduled{" "}
          <StatusDot status="closed" /> Closed <StatusDot status="unknown" />{" "}
          Unknown
        </p>
        {r.lifts === null ? (
          <p className="muted">
            Individual lift status unavailable
            {r.missingSections?.includes("lifts") ? " (lift feed failed)" : ""}.
          </p>
        ) : r.lifts.length === 0 ? (
          <p className="muted">No individual lifts listed in this report.</p>
        ) : (
          <ul className="resort-lifts">
            {byStatus(r.lifts).map((lift) => (
              <li
                key={lift.name}
                className={`resort-lift resort-lift--${lift.status}`}
              >
                <div className="resort-lift__heading">
                  <strong>{lift.name}</strong>
                  <span>
                    <StatusDot status={lift.status} /> {lift.rawStatus}
                  </span>
                </div>
                {lift.hours && <p className="muted">{lift.hours}</p>}
                {lift.note && <p className="resort-lift__note">{lift.note}</p>}
              </li>
            ))}
          </ul>
        )}
        <h3 className="resort-terrain-heading">Named terrain &amp; gates</h3>
        {r.terrain === null ? (
          <p className="muted">
            Named terrain status not provided by this source.
          </p>
        ) : r.terrain.length === 0 ? (
          <p className="muted">No named terrain listed in this report.</p>
        ) : (
          <ul className="resort-terrain">
            {byStatus(r.terrain).map((terrain) => (
              <li key={`${terrain.kind}-${terrain.name}`}>
                <div>
                  <strong>{terrain.name}</strong>
                  <span className="muted small">{terrain.kind}</span>
                </div>
                <span>
                  <StatusDot status={terrain.status} /> {terrain.rawStatus}
                </span>
                {terrain.note && <p className="muted">{terrain.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div id="resort-webcams">
        <ResortCams
          resortId={source.id}
          cams={cams}
          now={now}
          loadedAt={loadedAt}
        />
      </div>

      <SourceLine source={source} now={now} reportLabel={r.reportTimeLabel} />
    </article>
  );
}
