// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RegionalPage } from "@/components/sections/RegionalPage";
import { buildReport } from "@/lib/report";
import type { Freshness, ReportResponse } from "@/lib/types";

const now = new Date("2026-12-01T15:00:00Z");
afterEach(cleanup);

function withFreshness(states: Record<"alta" | "snowbird" | "solitude" | "brighton", Freshness>): ReportResponse {
  const report = buildReport(null, now);
  for (const [id, f] of Object.entries(states)) report.sources[id as keyof typeof states].freshness = f;
  return report;
}

const statusLine = () => document.querySelector(".page--regional > .source-line");

it("keeps freshness out of the resort rows", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "old-report", solitude: "stale", brighton: "unavailable" })} />);
  expect(document.querySelector(".snow-table .badge:not(.badge--ai)")).toBeNull();
});

it("shows one Current badge and 'All resorts reporting' when every resort is current", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "current", solitude: "current", brighton: "current" })} />);
  const line = statusLine();
  expect(line?.querySelectorAll(".badge")).toHaveLength(1);
  expect(line?.querySelector(".badge--current")?.textContent).toBe("Current");
  expect(line?.textContent).toContain("All resorts reporting");
});

it("badges the worst state and names the resorts in each state", () => {
  render(<RegionalPage now={now} report={withFreshness({ alta: "current", snowbird: "old-report", solitude: "current", brighton: "old-report" })} />);
  const line = statusLine();
  expect(line?.querySelector(".badge--old-report")?.textContent).toBe("Old report");
  expect(line?.textContent).toBe("Old reportSnowbird, BrightonCurrent: Alta, Solitude");
  expect(line?.textContent).toContain("Current: Alta, Solitude");
  expect(line?.textContent).not.toContain("All resorts reporting");
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
  expect(line?.textContent).toBe("UnavailableAlta, Snowbird, Solitude, Brighton");
});
