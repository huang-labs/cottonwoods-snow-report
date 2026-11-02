// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { SectionView } from "@/components/SectionView";
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, savePrefs, useReport, useSlideTimer } from "@/components/hooks";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { SECTIONS, sectionHref, sectionIndexFromPath } from "@/lib/sections";
import { MemoryKV, readSnapshot } from "@/lib/store";
import type { ReportResponse } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

// The app router isn't mounted under jsdom: stand in for the hooks the shell uses.
const nav = vi.hoisted(() => ({ pathname: "/", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: nav.replace, push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

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
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  nav.pathname = "/";
  nav.replace.mockReset();
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
    savePrefs(window.localStorage, { durationSec: 45 });
    expect(loadPrefs(window.localStorage)).toEqual({ durationSec: 45 });
    // Older saved prefs carried an autoplay flag; it is ignored now.
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 30, autoplay: true }));
    expect(loadPrefs(window.localStorage)).toEqual({ durationSec: 30 });
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 1 }));
    expect(loadPrefs(window.localStorage)).toEqual(DEFAULT_PREFS);
    window.localStorage.setItem(PREFS_KEY, "{not json");
    expect(loadPrefs(window.localStorage)).toEqual(DEFAULT_PREFS);
  });
});

describe("sections", () => {
  it("maps sections to routes and back", () => {
    expect(SECTIONS.map((s) => sectionHref(s.id))).toEqual(["/", "/daily-snow", "/weather", "/plumes", "/traffic", "/alta", "/snowbird", "/solitude", "/brighton"]);
    for (const [i, s] of SECTIONS.entries()) expect(sectionIndexFromPath(sectionHref(s.id))).toBe(i);
    expect(sectionIndexFromPath("/alta/")).toBe(5);
    expect(sectionIndexFromPath("/nope")).toBe(-1);
  });
});

function mockApi(report: ReportResponse) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(report));
}

/** Render the app as the router would for `path`. */
function renderAt(path: string) {
  const url = new URL(path, "http://localhost");
  nav.pathname = url.pathname;
  window.history.replaceState(null, "", path);
  const id = SECTIONS[Math.max(0, sectionIndexFromPath(url.pathname))].id;
  return render(
    <AppShell>
      <SectionView id={id} />
    </AppShell>,
  );
}

describe("browse mode", () => {
  it("opens on the page with a navbar; no start screen and no autoplay", async () => {
    mockApi(REPORT);
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Regional snowfall" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Slideshow controls" })).toBeNull();
    // Non-resort sections are tabs; the resorts sit behind one "Resorts" dropdown.
    const links = screen.getAllByRole("link").filter((a) => a.closest("nav"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(SECTIONS.filter((s) => !s.group).map((s) => sectionHref(s.id)));
    expect(screen.getByRole("link", { name: "Snowfall" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Resorts" }).getAttribute("aria-expanded")).toBe("false");
    // Arrow keys scroll the page in browse mode; they don't change sections.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByRole("heading", { level: 1, name: "Regional snowfall" })).toBeTruthy();
  });

  it("renders every section page from real-source fixtures", async () => {
    mockApi(REPORT);
    const expected = ["Regional snowfall", "Waiting for the first post", "Cottonwoods mountain weather", "Utah ensemble snow plumes", "Canyon roads", "Alta", "Snowbird", "Solitude", "Brighton"];
    expect(SECTIONS).toHaveLength(9);
    for (const [i, title] of expected.entries()) {
      const view = renderAt(sectionHref(SECTIONS[i].id));
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      if (SECTIONS[i].group) {
        // The dropdown trigger names the current resort.
        expect(screen.getByRole("button", { name: `Resorts · ${SECTIONS[i].label}` }).className).toContain("is-active");
      } else {
        expect(screen.getByRole("link", { name: SECTIONS[i].label }).getAttribute("aria-current")).toBe("page");
      }
      if (SECTIONS[i].id === "plumes") {
        // Four cropped panels, each with a Mountain Time axis.
        expect(await screen.findAllByRole("img", { name: /times in Mountain Time/ })).toHaveLength(4);
      }
      if (SECTIONS[i].id === "traffic") {
        // Year-old UDOT travel times are labelled as not live.
        expect(screen.getAllByText(/Not live — UDOT’s latest measurement/, { selector: "p" })).toHaveLength(2);
      }
      view.unmount();
    }
  });

  it("Resorts dropdown lists the resort pages and works from the keyboard", async () => {
    mockApi(REPORT);
    renderAt("/snowbird");
    await screen.findByRole("heading", { level: 1, name: "Snowbird" });
    const trigger = screen.getByRole("button", { name: "Resorts · Snowbird" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = ["Alta", "Snowbird", "Solitude", "Brighton"].map((name) => screen.getByRole("link", { name }));
    expect(items.map((a) => a.getAttribute("href"))).toEqual(["/alta", "/snowbird", "/solitude", "/brighton"]);
    expect(items[1].getAttribute("aria-current")).toBe("page");
    // Clicking outside closes it.
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("link", { name: "Alta" })).toBeNull();

    // ↓ opens with focus on the current resort; ↓ moves on; Escape returns to the trigger.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Snowbird" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "Solitude" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("link", { name: "Solitude" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("renders explicit unavailable states when nothing has been collected", async () => {
    mockApi(buildReport(null, FIXTURE_NOW));
    let view = renderAt("/alta");
    expect(await screen.findByText(/Required feeds unavailable/)).toBeTruthy();
    expect(await screen.findByText("Alta report unavailable")).toBeTruthy();
    view.unmount();
    view = renderAt("/plumes");
    expect(await screen.findByText("Plume charts unavailable")).toBeTruthy();
  });

  it("redirects legacy ?slide= links to the section page", async () => {
    mockApi(REPORT);
    renderAt("/?slide=snowbird");
    await screen.findByRole("heading", { level: 1, name: "Regional snowfall" });
    expect(nav.replace).toHaveBeenCalledWith("/snowbird");
  });
});

describe("slideshow mode", () => {
  it("starts from the current page, rotates by keyboard, and exits to the slide's page", async () => {
    mockApi(REPORT);
    renderAt("/alta");
    await screen.findByRole("heading", { level: 1, name: "Alta" });
    fireEvent.click(screen.getByRole("button", { name: /Slideshow/ }));
    expect(screen.getByRole("toolbar", { name: "Slideshow controls" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Sections" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Alta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await screen.findByRole("heading", { level: 1, name: "Snowbird" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await screen.findByRole("heading", { level: 1, name: "Alta" })).toBeTruthy();
    fireEvent.keyDown(window, { key: " " });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Brighton" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Brighton" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit slideshow" }));
    expect(nav.replace).toHaveBeenCalledWith("/brighton");
    expect(screen.queryByRole("toolbar", { name: "Slideshow controls" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
  });

  it("advances on the timer and persists the slide duration", async () => {
    mockApi(REPORT);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ durationSec: 10 }));
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Regional snowfall" });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: /Slideshow/ }));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("heading", { level: 1, name: "Waiting for the first post" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Seconds per slide" }), { target: { value: "45" } });
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY)!).durationSec).toBe(45);
  });

  it("Escape leaves the slideshow", async () => {
    mockApi(REPORT);
    renderAt("/weather");
    await screen.findByRole("heading", { level: 1, name: "Cottonwoods mountain weather" });
    fireEvent.click(screen.getByRole("button", { name: /Slideshow/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(nav.replace).toHaveBeenCalledWith("/weather");
    expect(screen.queryByRole("toolbar", { name: "Slideshow controls" })).toBeNull();
  });

  it("?kiosk=1 opens straight into the slideshow (paused with &paused=1)", async () => {
    mockApi(REPORT);
    renderAt("/plumes?kiosk=1&paused=1");
    expect(await screen.findByRole("toolbar", { name: "Slideshow controls" })).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 1, name: "Utah ensemble snow plumes" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("?kiosk=1 honours the legacy ?slide= start", async () => {
    mockApi(REPORT);
    renderAt("/?kiosk=1&slide=solitude");
    expect(await screen.findByRole("heading", { level: 1, name: "Solitude" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  });
});
