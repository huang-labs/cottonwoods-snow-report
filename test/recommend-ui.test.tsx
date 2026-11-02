// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RegionalSlide } from "@/components/slides/RegionalSlide";
import { buildReport } from "@/lib/report";
import type { ApiRecommendation } from "@/lib/types";

const now = new Date("2026-12-01T15:00:00Z");
const recommendation: ApiRecommendation = {
  targetDate: "2026-12-01", pick: "alta", mode: "storm", plan: "Wait for the estimated 9:30 AM road opening.", headline: "Alta for deep powder", summary: "Alta got 18″ overnight. LCC has a posted opening estimate.", caveats: ["Opening time may slip"], runnerUp: "solitude", generatedAt: now.toISOString(), model: "test-model", trigger: "critical-change", outdated: false, failing: false,
};
afterEach(cleanup);

it("integrates the pick into the resort's table row with reasoning beneath it", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation }} />);
  const row = screen.getByText("AI pick").closest("tr");
  expect(row?.textContent).toContain("Alta");
  const reasoning = screen.getByRole("generic", { name: "AI recommendation reasoning" });
  expect(reasoning.textContent).toContain(recommendation.headline);
  expect(reasoning.textContent).toContain(recommendation.summary!);
  expect(reasoning.textContent).toContain(recommendation.plan);
  expect(reasoning.textContent).toContain(recommendation.caveats[0]);
  expect(reasoning.textContent).toContain("test-model");
  expect(reasoning.textContent).toContain("For 2026-12-01");
  // The reasoning row follows the picked resort's data row.
  expect(document.querySelector(".recommendation-row")?.previousElementSibling).toBe(row);
});

it("falls back to the plan text when no summary was written", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation: { ...recommendation, summary: undefined } }} />);
  const reasoning = screen.getByRole("generic", { name: "AI recommendation reasoning" });
  expect(reasoning.textContent).toContain(recommendation.plan);
  expect(reasoning.textContent).not.toContain("Model not recorded");
});

it("shows nothing when no resort is picked", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation: { ...recommendation, pick: null, headline: "No pick: all resorts closed" } }} />);
  expect(screen.queryByRole("generic", { name: "AI recommendation reasoning" })).toBeNull();
  expect(screen.queryByText("AI pick")).toBeNull();
  expect(screen.queryByText("No pick: all resorts closed")).toBeNull();
});

it("retains stale output with a warning and removes the row endorsement", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation: { ...recommendation, outdated: true, failing: true } }} />);
  expect(screen.getByText(/Outdated.*Updates failing/)).toBeTruthy();
  expect(screen.getByText("Alta for deep powder")).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});
