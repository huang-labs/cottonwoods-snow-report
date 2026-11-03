// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DailySnowPage } from "@/components/dailysnow/DailySnow";
import { RegionalPage } from "@/components/sections/RegionalPage";
import { buildReport } from "@/lib/report";
import type { ApiDailySnow, ApiRecommendation } from "@/lib/types";

const now = new Date("2026-11-01T15:00:00Z");
const post: ApiDailySnow = {
  date: "2026-11-01",
  phase: "storm",
  title: "Storm Underway",
  summary: "The main surge is here today with snow above 8,000 feet.",
  sections: [
    { id: "update", paragraphs: [{ text: "Snow levels fall through tonight:", figure: "nws-snow-level" }, { text: "Stakes are filling in:", figure: "stake-alta" }] },
    { id: "extended", paragraphs: [{ text: "A weak system arrives Wednesday.", figure: null }] },
  ],
  figures: {
    "nws-snow-level": { id: "nws-snow-level", kind: "snow-level", caption: "NWS forecast snow level", series: [{ canyon: "LCC", points: [{ start: "2026-11-01T12:00:00Z", ft: 8000 }, { start: "2026-11-01T18:00:00Z", ft: 7000 }] }] },
    "stake-alta": { id: "stake-alta", kind: "image", caption: "Alta snow stake · 5:55 AM today", url: "/api/daily-snow/figure/2026-11-01/stake-alta", originUrl: "https://example.com/stake.jpg", width: null, height: null },
  },
  numbers: {
    canyons: [{ canyon: "LCC", point: "Alta / Snowbird (LCC)", next24In: 12.3, next72In: 16.8, next7dIn: 17.1, nextStorm: null, forecastUpdatedAt: null }],
    resorts: [{ id: "alta", name: "Alta", h24: 9, storm: 11, reportTime: null }],
  },
  generatedAt: "2026-11-01T13:00:00Z",
  model: "@cf/zai-org/glm-5.3-flash",
  trigger: "morning",
  outdated: false,
  failing: false,
  archive: [{ date: "2026-11-01", title: "Storm Underway" }, { date: "2026-10-31", title: "Storm Arrives" }],
};
const report = (dailySnow: ApiDailySnow | null) => ({ ...buildReport(null, now), dailySnow });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

it("shows the post as page content with the AI badge, sections and figures", () => {
  render(<DailySnowPage report={report(post)} now={now} />);
  expect(screen.getByRole("heading", { level: 1, name: "Storm Underway" })).toBeTruthy();
  expect(screen.getByText(/Daily Snow/, { selector: ".eyebrow" }).querySelector(".badge--ai")?.textContent).toBe("AI");
  expect(screen.getByText(/Storm$/, { selector: ".eyebrow" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today", "Extended Forecast"]);
  // Page content, not a card like the resort pick.
  expect(document.querySelector(".page--dailysnow .dailysnow-teaser")).toBeNull();
  const article = within(document.querySelector<HTMLElement>(".dailysnow__article")!);
  expect(article.getByRole("img", { name: "NWS forecast snow level" })).toBeTruthy();
  expect(article.getByRole("img", { name: "Alta snow stake · 5:55 AM today" }).getAttribute("src")).toBe("/api/daily-snow/figure/2026-11-01/stake-alta");
  expect(screen.getByText(/AI-generated from NWS forecasts.*GLM 5\.3 Flash/)).toBeTruthy();
});

it("marks an old post as outdated", () => {
  render(<DailySnowPage report={report({ ...post, outdated: true, failing: true })} now={now} />);
  expect(screen.getByText(/Outdated · Today's post failed/, { selector: ".dailysnow__warn" })).toBeTruthy();
});

it("waits for the first post", () => {
  render(<DailySnowPage report={report(null)} now={now} />);
  expect(screen.getByRole("heading", { level: 1, name: "Waiting for the first post" })).toBeTruthy();
});

it("opens an archived post and returns to the latest", async () => {
  const older: ApiDailySnow = { ...post, date: "2026-10-31", title: "Storm Arrives", outdated: true };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(older), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DailySnowPage report={report(post)} now={now} />);
  const nav = within(document.querySelector<HTMLElement>(".dailysnow__nav")!);
  fireEvent.click(nav.getByRole("button", { name: /Storm Arrives/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Storm Arrives" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith("/api/daily-snow?date=2026-10-31");
  expect(window.location.search).toBe("?date=2026-10-31");
  expect(screen.getByText(/· Archive/)).toBeTruthy();
  // Re-query: the nav re-renders (older link becomes the return link) with the archived post.
  const navAfter = within(document.querySelector<HTMLElement>(".dailysnow__nav")!);
  fireEvent.click(navAfter.getByRole("button", { name: /Storm Underway/ }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Storm Underway" })).toBeTruthy());
  expect(window.location.search).toBe("");
});

it("walks the archive through each post's neighbor links, past the recent-posts list", async () => {
  // The live post's older neighbor isn't in the archive list; only its own link reaches it.
  const live: ApiDailySnow = { ...post, archive: [{ date: "2026-11-01", title: "Storm Underway" }], older: { date: "2026-09-15", title: "Early Season Dusting" } };
  const old: ApiDailySnow = { ...post, date: "2026-09-15", title: "Early Season Dusting", outdated: true, archive: live.archive, older: { date: "2026-09-10", title: "First Flakes" }, newer: { date: "2026-11-01", title: "Storm Underway" } };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(old), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DailySnowPage report={report(live)} now={now} />);
  const nav = () => within(document.querySelector<HTMLElement>(".dailysnow__nav")!);
  fireEvent.click(nav().getByRole("button", { name: /Early Season Dusting/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Early Season Dusting" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith("/api/daily-snow?date=2026-09-15");
  expect(nav().getByRole("button", { name: /First Flakes/ })).toBeTruthy();
  // The newer link back to the live post drops ?date= rather than linking today's date.
  fireEvent.click(nav().getByRole("button", { name: /Storm Underway/ }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Storm Underway" })).toBeTruthy());
  expect(window.location.search).toBe("");
});

it("shows the recent posts in a left rail beside the article, today first, at most three", () => {
  const history = [
    { date: "2026-11-01", title: "Storm Underway" },
    { date: "2026-10-31", title: "Storm Arrives" },
    { date: "2026-10-30", title: "Snow Showers Return" },
    { date: "2026-10-29", title: "A Quiet Stretch" },
    { date: "2026-10-28", title: "Storm Exiting" },
    { date: "2026-10-27", title: "Upslope Snow Continues" },
  ];
  render(<DailySnowPage report={report({ ...post, archive: history })} now={now} />);
  const rail = document.querySelector<HTMLElement>(".dailysnow__history")!;
  expect(rail.getAttribute("aria-label")).toBe("Recent Daily Snow posts");
  // Counts posts, not days: a day without a post must not make the heading wrong.
  expect(rail.querySelector(".dailysnow__history-heading")?.textContent).toBe("Recent posts");
  const entries = [...rail.querySelectorAll(".dailysnow__history-entry")];
  expect(entries.map((e) => e.querySelector(".dailysnow__history-entry-date")?.textContent)).toEqual(["Today", "Sat, Oct 31", "Fri, Oct 30"]);
  // The live post is today's entry — marked active at rest — and not repeated from the archive.
  expect(entries[0].getAttribute("data-active")).toBe("true");
  expect(entries.map((e) => e.querySelector(".dailysnow__history-entry-title")?.textContent)).toEqual(["Storm Underway", "Storm Arrives", "Snow Showers Return"]);
  expect(entries[0].querySelector(".dailysnow__history-entry-phase")?.textContent).toBe("Storm");
});

it("hides the rail while the live post is the only one, but keeps the archive links", () => {
  render(<DailySnowPage report={report({ ...post, archive: [{ date: "2026-11-01", title: "Storm Underway" }] })} now={now} />);
  expect(document.querySelector(".dailysnow__history")).toBeNull();
  expect(document.querySelector(".dailysnow__nav")).not.toBeNull();
});

it("highlights the viewed post in the rail and keeps the archive links for phones", async () => {
  const older: ApiDailySnow = { ...post, date: "2026-10-31", title: "Storm Arrives", outdated: true };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(older), { headers: { "content-type": "application/json" } })));
  render(<DailySnowPage report={report(post)} now={now} />);
  const rail = document.querySelector<HTMLElement>(".dailysnow__history")!;
  fireEvent.click(rail.querySelectorAll<HTMLElement>(".dailysnow__history-entry")[1]!);
  expect(await screen.findByRole("heading", { level: 1, name: "Storm Arrives" })).toBeTruthy();
  // Re-query: the rail re-renders with the archived post loaded.
  const active = document.querySelector(".dailysnow__history-entry[data-active]");
  expect(active?.querySelector(".dailysnow__history-entry-title")?.textContent).toBe("Storm Arrives");
  // The bar and fill follow the viewed post: exactly one entry is highlighted.
  expect(document.querySelectorAll(".dailysnow__history-entry[data-active]").length).toBe(1);
  // The bottom archive links stay on every view: phones navigate with them.
  expect(document.querySelector(".dailysnow__nav")).not.toBeNull();
});

it("teases the post on the Snowfall page", () => {
  render(<RegionalPage report={report(post)} now={now} />);
  const link = screen.getByRole("link", { name: "Daily Snow: Storm Underway" });
  expect(link.getAttribute("href")).toBe("/daily-snow");
  expect(link.querySelector(".badge--ai")).not.toBeNull();
  // The teaser leads the page, above the Snowfall header.
  const page = document.querySelector(".page--regional")!;
  expect(page.firstElementChild).toBe(link);
  expect(link.nextElementSibling?.className).toBe("page__header");
});

const recommendation: ApiRecommendation = {
  targetDate: "2026-11-01", mode: "storm", pick: "alta", plan: "Check road access before leaving.",
  headline: "Alta today", caveats: [], runnerUp: null, generatedAt: now.toISOString(),
  model: "@cf/zai-org/glm-5.3-flash", trigger: "morning", outdated: false, failing: false,
};

it.each([null, { ...recommendation, pick: null }])("hides the recommendation when there is no resort pick (%j)", (pick) => {
  render(<RegionalPage report={{ ...report(post), recommendation: pick }} now={now} />);
  expect(document.querySelector("aside.recommendation")).toBeNull();
  expect(screen.getByRole("link", { name: "Daily Snow: Storm Underway" })).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});

it("keeps a previous resort pick visible with its update warnings", () => {
  render(<RegionalPage report={{ ...report(post), recommendation: { ...recommendation, outdated: true, failing: true } }} now={now} />);
  expect(screen.getByRole("generic", { name: "AI recommendation reasoning" })).toBeTruthy();
  expect(screen.getByText("Alta today")).toBeTruthy();
  expect(screen.getByText(/Outdated · Updates failing/)).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});

it("draws plume figures like the plumes page: padded, Mountain Time axis, posting-time marker", () => {
  const plume = {
    id: "plume-snow-cln",
    kind: "image" as const,
    caption: "University of Utah ensemble plume · Accumulated Snow · Alta-Collins, UT · 00Z run",
    url: "/api/daily-snow/figure/2026-11-01/plume-snow-cln",
    originUrl: "/api/plume/CLN/2026110100/snow",
    width: 922,
    height: 533,
    axis: { plot: { left: 66, right: 920, top: 30, bottom: 525 }, initTime: "2026-11-01T00:00:00Z", forecastHours: 240 },
  };
  const withPlume: ApiDailySnow = {
    ...post,
    sections: [{ id: "update", paragraphs: [{ text: "The plume:", figure: "plume-snow-cln" }] }],
    figures: { "plume-snow-cln": plume },
  };
  const { unmount } = render(<DailySnowPage report={report(withPlume)} now={now} />);
  const svg = screen.getByRole("img", { name: /Accumulated Snow.*times in Mountain Time/ });
  // White margin around the crop (the shared plumes-page drawing).
  expect(svg.getAttribute("viewBox")).toBe("-20 -20 962 639");
  expect(svg.querySelector("image")?.getAttribute("href")).toBe(plume.url);
  // Mountain Time day labels in place of the cropped UTC ones; init is Sat 6 PM MDT.
  expect([...svg.querySelectorAll(".plume__day")].map((t) => t.textContent).slice(0, 3)).toEqual(["Sun", "Mon", "Tue"]);
  expect(svg.querySelector(".plume__nowlabel")?.textContent).toBe("posted");
  unmount();

  // Posts written before the axis was stored keep the bare still, padded.
  const { axis: _axis, ...legacy } = plume;
  const { unmount: unmountLegacy } = render(<DailySnowPage report={report({ ...withPlume, figures: { "plume-snow-cln": legacy } })} now={now} />);
  const img = screen.getByRole("img", { name: plume.caption });
  expect(img.tagName).toBe("IMG");
  expect(img.closest("figure")?.className).toContain("dailysnow-figure--plume");
  unmountLegacy();

  // Code-added required figures render after the prose, without invented introductions.
  render(<DailySnowPage report={report({ ...withPlume, sections: [{ id: "update", paragraphs: [{ text: "A quiet day.", figure: null }] }] })} now={now} />);
  expect(screen.getAllByRole("img", { name: /Accumulated Snow.*times in Mountain Time/ })).toHaveLength(1);
  expect(screen.getByText("A quiet day.")).toBeTruthy();
});
