// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
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

/** Titles are present in the skeleton too; wait for report content to settle. */
async function loadedHeading(name: string) {
  await waitFor(() => expect(document.querySelector("[aria-busy=true]")).toBeNull());
  return screen.findByRole("heading", { level: 1, name });
}

describe("app shell", () => {
  it.each(SECTIONS)("shows an accessible initial skeleton for $id, then ready content", async ({ id, title }) => {
    let respond!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    renderAt(sectionHref(id));
    expect(screen.getByRole("status").textContent).toMatch(/^Loading /);
    expect(document.querySelector("[aria-busy=true]")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(id === "plumes" ? "plumes" : id === "weather" ? "weather" : title);
    expect(screen.getByRole("navigation", { name: "Sections" })).toBeTruthy();
    await act(async () => { respond(Response.json(REPORT)); });
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
    expect(screen.queryByText(/^Loading /)).toBeNull();
  });

  it("replaces a failed initial load with retry feedback, then recovers automatically", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json(REPORT));
    renderAt("/");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("heading", { name: "Could not load the report" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("retry automatically");
    expect(screen.getByText("HTTP 503")).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Resorts" })).toBeTruthy();
    expect(screen.queryByText("Could not load the report")).toBeNull();
  });

  it("keeps report content visible through a pending and failed background refresh", async () => {
    vi.useFakeTimers();
    let respond!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(REPORT))
      .mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    renderAt("/alta");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByRole("heading", { name: "Alta" })).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
    await act(async () => { respond(new Response("unavailable", { status: 503 })); });
    expect(screen.getByRole("heading", { name: "Alta" })).toBeTruthy();
    expect(screen.getByText(/Dashboard can’t reach its server/)).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
  });

  it("opens on the page under the editorial nav", async () => {
    mockApi(REPORT);
    renderAt("/");
    expect(await loadedHeading("Resorts")).toBeTruthy();
    // The primary row links to sections, Resorts first; its arrow (not opened yet) reveals the resort row.
    const sectionsNav = screen.getByRole("navigation", { name: "Sections" });
    const navLinks = within(sectionsNav).getAllByRole("link");
    expect(navLinks.map((a) => a.getAttribute("href"))).toEqual(SECTIONS.filter((s) => !s.group).map((s) => sectionHref(s.id)));
    expect(within(sectionsNav).getByRole("link", { name: "Resorts" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    // The tabs sit in their own bar after the masthead, with one bar marking the current tab.
    const tabs = document.querySelector(".section-nav__tabs")!;
    expect(tabs.closest("header")).toBeNull();
    expect(tabs.querySelectorAll(".section-nav__bar")).toHaveLength(1);
    expect(tabs.hasAttribute("data-bar")).toBe(true);
    // The appearance control offers light and dark.
    expect(screen.getByRole("button", { name: "Light appearance" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dark appearance" })).toBeTruthy();
  });

  it.each(["alta", "snowbird", "solitude", "brighton"])("opens %s from its timeline without reloading the report", async (id) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(REPORT));
    const view = renderAt("/");
    await loadedHeading("Resorts");
    const link = document.querySelector<HTMLAnchorElement>(`.resort-name__link[href="/${id}"]`)!;
    // Only a router Link intercepts the browser's full-document navigation.
    expect(fireEvent.click(link)).toBe(false);
    expect(nav.pathname).toBe(`/${id}`);
    view.rerender(<AppShell><SectionView id={id} /></AppShell>);
    expect(screen.getByRole("heading", { level: 1, name: REPORT.sources[id as keyof typeof REPORT.sources].label })).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("opens the forecast from a resort without reloading the report", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(REPORT));
    const view = renderAt("/alta");
    await loadedHeading("Alta");
    expect(fireEvent.click(screen.getByRole("link", { name: "Forecast ↗" }))).toBe(false);
    expect(nav.pathname).toBe("/weather");
    view.rerender(<AppShell><SectionView id="weather" /></AppShell>);
    expect(screen.getByRole("heading", { level: 1, name: "Cottonwoods mountain weather" })).toBeTruthy();
    expect(document.querySelector("[aria-busy=true]")).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("renders every section page from real-source fixtures", async () => {
    // Pin the clock to collection time: stored plume panels expire after
    // PLUME_PANEL_TTL_S, so a wall clock would turn this test red days later.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXTURE_NOW);
    mockApi(REPORT);
    const expected = ["Resorts", "Waiting for the first post", "Cottonwoods mountain weather", "Utah ensemble snow plumes", "Canyon roads", "Alta", "Snowbird", "Solitude", "Brighton"];
    expect(SECTIONS).toHaveLength(9);
    for (const [i, title] of expected.entries()) {
      const view = renderAt(sectionHref(SECTIONS[i].id));
      expect(await loadedHeading(title)).toBeTruthy();
      const toggle = screen.getByRole("button", { name: "Show resorts" });
      expect(toggle.closest(".section-nav__parent")!.hasAttribute("data-current")).toBe(i === 0 || Boolean(SECTIONS[i].group));
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
    await loadedHeading("Resorts");
    expect(nav.replace).toHaveBeenCalledWith("/snowbird");
  });

  it("persists the appearance choice and returns to the system default", async () => {
    mockApi(REPORT);
    renderAt("/");
    await loadedHeading("Resorts");
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
  const sectionsNav = () => screen.getByRole("navigation", { name: "Sections" });
  const parentLink = () => within(sectionsNav()).getByRole("link", { name: "Resorts" });
  const toggle = () => screen.getByRole("button", { name: "Show resorts" });
  const marked = () => parentLink().closest(".section-nav__parent")!.hasAttribute("data-current");

  it("marks Resorts on the home page, and its arrow opens the resort row in place", () => {
    render(<SectionNav pathname="/" />);
    expect(parentLink().getAttribute("href")).toBe("/");
    expect(parentLink().getAttribute("aria-current")).toBe("page");
    expect(marked()).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const links = within(screen.getByRole("navigation", { name: "Resorts" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/alta", "/snowbird", "/solitude", "/brighton"]);
    expect(links.filter((a) => a.hasAttribute("aria-current"))).toHaveLength(0);
  });

  it("toggles in place on other sections and closes with Escape, returning focus to the arrow", () => {
    render(<SectionNav pathname="/weather" />);
    const panel = document.getElementById(toggle().getAttribute("aria-controls")!)!;
    expect(panel.hasAttribute("inert")).toBe(true);
    expect(marked()).toBe(false);
    fireEvent.click(toggle());
    expect(panel.hasAttribute("inert")).toBe(false);
    expect(screen.getByRole("link", { name: "Weather" }).getAttribute("aria-current")).toBe("page");
    const link = within(screen.getByRole("navigation", { name: "Resorts" })).getByRole("link", { name: "Alta" });
    link.focus();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(document.activeElement).toBe(toggle());
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["Alta", "Snowbird", "Solitude", "Brighton"])("pins the resort row open on %s, with Resorts marked as the parent", (name) => {
    render(<SectionNav pathname={`/${name.toLowerCase()}`} />);
    expect(parentLink().getAttribute("aria-current")).toBeNull();
    expect(marked()).toBe(true);
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    const resorts = screen.getByRole("navigation", { name: "Resorts" });
    const link = within(resorts).getByRole("link", { name });
    expect(link.getAttribute("aria-current")).toBe("page");
    fireEvent.click(toggle());
    fireEvent.keyDown(link, { key: "Escape" });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("navigation", { name: "Resorts" })).toBe(resorts);
  });

  it("closes an opened row when the route changes", () => {
    const view = render(<SectionNav pathname="/" />);
    fireEvent.click(toggle());
    view.rerender(<SectionNav pathname="/weather" />);
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
    view.rerender(<SectionNav pathname="/alta" />);
    expect(screen.getByRole("navigation", { name: "Resorts" })).toBeTruthy();
    view.rerender(<SectionNav pathname="/" />);
    expect(screen.queryByRole("navigation", { name: "Resorts" })).toBeNull();
  });
});
