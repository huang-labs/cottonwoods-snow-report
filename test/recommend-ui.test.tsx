// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { RegionalSlide } from "@/components/slides/RegionalSlide";
import { buildReport } from "@/lib/report";
import type { ApiRecommendation } from "@/lib/types";

const now = new Date("2026-12-01T15:00:00Z");
const recommendation: ApiRecommendation = {
  targetDate: "2026-12-01", pick: "alta", mode: "storm", plan: "Wait for the estimated 9:30 AM road opening.", headline: "Alta for deep powder", reasons: ["18″ overnight", "LCC opening estimate posted"], caveats: ["Opening time may slip"], runnerUp: "solitude", generatedAt: now.toISOString(), model: "test-model", trigger: "critical-change", outdated: false, failing: false,
};
afterEach(cleanup);
it("shows today's card, conditional plan, backup and recommended row", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation }} />);
  expect(screen.getByText(/AI ski recommendation · Today's resort pick/)).toBeTruthy();
  expect(screen.getByText(recommendation.plan)).toBeTruthy();
  expect(screen.getByText(/Backup: Solitude/)).toBeTruthy();
  expect(screen.getByText("AI pick").closest("tr")?.textContent).toContain("Alta");
});
it("labels tomorrow and explicitly shows no pick", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation: { ...recommendation, targetDate: "2026-12-02", pick: null, headline: "No pick: all resorts closed" } }} />);
  expect(screen.getByText(/AI ski recommendation · Tomorrow's resort pick/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "No pick: all resorts closed" })).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});
it("retains stale output with a warning and removes the row endorsement", () => {
  render(<RegionalSlide now={now} report={{ ...buildReport(null, now), recommendation: { ...recommendation, outdated: true, failing: true } }} />);
  expect(screen.getByText(/Outdated.*Updates failing/)).toBeTruthy();
  expect(screen.getByText("Alta for deep powder")).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});
