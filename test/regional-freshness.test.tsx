// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RegionalPage } from "@/components/sections/RegionalPage";
import { summarizeFreshness } from "@/components/sections/freshness-summary";
import { buildReport } from "@/lib/report";
import type { Freshness, ReportResponse } from "@/lib/types";

const now = new Date("2026-12-01T15:00:00Z");
afterEach(cleanup);

function withFreshness(states: Record<"alta" | "snowbird" | "solitude" | "brighton", Freshness>): ReportResponse {
  const report = buildReport(null, now);
  for (const [id, f] of Object.entries(states)) report.sources[id as keyof typeof states].freshness = f;
  return report;
}

const statusLine = () => document.querySelector(".page--regional > .snow-foot");
/** The footer's freshness text, without the legend on its right. */
const statusText = () => [...(statusLine()?.children ?? [])].filter((e) => !e.classList.contains("snow-foot__legend")).map((e) => e.textContent).join("|");

it("keeps freshness out of the resort rows", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "old-report", solitude: "stale", brighton: "unavailable" })} />);
  expect(document.querySelector(".snow-table .badge:not(.badge--ai)")).toBeNull();
});

it("shows one Current badge and the oldest last successful check when every resort is current", () => {
  const report = withFreshness({ alta: "current", snowbird: "current", solitude: "current", brighton: "current" });
  report.sources.alta.lastSuccessfulFetchAt = "2026-12-01T14:59:00Z";
  report.sources.snowbird.lastSuccessfulFetchAt = "2026-12-01T14:56:00Z";
  report.sources.solitude.lastSuccessfulFetchAt = "2026-12-01T14:58:00Z";
  report.sources.brighton.lastSuccessfulFetchAt = "2026-12-01T14:57:00Z";
  render(<RegionalPage now={now} report={report} />);
  const line = statusLine();
  expect(line?.querySelectorAll(".badge")).toHaveLength(1);
  expect(line?.querySelector(".badge--current")?.textContent).toBe("Current");
  expect(statusText()).toBe("Current|Last successful check: 4 min ago");
});
it("puts the value legend on the right of the same footer line", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "current", solitude: "current", brighton: "current" })} />);
  const legend = statusLine()?.lastElementChild;
  expect(legend?.className).toBe("snow-foot__legend");
  expect(legend?.textContent).toContain("reported zero");
  expect(legend?.textContent).not.toContain("·");
  expect(document.querySelectorAll(".page--regional .source-line")).toHaveLength(1);
});

it("badges the worst state and names the resorts in each state", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "old-report", solitude: "current", brighton: "old-report" })} />);
  const line = statusLine();
  expect(line?.querySelector(".badge--old-report")?.textContent).toBe("Old report");
  expect(statusText()).toBe("Old report|Snowbird, Brighton|Current: Alta, Solitude");
  expect(line?.textContent).toContain("Current: Alta, Solitude");
  expect(line?.textContent).not.toContain("Last successful check");
});

it("orders mixed problems from most to least severe", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "time-unknown", snowbird: "current", solitude: "stale", brighton: "old-report" })} />);
  const line = statusLine();
  expect(line?.querySelectorAll(".badge")).toHaveLength(1);
  expect(line?.querySelector(".badge--stale")).not.toBeNull();
  const text = line?.textContent ?? "";
  expect(line?.textContent).not.toContain("Source failing:");
  const order = ["Solitude", "Old report: Brighton", "Report time unknown: Alta", "Current: Snowbird"].map((t) => text.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

it("marks every resort unavailable when nothing has been collected", () => {
  render(<RegionalPage now={now} report={buildReport(null, now)} />);
  const line = statusLine();
  expect(line?.querySelector(".badge--unavailable")).not.toBeNull();
  expect(statusText()).toBe("Unavailable|Alta, Snowbird, Solitude, Brighton");
});

describe("summarizeFreshness", () => {
  const src = (label: string, freshness: Freshness, lastSuccessfulFetchAt: string | null = "2026-12-01T14:58:00Z") => ({ label, freshness, lastSuccessfulFetchAt });

  it("reports current with no groups beyond Current when every source is current", () => {
    const s = summarizeFreshness([src("A", "current", "2026-12-01T14:58:00Z"), src("B", "current", "2026-12-01T14:51:00Z")]);
    expect(s.worst).toBe("current");
    expect(s.groups).toEqual([{ freshness: "current", labels: ["A", "B"] }]);
    expect(s.oldestCheck).toBe("2026-12-01T14:51:00Z");
  });

  it("orders groups worst first and keeps source order within a group", () => {
    const s = summarizeFreshness([src("A", "time-unknown"), src("B", "old-report"), src("C", "stale"), src("D", "old-report")]);
    expect(s.worst).toBe("stale");
    expect(s.groups.map((g) => [g.freshness, g.labels])).toEqual([["stale", ["C"]], ["old-report", ["B", "D"]], ["time-unknown", ["A"]]]);
  });

  it("has no oldest check when a source was never collected", () => {
    expect(summarizeFreshness([src("A", "current"), src("B", "unavailable", null)]).oldestCheck).toBeNull();
  });
});
