// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { renderSection } from "@/components/SectionView";
import { ResortReportPage } from "@/components/sections/ResortReportPage";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { MemoryKV, readSnapshot } from "@/lib/store";
import type { ApiSource, ReportResponse, ResortCamsPayload, ResortReport } from "@/lib/types";
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
  "renders %s as a long-form report page",
  (id) => {
    const { container } = render(
      renderSection(id, report, FIXTURE_NOW, null),
    );
    expect(container.querySelector(".resort-report")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Lifts" }),
    ).toBeTruthy();
    // Named terrain & gates is a sibling of Lifts, not a sub-heading.
    const terrain = screen.getByRole("heading", { name: "Named terrain & gates" });
    expect(terrain.tagName).toBe("H2");
    expect(
      screen.getByRole("heading", { name: "Lifts" }).tagName,
    ).toBe("H2");
    expect(screen.queryByRole("heading", { name: "Getting there" })).toBeNull();
  },
);

it("capitalizes every lift and terrain status regardless of source casing", () => {
  for (const id of ["alta", "snowbird", "solitude", "brighton"]) {
    const { container } = render(renderSection(id, report, FIXTURE_NOW, null));
    for (const span of container.querySelectorAll(".status-item__row span")) {
      const label = (span.textContent ?? "").trim();
      if (label) expect(label).toMatch(/^[A-Z]/);
    }
    cleanup();
  }
});

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
    <ResortReportPage source={source} now={FIXTURE_NOW} />,
  );
  expect(
    screen
      .getByText("Opening update")
      .compareDocumentPosition(
        screen.getByRole("heading", { name: "Snowfall" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    container.querySelector(".resort-narrative details > p")?.textContent,
  ).toBe(narrative);
  const disclosure = container.querySelector<HTMLDetailsElement>(
    ".resort-narrative details",
  )!;
  expect(disclosure.open).toBe(false);
  expect(
    container.querySelector(".resort-narrative__preview")?.textContent?.length,
  ).toBeLessThanOrEqual(241);
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(disclosure.open).toBe(true);
  fireEvent.click(disclosure.querySelector("summary")!);
  expect(disclosure.open).toBe(false);
  expect(
    container
      .querySelector(".resort-weather")
      ?.nextElementSibling?.classList.contains("resort-narrative"),
  ).toBe(true);
  expect(
    container
      .querySelector(".resort-narrative")
      ?.nextElementSibling?.classList.contains("resort-operations"),
  ).toBe(true);
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
    <ResortReportPage source={source} now={FIXTURE_NOW} />,
  );
  expect(
    container.querySelector(".resort-snow__headline")?.textContent,
  ).toContain("12 h");
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
    renderSection("brighton", report, FIXTURE_NOW, null),
  );
  expect(
    screen.getByText(/observations aren’t provided in Brighton/),
  ).toBeTruthy();
  rerender(
    <ResortReportPage
      source={{ ...report.sources.brighton, payload: null }}
      now={FIXTURE_NOW}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Brighton report unavailable" }),
  ).toBeTruthy();
});

it("removes routine road status and shows Alta's Base, Mid and Top temperatures without the unsited Wind block", () => {
  const { container } = render(
    renderSection("alta", report, FIXTURE_NOW, null),
  );
  expect(screen.queryByText("Road Status")).toBeNull();
  expect(
    [...container.querySelectorAll(".resort-observation h3")].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(["Base", "Mid", "Top"]);
  expect(
    [...container.querySelectorAll(".resort-observation dt")].map(
      (label) => label.textContent,
    ),
  ).toEqual(["Temperature", "Temperature", "Temperature"]);
});

it("shows every collected webcam on its resort page, featured ones first", () => {
  const cams = report.sources.resortcams?.payload as ResortCamsPayload | undefined;
  for (const id of ["alta", "snowbird", "solitude", "brighton"]) {
    const { container, unmount } = render(renderSection(id, report, FIXTURE_NOW, null));
    const shown = [...container.querySelectorAll(".resort-cams .rcam figcaption strong")].map((t) => t.textContent);
    expect(shown).toEqual(cams!.cameras.filter((c) => c.resort === id).map((c) => c.title));
    unmount();
  }
  // The featured cameras lead each section in WANTED order.
  const first = (id: string) => {
    const { container, unmount } = render(renderSection(id, report, FIXTURE_NOW, null));
    const title = container.querySelector(".resort-cams .rcam figcaption strong")!.textContent;
    unmount();
    return title;
  };
  expect(first("alta")).toBe("Snow Stake");
  expect(first("snowbird")).toBe("Snowstake");
  expect(first("solitude")).toBe("Solitude Snowstake");
  expect(first("brighton")).toBe("Parking Lot");
});

it("shows the same snowfall slots in the same order for every resort", () => {
  const slots = (id: string) => {
    const { container, unmount } = render(renderSection(id, report, FIXTURE_NOW, null));
    const labels = [...container.querySelectorAll(".resort-snow .resort-metric__label")].map((l) => l.textContent);
    unmount();
    return labels;
  };
  const tail = ["48 h", "72 h", "7 days", "Storm", "Season"];
  // Alta publishes 12 h instead of overnight, so its new-snow tile is 12 h and overnight moves to the row.
  expect(slots("alta")).toEqual(["12 h", "24 h", "Base depth", "Overnight", ...tail]);
  for (const id of ["snowbird", "solitude", "brighton"]) {
    expect(slots(id)).toEqual(["Overnight", "24 h", "Base depth", "12 h", ...tail]);
  }
});

it("keeps a resort's wording only where its window differs, and lists shared source notes once", () => {
  const base = report.sources.solitude.payload as ResortReport;
  const note = "Mid-Mountain measurement location";
  const source: ApiSource<ResortReport> = {
    ...report.sources.solitude,
    payload: {
      ...base,
      snowfall: {
        ...base.snowfall,
        overnight: { state: "reported", value: 2, unit: "in", label: "Since lifts closed", note },
        h24: { state: "reported", value: 5, unit: "in", label: "Last 24 hours", note },
      },
    },
  };
  const { container } = render(<ResortReportPage source={source} now={FIXTURE_NOW} />);
  const qualifiers = [...container.querySelectorAll(".resort-metric__qualifier")].map((q) => q.textContent);
  expect(qualifiers).toEqual(["Since lifts closed"]);
  const notes = container.querySelector(".resort-snow__notes")!.textContent!;
  expect(notes.split(note)).toHaveLength(2);
  expect(notes).toContain("Overnight, 24 h");
});

it("names each snowfall window in the column header, noting only where a resort's window differs", () => {
  const { container } = render(renderSection("regional", report, FIXTURE_NOW, null));
  // Every window column has a full header (wide screens) and a short one (phones), and is named by the full one.
  const heads = [...container.querySelectorAll(".snow-table thead th")].slice(1, -1);
  expect(heads.map((th) => th.getAttribute("aria-label"))).toEqual(["Overnight / 12 h", "24 h", "48 h", "Storm", "Base"]);
  expect(heads.map((th) => th.querySelector(".col-short")?.textContent)).toEqual(["Overnight", "24 h", "48 h", "Storm", "Base"]);
  const row = (name: string) =>
    [...container.querySelectorAll(".snow-table .row--primary")].find((r) => r.querySelector(".resort-name")?.textContent === name)!;
  const qualifiers = (name: string) => [...row(name).querySelectorAll(".cell-label")].map((s) => s.textContent);
  // Alta's overnight column holds its 12-hour total, and says so.
  expect(qualifiers("Alta")[0]).toBe("12 h");
  // "Snow 24 Hrs." is just the 24 h window: no source wording repeated under the value.
  expect(row("Brighton").textContent).not.toContain("Snow 24 Hrs.");
});

it("shows main travel routes per canyon and reveals every segment on request", () => {
  const { container } = render(renderSection("traffic", report, FIXTURE_NOW, null));
  const lcc = container.querySelector('[aria-labelledby="canyon-LCC"]') as HTMLElement;
  const rows = () => lcc.querySelectorAll(".travel-table tbody tr").length;
  const toggle = lcc.querySelector<HTMLButtonElement>(".travel__toggle");
  expect(toggle).toBeTruthy();
  const main = rows();
  fireEvent.click(toggle!);
  expect(rows()).toBeGreaterThan(main);
  expect(toggle!.getAttribute("aria-expanded")).toBe("true");
});
