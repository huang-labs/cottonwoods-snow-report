"use client";

import { createContext, useContext } from "react";
import type { ReportResponse } from "@/lib/types";
import { formatAge } from "@/lib/time";

export interface DashboardData {
  report: ReportResponse | null;
  loadedAt: number | null;
  error: string | null;
  now: Date;
}

export const DashboardContext = createContext<DashboardData | null>(null);

/** Report data shared by every page and the slideshow (one poller for the whole app). */
export function useDashboard(): DashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside <AppShell>");
  return ctx;
}

export function requestFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return;
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => undefined);
  else el.webkitRequestFullscreen?.();
}

export function exitFullscreen() {
  const doc = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element | null };
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  else if (doc.webkitFullscreenElement) doc.webkitExitFullscreen?.();
}

/** Notices about the dashboard's own data path, shown in both modes. */
export function DataBanners({ data, overlay }: { data: DashboardData; overlay: boolean }) {
  const { report, loadedAt, error, now } = data;
  const apiStale = loadedAt !== null && now.getTime() - loadedAt > 3 * 60_000;
  const mod = overlay ? " banner--overlay" : "";
  return (
    <>
      {(error || apiStale) && report && (
        <div className={`banner banner--offline${mod}`} role="status">
          Dashboard can’t reach its server ({error ?? "no response"}). Showing data loaded {formatAge(new Date(loadedAt!).toISOString(), now)}.
        </div>
      )}
      {report && report.requiredMissing.length > 0 && (
        <div className={`banner banner--required-missing${mod}`} role="status">
          Required feeds unavailable: {report.requiredMissing.map((id) => report.sources[id].label).join(", ")}
        </div>
      )}
    </>
  );
}
