// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { snowfallDays, zonedTimeLabel } from "@/components/snowfall/model";
import { SnowfallChart } from "@/components/snowfall/SnowfallChart";
const bar = (start: string, snowIn = 0.1) => ({ start, snowIn, snowLevelFt: null });
afterEach(cleanup);
it("pads partial days and missing dates without synthesizing zeros or summing periods", () => {
  const days = snowfallDays([bar("2026-11-04T18:00:00Z", 0), bar("2026-11-02T18:00:00Z")]);
  expect(days.map(d => d.slots.length)).toEqual([4, 4, 4]);
  expect(days[0].slots.map(s => s.snowIn)).toEqual([null, 0.1, null, null]);
  expect(days[1].slots.every(s => s.snowIn === null)).toBe(true);
  expect(days[2].slots.map(s => s.snowIn)).toEqual([null, 0, null, null]);
});
it.each(['2026-03-07T00:00:00Z', '2026-10-31T00:00:00Z'])("preserves every six-hour period across DST from %s", start => {
  const bars = Array.from({length: 16}, (_, i) => bar(new Date(Date.parse(start) + i * 21600000).toISOString(), i));
  const slots = snowfallDays(bars).flatMap(d => d.slots).filter(s => s.snowIn !== null);
  expect(slots).toEqual(bars.map(({start, snowIn}) => ({start, snowIn})));
  expect(zonedTimeLabel.format(new Date(slots[0].start))).not.toContain(zonedTimeLabel.format(new Date(slots.at(-1)!.start)).split(' ').at(-1));
});
it("renders each amount once, retains blank slots, and exposes a focusable single chart", () => {
  const { container } = render(<SnowfallChart bars={[bar('2026-11-02T18:00:00Z'), bar('2026-11-04T18:00:00Z', 0)]} label="Forecast" />);
  expect(screen.getAllByText('0.1″')).toHaveLength(1);
  expect(screen.getAllByText('0.0″')).toHaveLength(1);
  expect(container.querySelectorAll('.snowfall__period')).toHaveLength(12);
  expect(container.querySelectorAll('.snowfall__bar')).toHaveLength(2);
  expect(container.querySelector('details')).toBeNull();
  expect(screen.getByRole('region').tabIndex).toBe(0);
  expect(screen.getAllByLabelText(/not available/)).toHaveLength(10);
});
it("handles an unavailable forecast", () => {
  render(<SnowfallChart bars={[]} label="Forecast" />);
  expect(screen.getByText('Snowfall forecast unavailable.')).toBeTruthy();
});
