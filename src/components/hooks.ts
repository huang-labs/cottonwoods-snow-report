"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportResponse } from "@/lib/types";

export interface ReportState {
  report: ReportResponse | null;
  /** Browser time of the last successful /api/report load. */
  loadedAt: number | null;
  error: string | null;
}

/** Polls the stored snapshot on load and every `intervalMs`, shared by every page. */
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
