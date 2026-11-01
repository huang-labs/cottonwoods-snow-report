"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SECTIONS } from "@/lib/sections";
import { formatDenver } from "@/lib/time";
import { DataBanners, requestFullscreen, useDashboard } from "./dashboard-context";
import { DURATION_CHOICES, useSlideTimer } from "./hooks";
import { renderSection } from "./SectionView";

/**
 * Full-screen rotating slideshow (TV mode). Remote arrows/Enter arrive as
 * keyboard events. Leaving fullscreen, Escape or the Exit button returns to
 * browse mode on the page of the current slide.
 */
export function Slideshow({
  initialIndex,
  initialPlaying,
  durationSec,
  onDurationChange,
  onExit,
}: {
  initialIndex: number;
  initialPlaying: boolean;
  durationSec: number;
  onDurationChange: (sec: number) => void;
  onExit: (index: number) => void;
}) {
  const data = useDashboard();
  const { report, loadedAt, error, now } = data;
  const [playing, setPlaying] = useState(initialPlaying);
  const [index, setIndex] = useState(initialIndex);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const pointerQuietUntil = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;
  const exit = useCallback(() => onExit(indexRef.current), [onExit]);

  const durationMs = durationSec * 1000;
  const next = useCallback(() => setIndex((i) => (i + 1) % SECTIONS.length), []);
  const prev = useCallback(() => setIndex((i) => (i - 1 + SECTIONS.length) % SECTIONS.length), []);
  useSlideTimer(index, playing, durationMs, next);

  const poke = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 5000);
  }, []);

  // Manual hide: drop focus (focus-within would keep the bar visible) and
  // ignore pointer jitter briefly so the click itself doesn't re-show it.
  const hideControls = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    (document.activeElement as HTMLElement | null)?.blur();
    pointerQuietUntil.current = Date.now() + 1000;
    setControlsVisible(false);
  }, []);

  useEffect(() => {
    poke();
    const onMove = () => {
      if (Date.now() < pointerQuietUntil.current) return;
      poke();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [poke]);

  // Leaving fullscreen (browser Esc, system gesture) also leaves the slideshow.
  // Windowed slideshows (kiosk bookmark, refused fullscreen) are unaffected.
  useEffect(() => {
    let wasFullscreen = Boolean(document.fullscreenElement);
    const onChange = () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const isFullscreen = Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement);
      if (wasFullscreen && !isFullscreen) exit();
      wasFullscreen = isFullscreen;
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [exit]);

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
        case "Escape":
          exit();
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
  }, [next, prev, poke, exit]);

  // Roving focus inside the control bar: Left/Right move focus, Escape/Back leaves the bar.
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

  const slide = SECTIONS[index];

  return (
    <div className={`app app--slideshow ${controlsVisible ? "" : "app--idle"}`}>
      <main className="stage" aria-live="off">
        {report ? (
          <div key={slide.id} className="slide-wrap">
            {renderSection(slide.id, report, now, loadedAt)}
          </div>
        ) : (
          <div className="loading">{error ? `Could not load report: ${error}` : "Loading report…"}</div>
        )}
      </main>

      <DataBanners data={data} overlay />

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
          {SECTIONS.map((s, i) => (
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
          <select value={durationSec} onChange={(e) => onDurationChange(Number(e.target.value))}>
            {DURATION_CHOICES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={requestFullscreen}>Fullscreen</button>
        <span className="controls__status">
          {report ? `Data ${formatDenver(report.generatedAt, now)}` : ""}
        </span>
        <button type="button" className="controls__exit" onClick={exit}>Exit slideshow</button>
        <button type="button" className="controls__hide" onClick={hideControls} aria-label="Hide controls" title="Hide controls">
          ✕
        </button>
      </div>
    </div>
  );
}
