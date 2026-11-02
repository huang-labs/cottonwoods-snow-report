// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AppShell } from "@/components/AppShell";
import { SectionView } from "@/components/SectionView";
import { useReport } from "@/components/hooks";
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
  // jsdom has no matchMedia; the appearance control listens to it.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
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
  delete document.documentElement.dataset.theme;
  window.history.replaceState(null, "", "/");
  nav.pathname = "/";
  nav.replace.mockReset();
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

describe("app shell", () => {
  it("opens on the page under the editorial nav", async () => {
    mockApi(REPORT);
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Regional snowfall" })).toBeTruthy();
    // Non-resort sections are nav links; the resorts sit behind one menu.
    const navLinks = within(screen.getByRole("navigation", { name: "Sections" }))
      .getAllByRole("link")
      .filter((a) => !a.closest(".editorial-nav__resorts"));
    expect(navLinks.map((a) => a.getAttribute("href"))).toEqual(SECTIONS.filter((s) => !s.group).map((s) => sectionHref(s.id)));
    expect(screen.getByRole("link", { name: "Snowfall" }).getAttribute("aria-current")).toBe("page");
    // The appearance control offers light and dark.
    expect(screen.getByRole("button", { name: "Light appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark appearance" })).toBeTruthy();
  });

  it("renders every section page from real-source fixtures", async () => {
    mockApi(REPORT);
    const expected = ["Regional snowfall", "Waiting for the first post", "Cottonwoods mountain weather", "Utah ensemble snow plumes", "Canyon roads", "Alta", "Snowbird", "Solitude", "Brighton"];
    expect(SECTIONS).toHaveLength(9);
    for (const [i, title] of expected.entries()) {
      const view = renderAt(sectionHref(SECTIONS[i].id));
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      // The resorts menu names the current resort while on a resort page.
      const menu = document.querySelector(".editorial-nav__resorts")!;
      if (SECTIONS[i].group) {
        expect(menu.querySelector("summary")?.textContent).toContain(SECTIONS[i].label);
      }
      const resortLinks = within(menu as HTMLElement).getAllByRole("link");
      expect(resortLinks.map((a) => a.getAttribute("href"))).toEqual(["/alta", "/snowbird", "/solitude", "/brighton"]);
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

  it("persists the appearance choice and returns to the system default", async () => {
    mockApi(REPORT);
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Regional snowfall" });
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("cottonwoods-snow-report.appearance")).toBe("dark");
    // Clicking the active choice again restores the system default.
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("cottonwoods-snow-report.appearance")).toBeNull();
  });
});
