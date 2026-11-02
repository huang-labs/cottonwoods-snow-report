import type { ApiSource, Freshness, LiftStatus, Metric } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";

const FRESHNESS_TEXT: Record<Freshness, string> = {
  current: "Current",
  "old-report": "Old report",
  "time-unknown": "Report time unknown",
  stale: "Stale — source failing",
  unavailable: "Unavailable",
};

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  return <span className={`badge badge--${freshness}`}>{FRESHNESS_TEXT[freshness]}</span>;
}

/** Large metric value. Zero, not-reported and unavailable look different. */
export function MetricValue({ m, size = "lg", showLabel = false }: { m: Metric; size?: "xl" | "lg" | "md" | "sm"; showLabel?: boolean }) {
  let body;
  if (m.state === "reported") {
    const unit = m.unit === "in" ? "″" : m.unit === "°F" ? "°" : m.unit === "count" ? "" : ` ${m.unit}`;
    body = (
      <span className={`metric__value ${m.value === 0 ? "metric__value--zero" : ""}`}>
        {formatNumber(m.value)}
        <span className={`metric__unit${m.unit === "in" ? " metric__unit--in" : ""}`}>{unit}</span>
      </span>
    );
  } else if (m.state === "not_reported") {
    body = <span className="metric__missing" title={m.note}>not reported</span>;
  } else {
    body = <span className="metric__na" title={m.note}>n/a</span>;
  }
  return (
    <span className={`metric metric--${size} metric--${m.state}`}>
      {body}
      {showLabel && <span className="metric__label">{m.label}</span>}
    </span>
  );
}

function formatNumber(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function SourceLine({ source, now, reportLabel }: { source: ApiSource; now: Date; reportLabel?: string }) {
  return (
    <div className="source-line">
      <FreshnessBadge freshness={source.freshness} />
      <span>
        {reportLabel ?? "Source time"}: <strong>{source.sourceUpdatedAt ? formatDenver(source.sourceUpdatedAt, now) : "unknown"}</strong>
      </span>
      <span>
        Last successful check: <strong>{formatAge(source.lastSuccessfulFetchAt, now)}</strong>
      </span>
      {source.status === "error" && source.lastError && (
        <span className="source-line__error" title={source.lastError}>
          Last attempt failed {formatAge(source.lastAttemptAt, now)}
        </span>
      )}
      <span className="source-line__attr">{source.attribution}</span>
    </div>
  );
}

export function StatusDot({ status }: { status: LiftStatus }) {
  return <span className={`dot dot--${status}`} aria-hidden="true" />;
}

export function Unavailable({ source, what }: { source: ApiSource; what: string }) {
  return (
    <div className="unavailable">
      <h2>{what} unavailable</h2>
      <p>{source.freshnessNote}</p>
      {source.lastError && <p className="muted">Last error: {source.lastError}</p>}
    </div>
  );
}
