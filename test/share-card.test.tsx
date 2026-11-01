import { ImageResponse } from "next/og";
import { decode } from "fast-png";
import { describe, expect, it } from "vitest";
import { ShareCard, SHARE_CARD_FONTS } from "@/lib/og/card-image";
import { shareCardData } from "@/lib/og/shareCard";
import { runCollection } from "@/lib/collect";
import { buildReport } from "@/lib/report";
import { MemoryKV, readSnapshot } from "@/lib/store";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

describe("share preview", () => {
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
    // Text must produce thousands of bright pixels, not just a dark background.
    let bright = 0;
    for (let i = 0; i < png.data.length; i += png.channels) {
      if (png.data[i] > 180 && png.data[i + 1] > 180 && png.data[i + 2] > 180) bright++;
    }
    expect(bright).toBeGreaterThan(5000);
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
