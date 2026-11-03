import { ImageResponse } from "@cf-wasm/og";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { decode } from "fast-png";
import { describe, expect, it } from "vitest";
import { ShareCard, SHARE_CARD_FONTS } from "@/lib/og/card-image";
import { BrandedShareCard } from "@/lib/og/branded-image";
import { DailySnowShareCard } from "@/lib/og/daily-snow-image";
import { shareCardData } from "@/lib/og/shareCard";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { MemoryKV, readSnapshot } from "@/lib/store";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

function expectLightImage(png: ReturnType<typeof decode>) {
  expect([png.width, png.height]).toEqual([1200, 630]);
  expect(Array.from(png.data.slice(0, 3))).toEqual([248, 250, 252]);
  let dark = 0;
  let light = 0;
  let headerInk = 0;
  let footerInk = 0;
  for (let i = 0; i < png.data.length; i += png.channels) {
    if (png.data[i] < 100 && png.data[i + 1] < 130 && png.data[i + 2] < 160) {
      dark++;
      const y = Math.floor(i / png.channels / png.width);
      if (y >= 48 && y < 95) headerInk++;
      if (y >= 540 && y < 590) footerInk++;
    }
    if (png.data[i] > 230 && png.data[i + 1] > 230 && png.data[i + 2] > 230) light++;
  }
  expect(dark).toBeGreaterThan(5000);
  expect(footerInk).toBeGreaterThan(500);
  expect(light).toBeGreaterThan(png.width * png.height * 0.7);
  return headerInk;
}

describe("share preview", () => {
  it("ships the same light branded PNG that its source renders", async () => {
    const response = new ImageResponse(<BrandedShareCard />, { width: 1200, height: 630, fonts: SHARE_CARD_FONTS });
    const rendered = new Uint8Array(await response.arrayBuffer());
    const bundled = await readFile("public/share-brand-v1.png");
    expectLightImage(decode(bundled));
    expect(bundled.equals(Buffer.from(rendered))).toBe(true);
  });

  it("labels generated prose with AI and its model, and keeps the empty fallback unlabelled", () => {
    const post = { date: "2026-11-01", title: "Snow returns", summary: "Fresh snow.", model: "@cf/zai-org/glm-5.3-flash" };
    const html = renderToStaticMarkup(<DailySnowShareCard post={post} />);
    expect(html).toContain(">AI</span>");
    expect(html).toContain("AI-generated forecast · GLM 5.3 Flash");
    expect(html).toContain("November 1, 2026");
    expect(renderToStaticMarkup(<DailySnowShareCard post={null} />)).not.toContain("AI-generated");
  });

  it("renders zero, unavailable, large totals and a forecast together", async () => {
    const data = {
      updated: "Nov 3, 2026, 6:00 AM",
      resorts: [0, null, 12.5, 100].map((snow24, i) => ({ name: ["Alta", "Snowbird", "Solitude", "Brighton"][i], snow24, detail: null, status: null })),
      storm: { inches: 12.5, where: "Little Cottonwood Canyon", when: "Tomorrow 6 AM → Friday 6 PM" },
    };
    const html = renderToStaticMarkup(<ShareCard data={data} />);
    expect(html).toContain("Not reported");
    expect(html).toContain(">0</span>");
    expect(html).toContain("NWS forecast");
    const response = new ImageResponse(<ShareCard data={data} />, { width: 1200, height: 630, fonts: SHARE_CARD_FONTS });
    expectLightImage(decode(new Uint8Array(await response.arrayBuffer())));
  });
  it.each([
    null,
    { date: "2026-11-01", title: "Snow returns to the Cottonwoods", summary: "A cold front brings fresh snow to both canyons.", model: "@cf/zai-org/glm-5.3-flash" },
    { date: "2026-11-01", title: "A long forecast headline ".repeat(20), summary: "A detailed forecast summary. ".repeat(30), model: "@cf/openai/gpt-oss-120b" },
  ])("renders the daily forecast card with fallback and long copy", async (post) => {
    const response = new ImageResponse(<DailySnowShareCard post={post} />, {
      width: 1200, height: 630, fonts: SHARE_CARD_FONTS,
    });
    const png = decode(new Uint8Array(await response.arrayBuffer()));
    expect([png.width, png.height]).toEqual([1200, 630]);
    expect(expectLightImage(png)).toBeGreaterThan(1000);
  });

  it("renders a nonblank 1200×630 PNG even before collection", async () => {
    const data = shareCardData(buildReport(null, FIXTURE_NOW), FIXTURE_NOW);
    expect(data.resorts).toHaveLength(4);
    expect(data.resorts.every((r) => r.snow24 === null)).toBe(true);
    expect(data.storm).toBeNull();
    const response = new ImageResponse(<ShareCard data={data} />, {
      width: 1200, height: 630, fonts: SHARE_CARD_FONTS,
    });
    const png = decode(new Uint8Array(await response.arrayBuffer()));
    expect([png.width, png.height]).toEqual([1200, 630]);
    expect(expectLightImage(png)).toBeGreaterThan(1000);
  });

  it("uses current reports and hides stale or old upstream snowfall", async () => {
    const kv = new MemoryKV();
    const { fetchImpl } = createFixtureFetch();
    await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl });
    const report = buildReport(await readSnapshot(kv), FIXTURE_NOW);
    report.sources.alta.freshness = "current";
    const data = shareCardData(report, FIXTURE_NOW);
    expect(data.resorts[0].snow24).not.toBeNull();
    expect(data.updated).toContain("2026");
    report.sources.alta.freshness = "stale";
    report.sources.snowbird.freshness = "old-report";
    report.sources.nws.freshness = "stale";
    const stale = shareCardData(report, FIXTURE_NOW);
    expect(stale.resorts.slice(0, 2).map((r) => r.snow24)).toEqual([null, null]);
    expect(stale.storm).toBeNull();
  });
});
