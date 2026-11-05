"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { formatDenver } from "@/lib/time";
import { MetricValue } from "../ui";
import { barLabel, type SnowTimelineModel, type TimelineDay } from "./model";
import "./timeline.css";

const ratio = (v: number, scale: number) => Math.min(v, scale) / scale;

/** A day's plot: the bar, the forecast outline behind it, and the amount just above the taller of them. */
function Plot({ amountIn, forecastIn = null, label, scale }: { amountIn: number | null; forecastIn?: number | null; label: string; scale: number }) {
  const bar = amountIn !== null && amountIn > 0 ? ratio(amountIn, scale) : 0;
  const ghost = forecastIn !== null ? ratio(forecastIn, scale) : 0;
  return (
    <span className="snowtl__plot" aria-hidden="true">
      {forecastIn !== null && <span className="snowtl__ghost" style={{ "--r": ghost } as CSSProperties} />}
      {bar > 0 && <span className={`snowtl__bar${amountIn! > scale ? " snowtl__bar--over" : ""}`} style={{ "--r": bar } as CSSProperties} />}
      {label && (
        <span className={`snowtl__amount${amountIn === 0 ? " snowtl__amount--zero" : ""}`} style={{ "--r": Math.max(bar, ghost) } as CSSProperties}>{label}</span>
      )}
    </span>
  );
}

function amountText(day: TimelineDay): string {
  if (day.amountIn !== null) return barLabel(day.amountIn);
  return day.state === "not_recorded" || day.state === "no_forecast" ? "" : "–";
}

/**
 * Daily snowfall around now: 7 past snow days (each resort's morning report), the
 * latest 24 h figure, and 7 days of NWS forecast. The page supplies the heading and
 * any badges, and a shared `scale` when several timelines are shown together.
 * One tab stop: arrow keys, hover or tap choose a day for the detail line.
 */
export function SnowTimeline({
  model,
  scale,
  label,
  heading,
  meta,
  now,
}: {
  model: SnowTimelineModel;
  scale: number;
  /** Plain-text name for screen readers ("Alta"). */
  label: string;
  heading: ReactNode;
  meta?: ReactNode;
  now: Date;
}) {
  const days = [...model.past, null, ...model.future];
  const today = model.past.length;
  const [selected, setSelected] = useState(today);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const detail = days[selected]?.detail ?? model.last24.detail;
  const m = model.last24.metric;
  const reportTime = model.last24.reportTime ? formatDenver(model.last24.reportTime, now) : "no report";

  const move = (e: KeyboardEvent) => {
    const next = { ArrowLeft: selected - 1, ArrowRight: selected + 1, Home: 0, End: days.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(days.length - 1, next));
    setSelected(i);
    refs.current[i]?.focus();
  };
  const select = (i: number) => ({
    ref: (el: HTMLButtonElement | null) => { refs.current[i] = el; },
    tabIndex: i === selected ? 0 : -1,
    onClick: () => setSelected(i),
    onFocus: () => setSelected(i),
    onMouseEnter: () => setSelected(i),
  });

  return (
    <div className="snowtl">
      <div className="snowtl__head">
        <div className="snowtl__heading">{heading}</div>
        {meta && <div className="snowtl__meta">{meta}</div>}
        <div className="snowtl__now" aria-hidden="true">
          {m ? <MetricValue m={m} size="lg" /> : <span className="metric__na">—</span>}
          <span className="snowtl__now-label">24 h · {reportTime}</span>
        </div>
      </div>
      <div className="snowtl__strip" role="group" aria-label={`${label} snowfall by day: past 7 days, last 24 hours, next 7 days`} onKeyDown={move}>
        <span className="snowtl__span snowtl__span--past" aria-hidden="true">Past 7 days</span>
        <span className="snowtl__span snowtl__span--now" aria-hidden="true">Last 24 h</span>
        <span className="snowtl__span snowtl__span--next" aria-hidden="true">Next 7 days</span>
        {days.map((day, i) =>
          day ? (
            <button
              key={day.key}
              type="button"
              className={`snowtl__day snowtl__day--${day.kind} snowtl__day--${day.state}${day.weekend ? " snowtl__day--weekend" : ""}`}
              aria-label={day.detail}
              {...select(i)}
            >
              <Plot amountIn={day.amountIn} forecastIn={day.forecastIn} label={amountText(day)} scale={scale} />
              <span className="snowtl__weekday" aria-hidden="true">{day.weekday[0]}</span>
              <span className="snowtl__date" aria-hidden="true">{day.dayOfMonth}</span>
            </button>
          ) : (
            <button key="last24" type="button" className="snowtl__day snowtl__day--today" aria-label={model.last24.detail} {...select(i)}>
              <span className="snowtl__compact" aria-hidden="true">
                <Plot amountIn={m?.state === "reported" ? m.value : null} label={m?.state === "reported" ? barLabel(m.value) : "–"} scale={scale} />
                <span className="snowtl__weekday">24h</span>
                <span className="snowtl__date">now</span>
              </span>
              <span className="snowtl__hero" aria-hidden="true">
                {m ? <MetricValue m={m} size="xl" /> : <span className="metric__na">—</span>}
                <span className="snowtl__hero-label">{m?.label ?? "Last 24 h"}</span>
                <span className="snowtl__hero-time">{reportTime}</span>
              </span>
            </button>
          ),
        )}
        <span className="snowtl__source snowtl__source--past" aria-hidden="true">Morning reports</span>
        <span className="snowtl__source snowtl__source--next" aria-hidden="true">NWS forecast · {model.canyon}</span>
      </div>
      <p className="snowtl__detail" aria-live="polite">{detail}</p>
    </div>
  );
}
