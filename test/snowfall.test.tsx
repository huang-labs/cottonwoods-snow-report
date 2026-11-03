// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { snowfallDays } from "@/components/snowfall/model";
import { SnowfallChart } from "@/components/snowfall/SnowfallChart";
const bar = (start: string, snowIn = 0.1) => ({ start, snowIn, snowLevelFt: null });
afterEach(cleanup);
it("preserves totals and marks missing dates rather than synthesizing zeros", () => {
  const days = snowfallDays([bar("2026-11-02T18:00:00Z"), bar("2026-11-04T18:00:00Z", 0)]);
  expect(days.map(d => d.count)).toEqual([1, 0, 1]);
  expect(days.map(d => d.total)).toEqual([0.1, 0, 0]);
  expect(days.every(d => d.partial)).toBe(true);
});
it("groups DST periods by Denver start date without splitting or losing amounts", () => {
  const bars = Array.from({length: 16}, (_, i) => bar(new Date(Date.parse('2026-10-31T00:00:00Z') + i * 21600000).toISOString(), 1));
  const days = snowfallDays(bars);
  expect(days.reduce((n,d) => n + d.total, 0)).toBe(16);
  expect(days.find(d => d.key === '2026-11-01')?.partial).toBe(false);
});
it("renders small amounts, zeros, missing data and readable optional detail", () => {
  render(<SnowfallChart bars={[bar('2026-11-02T18:00:00Z'), bar('2026-11-04T18:00:00Z', 0)]} label="Forecast" detail />);
  expect(screen.getAllByText('0.1″')).toHaveLength(2);
  expect(screen.getAllByText('0.0″')).toHaveLength(2);
  expect(screen.getByText('—')).toBeTruthy();
  expect(screen.getByText('Six-hour amounts and times')).toBeTruthy();
});
it("handles an unavailable forecast", () => {
  render(<SnowfallChart bars={[]} label="Forecast" />);
  expect(screen.getByText('Snowfall forecast unavailable.')).toBeTruthy();
});
