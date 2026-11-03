"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SixHourSnow } from "@/lib/types";

const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
/** First point of each Mountain Time calendar day (robust across DST). */
const newDay = (xs: Array<{ start: string }>, i: number) =>
  i === 0 || dayKeyFmt.format(new Date(xs[i].start)) !== dayKeyFmt.format(new Date(xs[i - 1].start));

/**
 * Draws its chart at the container's measured width, so one SVG unit is one CSS
 * pixel: text stays 12px and bars stay proportionate on phones and desktops, with
 * no horizontal scrolling. Before the first measurement it assumes a desktop width.
 */
function Chart({ label, height, children }: { label: string; height: number; children: (width: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
        {children(width)}
      </svg>
    </div>
  );
}

const TOP = 20; // room for value labels above the tallest bar
const AXIS = 24; // day labels under the axis

/** NWS 6-hour snowfall bars, a day label at each Mountain Time midnight. */
export function SnowBars({ bars, label }: { bars: SixHourSnow[]; label: string }) {
  const maxSnow = Math.max(4, ...bars.map((b) => b.snowIn));
  return (
    <Chart label={label} height={TOP + 120 + AXIS}>
      {(w) => {
        const bw = w / Math.max(1, bars.length);
        const gap = bw > 12 ? 2 : 1;
        const small = bw < 18; // narrow bars: labels stay on at a smaller size
        const top = small ? 28 : TOP; // headroom for the staggered second label row
        const h = small ? 112 : 120; // top + h stays 140, so the axis and day labels don't move
        return (
          <>
            {bars.map((b, i) => {
              const bh = (b.snowIn / maxSnow) * h;
              const lift = small && bw < 15 && i % 2 ? 11 : 0; // stagger rows when labels are wider than their slot
              return (
                <g key={b.start}>
                  {newDay(bars, i) && i * bw + 30 <= w && (
                    <>
                      <line x1={i * bw} x2={i * bw} y1={top} y2={top + h} className="chart__grid" />
                      <text x={i * bw + 4} y={top + h + 17} className="chart__label">{dayFmt.format(new Date(b.start))}</text>
                    </>
                  )}
                  <rect x={i * bw + gap} y={top + h - bh} width={bw - 2 * gap} height={Math.max(bh, b.snowIn > 0 ? 2 : 0)} className="chart__bar" />
                  {b.snowIn >= 0.5 && (
                    <text
                      x={i * bw + bw / 2}
                      y={top + h - bh - 4 - lift}
                      textAnchor="middle"
                      className={small ? "chart__value chart__value--sm" : "chart__value"}
                    >
                      {b.snowIn.toFixed(1)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={0} x2={w} y1={top + h} y2={top + h} className="chart__axis" />
          </>
        );
      }}
    </Chart>
  );
}

export interface SnowLevelSeries {
  canyon: string;
  points: Array<{ start: string; ft: number }>;
}

/** Forecast snow level, one line per canyon (CSS colors each canyon). */
export function SnowLevel({ series, label }: { series: SnowLevelSeries[]; label: string }) {
  const h = 120;
  const gutter = 44; // "8k ft" labels
  const all = series.flatMap((s) => s.points);
  const t0 = Math.min(...all.map((p) => Date.parse(p.start)));
  const t1 = Math.max(...all.map((p) => Date.parse(p.start)));
  const lo = Math.floor(Math.min(...all.map((p) => p.ft)) / 1000) * 1000;
  const hi = Math.ceil(Math.max(...all.map((p) => p.ft)) / 1000) * 1000 || lo + 1000;
  const y = (ft: number) => TOP + h - ((ft - lo) / Math.max(1, hi - lo)) * h;
  const ticks: number[] = [];
  for (let ft = lo; ft <= hi; ft += hi - lo > 4000 ? 2000 : 1000) ticks.push(ft);
  const ref = series[0]?.points ?? [];
  return (
    <Chart label={label} height={TOP + h + AXIS}>
      {(w) => {
        const x = (iso: string) => (t1 === t0 ? gutter : ((Date.parse(iso) - t0) / (t1 - t0)) * (w - gutter - 4) + gutter);
        return (
          <>
            {ticks.map((ft) => (
              <g key={ft}>
                <line x1={gutter} x2={w} y1={y(ft)} y2={y(ft)} className="chart__grid" />
                <text x={0} y={y(ft) + 4} className="chart__label">{(ft / 1000).toFixed(0)}k ft</text>
              </g>
            ))}
            {ref.map((p, i) => newDay(ref, i) && x(p.start) + 30 <= w && (
              <text key={p.start} x={x(p.start) + 4} y={TOP + h + 17} className="chart__label">{dayFmt.format(new Date(p.start))}</text>
            ))}
            {series.map((s) => (
              <polyline key={s.canyon} className={`snow-level__line snow-level__line--${s.canyon.toLowerCase()}`} points={s.points.map((p) => `${x(p.start)},${y(p.ft)}`).join(" ")} />
            ))}
          </>
        );
      }}
    </Chart>
  );
}
