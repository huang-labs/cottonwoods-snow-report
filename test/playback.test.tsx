// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard, { criticalNotices, SLIDES } from "@/components/Dashboard";
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, savePrefs, useReport, useSlideTimer } from "@/components/hooks";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { MemoryKV, readSnapshot } from "@/lib/store";
import type { ReportResponse, RoadsPayload } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

let REPORT: ReportResponse;

beforeAll(async () => {
  const kv = new MemoryKV();
  const { fetchImpl } = createFixtureFetch();
  await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl });
  REPORT = buildReport(await readSnapshot(kv), FIXTURE_NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("useSlideTimer", () => {
  beforeEach(() => vi.useFakeTimers());

  it("advances after the configured duration", () => {
    const onAdvance = vi.fn();
    renderHook(({ i }) => useSlideTimer(i, true, 20_000, onAdvance), { initialProps: { i: 0 } });
    vi.advanceTimersByTime(19_999);
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it("is not reset by data refreshes (re-renders with new data)", () => {
    const onAdvance = vi.fn();
    const { rerender } = renderHook(({ data }) => useSlideTimer(0, true, 20_000, () => onAdvance(data)), {
      initialProps: { data: 1 },
    });
    vi.advanceTimersByTime(15_000);
    rerender({ data: 2 }); // polling delivered a new report
    vi.advanceTimersByTime(5_000);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(onAdvance).toHaveBeenCalledWith(2); // latest callback, original schedule
  });

  it("pausing preserves remaining time; changing slide restarts it", () => {
    const onAdvance = vi.fn();
    const { rerender } = renderHook(({ i, playing }) => useSlideTimer(i, playing, 20_000, onAdvance), {
      initialProps: { i: 0, playing: true },
    });
    vi.advanceTimersByTime(12_000);
    rerender({ i: 0, playing: false });
    vi.advanceTimersByTime(60_000);
    expect(onAdvance).not.toHaveBeenCalled();
    rerender({ i: 0, playing: true });
    vi.advanceTimersByTime(8_000);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    rerender({ i: 1, playing: true });
    vi.advanceTimersByTime(19_000);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });
});

describe("useReport polling", () => {
  it("polls every minute and keeps the last good report on failure", async () => {
    vi.useFakeTimers();
    let fail = false;
    const fetchImpl = vi.fn(async () => (fail ? new Response("x", { status: 500 }) : Response.json(REPORT)));
    const { result } = renderHook(() => useReport(60_000, fetchImpl as unknown as typeof fetch));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.current.report?.sources.alta.label).toBe("Alta");
    fail = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("HTTP 500");
    expect(result.current.report).not.toBeNull();
  });
});

describe("preferences", () => {
  it("round-trips and rejects invalid values", () => {
    savePrefs(window.localStorage, { durationSec: 45, autoplay: true });
    expect(loadPrefs(window.localStorage)).toEqual({ durationSec: 45, autoplay: true });
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 1 }));
    expect(loadPrefs(window.localStorage)).toEqual(DEFAULT_PREFS);
    window.localStorage.setItem(PREFS_KEY, "{not json");
    expect(loadPrefs(window.localStorage)).toEqual(DEFAULT_PREFS);
  });
});

function mockApi(report: ReportResponse) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(report));
}

describe("Dashboard", () => {
  it("shows the start screen until explicitly started, then persists autoplay", async () => {
    mockApi(REPORT);
    render(<Dashboard />);
    const start = await screen.findByRole("button", { name: "Start in window" });
    fireEvent.click(start);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!).autoplay).toBe(true);
    expect(await screen.findByRole("heading", { name: "Regional snowfall" })).toBeTruthy();
  });

  it("renders every agreed slide from real-source fixtures", async () => {
    mockApi(REPORT);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 20, autoplay: true }));
    render(<Dashboard />);
    const expected = ["Regional snowfall", "Cottonwoods mountain weather", "Utah ensemble snow plumes", "Canyon roads", "Alta", "Snowbird", "Solitude", "Brighton"];
    expect(SLIDES).toHaveLength(8);
    for (const [i, title] of expected.entries()) {
      fireEvent.click(screen.getAllByRole("button", { name: SLIDES[i].title }).at(-1)!);
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
    }
    // Plumes: four cropped panels, each with a Mountain Time axis.
    fireEvent.click(screen.getAllByRole("button", { name: "Ensemble plumes" }).at(-1)!);
    expect(await screen.findAllByRole("img", { name: /times in Mountain Time/ })).toHaveLength(4);
    // Traffic slide labels the year-old UDOT travel times as not live.
    fireEvent.click(screen.getAllByRole("button", { name: "Canyon roads" }).at(-1)!);
    expect(screen.getAllByText(/Not live — UDOT’s latest measurement/, { selector: "p" })).toHaveLength(2);
  });

  it("renders explicit unavailable states when nothing has been collected", async () => {
    mockApi(buildReport(null, FIXTURE_NOW));
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 20, autoplay: true }));
    render(<Dashboard />);
    expect(await screen.findByText(/Required feeds unavailable/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Alta" }).at(-1)!);
    expect(await screen.findByText("Alta report unavailable")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Ensemble plumes" }).at(-1)!);
    expect(await screen.findByText("Plume charts unavailable")).toBeTruthy();
  });

  it("keyboard: arrows change slides; space toggles pause", async () => {
    mockApi(REPORT);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 20, autoplay: true }));
    render(<Dashboard />);
    await screen.findByRole("heading", { name: "Regional snowfall" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Cottonwoods mountain weather" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByRole("heading", { name: "Regional snowfall" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("persists critical closure notices in a banner across slides", async () => {
    const roads = structuredClone(REPORT.sources.roads.payload) as RoadsPayload;
    roads.notices.push({ title: "SR-210", text: "CLOSED for avalanche control", severity: "critical", canyon: "LCC", source: "UDOT", updatedAt: null });
    const report = structuredClone(REPORT);
    report.sources.roads.payload = roads;
    expect(criticalNotices(report)).toHaveLength(1);
    expect(criticalNotices(REPORT)).toHaveLength(0); // seasonal Guardsman alert is not banner-worthy
    mockApi(report);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 20, autoplay: true }));
    render(<Dashboard />);
    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("CLOSED for avalanche control");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await screen.findByRole("heading", { name: "Cottonwoods mountain weather" });
    expect(screen.getByRole("alert").textContent).toContain("CLOSED for avalanche control");
  });
});
