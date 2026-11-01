"use client";

import type { ReportResponse, SourceId } from "@/lib/types";
import { useDashboard } from "./dashboard-context";
import { PlumeSlide } from "./slides/PlumeSlide";
import { RegionalSlide } from "./slides/RegionalSlide";
import { ResortSlide } from "./slides/ResortSlide";
import { TrafficSlide } from "./slides/TrafficSlide";
import { WeatherSlide } from "./slides/WeatherSlide";

export function renderSection(id: string, report: ReportResponse, now: Date, loadedAt: number | null) {
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

/** One section as a page (browse mode). Data comes from the shell's shared poller. */
export function SectionView({ id }: { id: string }) {
  const { report, loadedAt, error, now } = useDashboard();
  if (!report) return <div className="loading">{error ? `Could not load report: ${error}` : "Loading report…"}</div>;
  return (
    <div key={id} className="slide-wrap">
      {renderSection(id, report, now, loadedAt)}
    </div>
  );
}
