// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { renderSection } from "@/components/SectionView";
import { ResortSlide } from "@/components/slides/ResortSlide";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { MemoryKV, readSnapshot } from "@/lib/store";
import type { ApiSource, ReportResponse, ResortReport } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

let report: ReportResponse;
beforeAll(async () => {
  const kv = new MemoryKV();
  await runCollection(
    { SNOW_KV: kv },
    { now: FIXTURE_NOW, fetchImpl: createFixtureFetch().fetchImpl },
  );
  report = buildReport(await readSnapshot(kv), FIXTURE_NOW);
});
afterEach(cleanup);

it.each(["alta", "snowbird", "solitude", "brighton"])(
  "renders %s as a browse report and keeps TV in its compact presentation",
  (id) => {
    const { container, rerender } = render(
      renderSection(id, report, FIXTURE_NOW, null, "browse"),
    );
    expect(container.querySelector(".resort-report")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Lifts & terrain" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Getting there" })).toBeNull();
    rerender(renderSection(id, report, FIXTURE_NOW, null));
    expect(container.querySelector(".resort-report")).toBeNull();
    expect(container.querySelector(".resort-grid")).toBeTruthy();
  },
);

it("keeps critical notices above snow and retains the full narrative, lift hours and terrain notes", () => {
  const base = report.sources.alta.payload as ResortReport;
  const narrative = "Detailed mountain report. ".repeat(40);
  const source: ApiSource<ResortReport> = {
    ...report.sources.alta,
    payload: {
      ...base,
      narrative,
      notices: [
        {
          title: "Opening update",
          text: "Delayed opening",
          severity: "critical",
        },
      ],
      lifts: [
        {
          name: "Collins",
          status: "hold",
          rawStatus: "Wind hold",
          hours: "9:15 AM–4 PM",
          note: "Reassessing at 10 AM",
        },
      ],
      terrain: [
        {
          name: "Ballroom",
          status: "scheduled",
          rawStatus: "Expected later",
          kind: "area",
          note: "Patrol work in progress",
        },
      ],
    },
  };
  const { container } = render(
    <ResortSlide source={source} now={FIXTURE_NOW} presentation="browse" />,
  );
  expect(
    screen
      .getByText("Opening update")
      .compareDocumentPosition(
        screen.getByRole("heading", { name: "Snowfall" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(container.querySelector(".resort-narrative > p")?.textContent).toBe(
    narrative,
  );
  expect(screen.getByText("9:15 AM–4 PM")).toBeTruthy();
  expect(screen.getByText("Patrol work in progress")).toBeTruthy();
});

it("preserves Alta's own snow windows and distinguishes zero, empty and unsupported fields", () => {
  const base = report.sources.alta.payload as ResortReport;
  const source: ApiSource<ResortReport> = {
    ...report.sources.alta,
    payload: {
      ...base,
      snowfall: {
        ...base.snowfall,
        h24: { state: "not_reported", label: "24-hour snow" },
      },
    },
  };
  const { container } = render(
    <ResortSlide source={source} now={FIXTURE_NOW} presentation="browse" />,
  );
  expect(
    container.querySelector(".resort-snow__headline")?.textContent,
  ).toContain("Last 12 hrs");
  expect(
    container.querySelector(".resort-snow__headline .metric--not_reported")
      ?.textContent,
  ).toContain("not reported");
  expect(
    container.querySelector(".resort-snow__headline .metric__value--zero")
      ?.textContent,
  ).toContain("0");
  expect(
    container.querySelector(".resort-snow__unavailable")?.textContent,
  ).toContain("Not provided by Alta");
});

it("explains Brighton's missing observations and handles a completely unavailable resort", () => {
  const { rerender } = render(
    renderSection("brighton", report, FIXTURE_NOW, null, "browse"),
  );
  expect(
    screen.getByText(/observations aren’t provided in Brighton/),
  ).toBeTruthy();
  rerender(
    <ResortSlide
      source={{ ...report.sources.brighton, payload: null }}
      now={FIXTURE_NOW}
      presentation="browse"
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Brighton report unavailable" }),
  ).toBeTruthy();
});
