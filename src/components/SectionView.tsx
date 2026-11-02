"use client";

import type { ReportResponse, SourceId } from "@/lib/types";
import { useDashboard } from "./dashboard-context";
import { DailySnowPage } from "./dailysnow/DailySnow";
import { PlumesPage } from "./sections/PlumesPage";
import { RegionalPage } from "./sections/RegionalPage";
import { ResortReportPage } from "./sections/ResortReportPage";
import { RoadsPage } from "./sections/RoadsPage";
import { WeatherPage } from "./sections/WeatherPage";

export function renderSection(id: string, report: ReportResponse, now: Date, loadedAt: number | null) {
  switch (id) {
    case "regional":
      return <RegionalPage report={report} now={now} />;
    case "daily-snow":
      return <DailySnowPage report={report} now={now} />;
    case "weather":
      return <WeatherPage source={report.sources.nws} now={now} />;
    case "plumes":
      return <PlumesPage source={report.sources.plumes} now={now} />;
    case "traffic":
      return <RoadsPage report={report} now={now} loadedAt={loadedAt} />;
    default:
      return <ResortReportPage source={report.sources[id as SourceId]} now={now} cams={report.sources.resortcams} loadedAt={loadedAt} />;
  }
}

/** One section as a page. Data comes from the shell's shared poller. */
export function SectionView({ id }: { id: string }) {
  const { report, loadedAt, error, now } = useDashboard();
  if (!report) return <div className="loading">{error ? `Could not load report: ${error}` : "Loading report…"}</div>;
  return (
    <div key={id}>
      {renderSection(id, report, now, loadedAt)}
    </div>
  );
}
