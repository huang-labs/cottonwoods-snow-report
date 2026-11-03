// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SectionNav } from "@/components/SectionNav";
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
    <a href={href} {...rest} onClick={(event) => { event.preventDefault(); nav.pathname = href; }}>
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
    expect(await screen.findByRole("heading", { level: 1, name: "Resort snowfall" })).toBeTruthy();
    // The primary row links to sections; Resorts reveals the secondary row.
    const navLinks = within(screen.getByRole("navigation", { name: "Sections" }))
      .getAllByRole("link");
    expect(navLinks.map((a) => a.getAttribute("href"))).toEqual(SECTIONS.filter((s) => !s.group).map((s) => sectionHref(s.id)));
    expect(screen.getByRole("link", { name: "Snowfall" }).getAttribute("aria-current")).toBe("page");
    // The tabs sit in their own bar after the masthead, with one bar marking the current tab.
    const tabs = document.querySelector(".section-nav__tabs")!;
    expect(tabs.closest("header")).toBeNull();
    expect(tabs.querySelectorAll(".section-nav__bar")).toHaveLength(1);
    expect(tabs.hasAttribute("data-bar")).toBe(true);
    // The appearance control offers light and dark.
    expect(screen.getByRole("button", { name: "Light appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark appearance" })).toBeTruthy();
  });

  it.each(["alta", "snowbird", "solitude", "brighton"])("opens %s from the snowfall table without reloading the report", async (id) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(REPORT));
    const view = renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Resort snowfall" });
    const link = document.querySelector<HTMLAnchorElement>(`.resort-name__link[href="/${id}"]`)!;
    // Only a router Link intercepts the browser's full-document navigation.
    expect(fireEvent.click(link)).toBe(false);
    expect(nav.pathname).toBe(`/${id}`);
    view.rerender(<AppShell><SectionView id={id} /></AppShell>);
    expect(screen.getByRole("heading", { level: 1, name: REPORT.sources[id as keyof typeof REPORT.sources].label })).toBeTruthy();
    expect(screen.queryByText("Loading report…")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the forecast from a resort without reloading the report", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(REPORT));
    const view = renderAt("/alta");
    await screen.findByRole("heading", { level: 1, name: "Alta" });
    expect(fireEvent.click(screen.getByRole("link", { name: "Forecast ↗" }))).toBe(false);
    expect(nav.pathname).toBe("/weather");
    view.rerender(<AppShell><SectionView id="weather" /></AppShell>);
    expect(screen.getByRole("heading", { level: 1, name: "Cottonwoods mountain weather" })).toBeTruthy();
    expect(screen.queryByText("Loading report…")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("renders every section page from real-source fixtures", async () => {
    mockApi(REPORT);
    const expected = ["Resort snowfall", "Waiting for the first post", "Cottonwoods mountain weather", "Utah ensemble snow plumes", "Canyon roads", "Alta", "Snowbird", "Solitude", "Brighton"];
    expect(SECTIONS).toHaveLength(9);
    for (const [i, title] of expected.entries()) {
      const view = renderAt(sectionHref(SECTIONS[i].id));
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      const toggle = screen.getByRole("button", { name: "Resorts" });
      expect(toggle.hasAttribute("data-current")).toBe(Boolean(SECTIONS[i].group));
      expect(toggle.getAttribute("aria-expanded")).toBe(String(Boolean(SECTIONS[i].group)));
      if (SECTIONS[i].group) {
        const resorts = screen.getByRole("navigation", { name: "Resorts" });
        const links = within(resorts).getAllByRole("link");
        expect(links.map((a) => a.getAttribute("href"))).toEqual(["/alta", "/snowbird", "/solitude", "/brighton"]);
        expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual([SECTIONS[i].label]);
      } else {
        expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
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

  it("renders explicit unavailable states when nothing has been collected", async () => {
    mockApi(buildReport(null, FIXTURE_NOW));
    let view = renderAt("/alta");
    expect(await screen.findByText("Unavailable", { selector: ".banner .badge" })).toBeTruthy();
    expect(await screen.findByText("Alta report unavailable")).toBeTruthy();
    view.unmount();
    view = renderAt("/plumes");
    expect(await screen.findByText("Plume charts unavailable")).toBeTruthy();
  });

  it("redirects legacy ?slide= links to the section page", async () => {
    mockApi(REPORT);
    renderAt("/?slide=snowbird");
    await screen.findByRole("heading", { level: 1, name: "Resort snowfall" });
    expect(nav.replace).toHaveBeenCalledWith("/snowbird");
  });

  it("persists the appearance choice and returns to the system default", async () => {
    mockApi(REPORT);
    renderAt("/");
    await screen.findByRole("heading", { level: 1, name: "Resort snowfall" });
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem("cottonwoods-snow-report.appearance")).toBe("dark");
    // Clicking the active choice again restores the system default.
    fireEvent.click(screen.getByRole("button", { name: "Dark appearance" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem("cottonwoods-snow-report.appearance")).toBeNull();
  });
});


describe("resort navigation", () => {
  it("toggles in place and closes with Escape, returning focus from a resort link", () => {
    render(<SectionNav pathname="/weather" />);
    const toggle = screen.getByRole("button", { name: "Resorts" });
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel.hasAttribute("inert")).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: "Weather" }).getAttribute("aria-current")).toBe("page");
    expect(toggle.hasAttribute("data-current")).toBe(false);
    const link = within(screen.getByRole("navigation", { name: "Resorts" })).getByRole("link", { name: "Alta" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(document.activeElement).toBe(toggle);
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the row open between resorts and resets disclosure across other routes and back", () => {
    const view = render(<SectionNav pathname="/" />);
    fireEvent.click(screen.getByRole("button", { name: "Resorts" }));
    view.rerender(<SectionNav pathname="/alta" />);
    const toggle = screen.getByRole("button", { name: "Resorts" });
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: "Escape" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    view.rerender(<SectionNav pathname="/brighton" />);
    expect(screen.getByRole("button", { name: "Resorts" }).hasAttribute("data-current")).toBe(true);
    expect(screen.getByRole("link", { name: "Brighton" }).getAttribute("aria-current")).toBe("page");
    view.rerender(<SectionNav pathname="/weather" />);
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    view.rerender(<SectionNav pathname="/" />);
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
  });
});
