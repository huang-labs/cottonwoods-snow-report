"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ReportResponse, ResortReport, RoadsPayload, SourceId } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";
import { DURATION_CHOICES, loadPrefs, savePrefs, useNow, useReport, useSlideTimer, type Prefs } from "./hooks";
import { PlumeSlide } from "./slides/PlumeSlide";
import { RegionalSlide } from "./slides/RegionalSlide";
import { ResortSlide } from "./slides/ResortSlide";
import { TrafficSlide } from "./slides/TrafficSlide";
import { WeatherSlide } from "./slides/WeatherSlide";

export interface SlideDef {
  id: string;
  title: string;
}

export const SLIDES: SlideDef[] = [
  { id: "regional", title: "Regional snowfall" },
  { id: "weather", title: "Mountain weather" },
  { id: "plumes", title: "Ensemble plumes" },
  { id: "traffic", title: "Canyon roads" },
  { id: "alta", title: "Alta" },
  { id: "snowbird", title: "Snowbird" },
  { id: "solitude", title: "Solitude" },
  { id: "brighton", title: "Brighton" },
];

/** Critical road/closure notices that persist across every slide. */
export function criticalNotices(report: ReportResponse): Array<{ title: string; text: string; source: string }> {
  const out: Array<{ title: string; text: string; source: string }> = [];
  const roads = report.sources.roads?.payload as RoadsPayload | null;
  for (const n of roads?.notices ?? []) {
    if (n.severity === "critical" && (n.canyon === "LCC" || n.canyon === "BCC" || n.canyon === "both")) {
      out.push({ title: n.title, text: n.text, source: n.source });
    }
  }
  for (const id of ["alta", "snowbird", "solitude", "brighton"] as SourceId[]) {
    const r = report.sources[id]?.payload as ResortReport | null;
    for (const n of r?.notices ?? []) {
      if (n.severity === "critical") out.push({ title: `${report.sources[id].label} — ${n.title}`, text: n.text, source: report.sources[id].label });
    }
  }
  return out;
}

function renderSlide(id: string, report: ReportResponse, now: Date, loadedAt: number | null) {
  switch (id) {
    case "regional":
      return <RegionalSlide report={report} now={now} />;
    case "weather":
      return <WeatherSlide source={report.sources.nws} now={now} />;
    case "plumes":
      return <PlumeSlide source={report.sources.plumes} now={now} />;
    case "traffic":
      return <TrafficSlide report={report} now={now} loadedAt={loadedAt} />;
    default:
      return <ResortSlide source={report.sources[id as SourceId]} now={now} cams={report.sources.resortcams} loadedAt={loadedAt} />;
  }
}

function requestFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
  else el.webkitRequestFullscreen?.();
}

export default function Dashboard() {
  const { report, loadedAt, error } = useReport(60_000);
  const now = useNow(30_000);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);

  // Preferences load after mount (localStorage is browser-only).
  // URL options: ?slide=<id> picks the first slide; ?kiosk=1 starts playback
  // without the start screen (for a TV bookmark; fullscreen still needs a gesture).
  useEffect(() => {
    const p = loadPrefs(window.localStorage);
    setPrefs(p);
    const params = new URLSearchParams(window.location.search);
    const initial = SLIDES.findIndex((s) => s.id === params.get("slide"));
    if (initial >= 0) setIndex(initial);
    if (p.autoplay || params.get("kiosk") === "1") {
      setStarted(true);
      setPlaying(params.get("paused") !== "1");
    }
  }, []);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...(p ?? loadPrefs(undefined)), ...patch };
      savePrefs(window.localStorage, next);
      return next;
    });
  }, []);

  const durationMs = (prefs?.durationSec ?? 20) * 1000;
  const next = useCallback(() => setIndex((i) => (i + 1) % SLIDES.length), []);
  const prev = useCallback(() => setIndex((i) => (i - 1 + SLIDES.length) % SLIDES.length), []);
  useSlideTimer(index, playing, durationMs, next);

  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 5000);
  }, []);

  useEffect(() => {
    poke();
    const onMove = () => poke();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
    };
  }, [poke]);

  const start = useCallback(
    (fullscreen: boolean) => {
      if (fullscreen) requestFullscreen();
      setStarted(true);
      setPlaying(true);
      updatePrefs({ autoplay: true });
      poke();
    },
    [poke, updatePrefs],
  );

  // Global keys (TV remote arrows/enter arrive as keyboard events).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      poke();
      const inControls = controlsRef.current?.contains(document.activeElement) ?? false;
      if (inControls) return; // Controls handle their own keys.
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case "MediaTrackNext":
          next();
          e.preventDefault();
          break;
        case "ArrowLeft":
        case "PageUp":
        case "MediaTrackPrevious":
          prev();
          e.preventDefault();
          break;
        case " ":
        case "k":
        case "MediaPlayPause":
          setPlaying((p) => !p);
          e.preventDefault();
          break;
        case "MediaPlay":
          setPlaying(true);
          break;
        case "MediaPause":
          setPlaying(false);
          break;
        case "f":
          requestFullscreen();
          break;
        case "ArrowUp":
        case "ArrowDown":
        case "Enter":
          // Bring up the controls and focus play/pause.
          controlsRef.current?.querySelector<HTMLButtonElement>("[data-primary]")?.focus();
          e.preventDefault();
          break;
        default:
          if (/^[1-8]$/.test(e.key)) setIndex(Number(e.key) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, poke]);

  // Roving focus inside the control bar: Left/Right move focus, Escape leaves.
  const onControlsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(controlsRef.current?.querySelectorAll<HTMLElement>("button, select") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowRight" && document.activeElement?.tagName !== "SELECT") {
      items[(i + 1) % items.length]?.focus();
      e.preventDefault();
    } else if (e.key === "ArrowLeft" && document.activeElement?.tagName !== "SELECT") {
      items[(i - 1 + items.length) % items.length]?.focus();
      e.preventDefault();
    } else if (e.key === "Escape" || e.key === "XF86Back" || e.key === "GoBack") {
      (document.activeElement as HTMLElement | null)?.blur();
      setControlsVisible(false);
    }
  };

  const banner = useMemo(() => (report ? criticalNotices(report) : []), [report]);
  const slide = SLIDES[index];
  const apiStale = loadedAt !== null && now.getTime() - loadedAt > 3 * 60_000;

  return (
    <div className={`app ${controlsVisible ? "" : "app--idle"}`}>
      {banner.length > 0 && (
        <div className="closure-banner" role="alert">
          {banner.map((b, i) => (
            <span key={i}>
              <strong>{b.title}:</strong> {b.text}
            </span>
          ))}
        </div>
      )}

      <main className="stage" aria-live="off">
        {report ? (
          <div key={slide.id} className="slide-wrap">
            {renderSlide(slide.id, report, now, loadedAt)}
          </div>
        ) : (
          <div className="loading">{error ? `Could not load report: ${error}` : "Loading report…"}</div>
        )}
      </main>

      {(error || apiStale) && report && (
        <div className="offline">
          Dashboard can’t reach its server ({error ?? "no response"}). Showing data loaded {formatAge(new Date(loadedAt!).toISOString(), now)}.
        </div>
      )}

      {report && report.requiredMissing.length > 0 && (
        <div className="required-missing">Required feeds unavailable: {report.requiredMissing.map((id) => report.sources[id].label).join(", ")}</div>
      )}

      <div
        ref={controlsRef}
        className={`controls ${controlsVisible ? "" : "controls--hidden"}`}
        role="toolbar"
        aria-label="Slideshow controls"
        onKeyDown={onControlsKey}
        onFocus={() => setControlsVisible(true)}
      >
        <div className="progress" aria-hidden="true">
          <div
            key={`${index}-${durationMs}`}
            className="progress__bar"
            style={{ animationDuration: `${durationMs}ms`, animationPlayState: playing ? "running" : "paused" }}
          />
        </div>
        <button type="button" onClick={prev} aria-label="Previous slide">◀</button>
        <button type="button" data-primary onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <button type="button" onClick={next} aria-label="Next slide">▶</button>
        <div className="slide-picker" role="group" aria-label="Choose slide">
          {SLIDES.map((s, i) => (
            <button
              type="button"
              key={s.id}
              className={i === index ? "is-current" : ""}
              aria-current={i === index ? "true" : undefined}
              onClick={() => setIndex(i)}
              title={s.title}
            >
              {s.title}
            </button>
          ))}
        </div>
        <label className="duration">
          <span>Seconds per slide</span>
          <select value={prefs?.durationSec ?? 20} onChange={(e) => updatePrefs({ durationSec: Number(e.target.value) })}>
            {DURATION_CHOICES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={requestFullscreen}>Fullscreen</button>
        <button type="button" onClick={() => updatePrefs({ autoplay: !(prefs?.autoplay ?? false) })} aria-pressed={prefs?.autoplay ?? false}>
          Autoplay on load: {prefs?.autoplay ? "on" : "off"}
        </button>
        <span className="controls__status">
          {report ? `Data ${formatDenver(report.generatedAt, now)}` : ""}
        </span>
      </div>

      {prefs && !started && (
        <div className="start" role="dialog" aria-modal="true" aria-label="Start slideshow">
          <h1>Cottonwoods Snow Report</h1>
          <p>Rotating conditions dashboard. Collection runs every 5 minutes; this screen refreshes its data every minute.</p>
          <div className="start__buttons">
            <button type="button" autoFocus onClick={() => start(true)}>Start fullscreen</button>
            <button type="button" onClick={() => start(false)}>Start in window</button>
          </div>
          <p className="muted small">Starting enables autoplay on future loads of this browser. Keys: ←/→ change slide, Space pause, F fullscreen, ↑/Enter controls.</p>
        </div>
      )}
    </div>
  );
}

