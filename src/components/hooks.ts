"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportResponse } from "@/lib/types";

/**
 * Advances the slideshow after `durationMs`. Only slide index, play state and
 * duration affect the timer — data refreshes never reset it. Pausing keeps the
 * remaining time so resume continues where it stopped.
 */
export function useSlideTimer(index: number, playing: boolean, durationMs: number, onAdvance: () => void) {
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;
  const keyRef = useRef({ index, durationMs });
  const remainingRef = useRef(durationMs);

  useEffect(() => {
    if (keyRef.current.index !== index || keyRef.current.durationMs !== durationMs) {
      keyRef.current = { index, durationMs };
      remainingRef.current = durationMs;
    }
    if (!playing) return;
    const started = Date.now();
    const timer = setTimeout(() => {
      remainingRef.current = durationMs;
      advanceRef.current();
    }, remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - started));
    };
  }, [index, playing, durationMs]);
}

export interface ReportState {
  report: ReportResponse | null;
  /** Browser time of the last successful /api/report load. */
  loadedAt: number | null;
  error: string | null;
}

/** Polls the stored snapshot on load and every `intervalMs`, independent of slides. */
export function useReport(intervalMs = 60_000, fetchImpl: typeof fetch = (...a) => fetch(...a)): ReportState {
  const [state, setState] = useState<ReportState>({ report: null, loadedAt: null, error: null });
  const fetchRef = useRef(fetchImpl);

  const load = useCallback(async () => {
    try {
      const res = await fetchRef.current("/api/report", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report = (await res.json()) as ReportResponse;
      setState({ report, loadedAt: Date.now(), error: null });
    } catch (err) {
      // Keep the last good report; surface the failure.
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  // Until a first report arrives, retry sooner than the regular interval.
  useEffect(() => {
    if (state.report || !state.error) return;
    const retry = setTimeout(() => void load(), Math.min(5_000, intervalMs));
    return () => clearTimeout(retry);
  }, [state.report, state.error, load, intervalMs]);

  return state;
}

/** Re-render periodically so relative ages ("5 min ago") stay correct. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ---------- Preferences (browser-local) ----------

export interface Prefs {
  durationSec: number;
  /** Set after the first explicit start so unattended reloads resume playback. */
  autoplay: boolean;
}

export const DEFAULT_PREFS: Prefs = { durationSec: 20, autoplay: false };
export const PREFS_KEY = "cottonwoods-snow-report.prefs.v1";
export const DURATION_CHOICES = [10, 15, 20, 30, 45, 60, 90, 120];

export function loadPrefs(storage: Pick<Storage, "getItem"> | undefined): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<Prefs>;
    const durationSec = typeof p.durationSec === "number" && p.durationSec >= 5 && p.durationSec <= 600 ? p.durationSec : DEFAULT_PREFS.durationSec;
    return { durationSec, autoplay: p.autoplay === true };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(storage: Pick<Storage, "setItem"> | undefined, prefs: Prefs) {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage may be unavailable (private mode / TV browser restrictions).
  }
}
