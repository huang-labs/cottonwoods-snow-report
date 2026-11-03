// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RegionalPage } from "@/components/sections/RegionalPage";
import { buildReport } from "@/lib/report";

const now = new Date("2026-12-01T15:00:00Z");
afterEach(cleanup);

function rowFor(name: string) {
  return [...document.querySelectorAll(".snow-table tbody tr.row--primary")].find((tr) => tr.querySelector("th")?.textContent?.includes(name));
}

it("shows a resort's freshness badge only when its report isn't current", () => {
  const report = buildReport(null, now);
  report.sources.alta.freshness = "current";
  report.sources.snowbird.freshness = "old-report";
  report.sources.solitude.freshness = "stale";
  report.sources.brighton.freshness = "current";
  render(<RegionalPage now={now} report={report} />);

  expect(rowFor("Alta")?.querySelector("th .badge")).toBeNull();
  expect(rowFor("Brighton")?.querySelector("th .badge")).toBeNull();
  expect(rowFor("Snowbird")?.querySelector("th .badge--old-report")?.textContent).toBe("Old report");
  expect(rowFor("Solitude")?.querySelector("th .badge--stale")?.textContent).toBe("Stale — source failing");
  expect(document.querySelector(".snow-table .badge--current")).toBeNull();
});

it("badges an unavailable resort", () => {
  render(<RegionalPage now={now} report={buildReport(null, now)} />);
  expect(rowFor("Alta")?.querySelector("th .badge--unavailable")?.textContent).toBe("Unavailable");
});
