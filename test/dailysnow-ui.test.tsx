// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DailySnowSlide } from "@/components/dailysnow/DailySnow";
import { RegionalSlide } from "@/components/slides/RegionalSlide";
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
  render(<DailySnowSlide report={report(post)} now={now} />);
  expect(screen.getByRole("heading", { level: 1, name: "Storm Underway" })).toBeTruthy();
  expect(screen.getByText(/Daily Snow/, { selector: ".recommendation__eyebrow" }).querySelector(".badge--ai")?.textContent).toBe("AI");
  expect(screen.getByText(/Storm$/, { selector: ".recommendation__eyebrow" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Today", "Extended Forecast"]);
  // Page content, not a card like the resort pick.
  expect(document.querySelector(".slide--dailysnow .recommendation")).toBeNull();
  const article = within(document.querySelector<HTMLElement>(".dailysnow__article")!);
  expect(article.getByRole("img", { name: "NWS forecast snow level" })).toBeTruthy();
  expect(article.getByRole("img", { name: "Alta snow stake · 5:55 AM today" }).getAttribute("src")).toBe("/api/daily-snow/figure/2026-11-01/stake-alta");
  expect(screen.getByText(/AI-generated from NWS forecasts.*GLM 5\.3 Flash/)).toBeTruthy();
});

it("marks an old post as outdated", () => {
  render(<DailySnowSlide report={report({ ...post, outdated: true, failing: true })} now={now} />);
  expect(screen.getByText(/Outdated · Today's post failed/, { selector: ".dailysnow__warn" })).toBeTruthy();
});

it("waits for the first post", () => {
  render(<DailySnowSlide report={report(null)} now={now} />);
  expect(screen.getByRole("heading", { level: 1, name: "Waiting for the first post" })).toBeTruthy();
});

it("opens an archived post and returns to the latest", async () => {
  const older: ApiDailySnow = { ...post, date: "2026-10-31", title: "Storm Arrives", outdated: true };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(older), { headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  render(<DailySnowSlide report={report(post)} now={now} />);
  fireEvent.click(screen.getByRole("button", { name: /Storm Arrives/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Storm Arrives" })).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith("/api/daily-snow?date=2026-10-31");
  expect(window.location.search).toBe("?date=2026-10-31");
  expect(screen.getByText(/· Archive/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Storm Underway/ }));
  await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Storm Underway" })).toBeTruthy());
  expect(window.location.search).toBe("");
});

it("teases the post on the Snowfall page", () => {
  render(<RegionalSlide report={report(post)} now={now} />);
  const link = screen.getByRole("link", { name: "Daily Snow: Storm Underway" });
  expect(link.getAttribute("href")).toBe("/daily-snow");
  expect(link.querySelector(".badge--ai")).not.toBeNull();
});

const recommendation: ApiRecommendation = {
  targetDate: "2026-11-01", mode: "storm", pick: "alta", plan: "Check road access before leaving.",
  headline: "Alta today", caveats: [], runnerUp: null, generatedAt: now.toISOString(),
  model: "@cf/zai-org/glm-5.3-flash", trigger: "morning", outdated: false, failing: false,
};

it.each([null, { ...recommendation, pick: null }])("hides the recommendation when there is no resort pick (%j)", (pick) => {
  render(<RegionalSlide report={{ ...report(post), recommendation: pick }} now={now} />);
  expect(document.querySelector("aside.recommendation")).toBeNull();
  expect(screen.getByRole("link", { name: "Daily Snow: Storm Underway" })).toBeTruthy();
  expect(screen.queryByText("AI pick")).toBeNull();
});

it("keeps a previous resort pick visible with its update warnings", () => {
  render(<RegionalSlide report={{ ...report(post), recommendation: { ...recommendation, outdated: true, failing: true } }} now={now} />);
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
  const { unmount } = render(<DailySnowSlide report={report(withPlume)} now={now} />);
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
  const { unmount: unmountLegacy } = render(<DailySnowSlide report={report({ ...withPlume, figures: { "plume-snow-cln": legacy } })} now={now} />);
  const img = screen.getByRole("img", { name: plume.caption });
  expect(img.tagName).toBe("IMG");
  expect(img.closest("figure")?.className).toContain("dailysnow-figure--plume");
  unmountLegacy();

  // Code-added required figures render after the prose, without invented introductions.
  render(<DailySnowSlide report={report({ ...withPlume, sections: [{ id: "update", paragraphs: [{ text: "A quiet day.", figure: null }] }] })} now={now} />);
  expect(screen.getAllByRole("img", { name: /Accumulated Snow.*times in Mountain Time/ })).toHaveLength(1);
  expect(screen.getByText("A quiet day.")).toBeTruthy();
});
