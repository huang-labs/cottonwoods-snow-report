import { describe, expect, it } from "vitest";
import { runCollection } from "@/lib/collect";
import {
  captureTime,
  parseAltaCams,
  parseSnowbirdCams,
  resortCamsSource,
  youtubeIds,
} from "@/lib/sources/resortcams";
import { MemoryKV, readSnapshot } from "@/lib/store";
import type { ResortCamsPayload } from "@/lib/types";
import { createFixtureFetch, fixture, FIXTURE_NOW } from "./fixtureFetch";

const collect = async (kv: MemoryKV, fetchImpl: typeof fetch) => {
  await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl, only: ["resortcams"] });
  const rec = (await readSnapshot(kv))!.sources.resortcams!;
  return { rec, payload: rec.payload as ResortCamsPayload };
};

describe("resort webcam discovery", () => {
  it("Alta: reads the camera list from window.Alta on the weather page", () => {
    const cams = parseAltaCams(fixture("alta-weather.html"));
    expect(cams.find((c) => c.title === "Snow Stake")?.imageUrl).toBe(
      "https://alta-webcams.sfo3.cdn.digitaloceanspaces.com/Collins_Snow_Stake.jpg",
    );
    expect(cams.some((c) => c.title === "Albion Basin")).toBe(true);
  });

  it("Snowbird: pairs each webcam card's name with its own image", () => {
    const cams = parseSnowbirdCams(fixture("snowbird-webcams.html"));
    expect(cams.find((c) => c.title === "Tram Bullpen")?.imageUrl).toBe("https://manage.hdrelay.com/snapshot/61b2490be101c00b9c48374f");
    expect(cams.find((c) => c.title === "Snowstake")?.imageUrl).toBe("https://manage.hdrelay.com/snapshot/8611e276-7ee5-42c0-b8cd-d9e1890e1cd4");
  });

  it("finds YouTube live embeds", () => {
    expect(youtubeIds(fixture("brighton-conditions.html"))).toContain("N-d3MuOagLg");
    expect(youtubeIds(fixture("solitude-webcams.html"))).toHaveLength(12);
  });

  it("ignores Last-Modified values in the future", () => {
    expect(captureTime("Sat, 31 Oct 2026 00:55:00 GMT", FIXTURE_NOW)).toBe("2026-10-31T00:55:00.000Z");
    expect(captureTime("Sat, 31 Oct 2026 02:00:00 GMT", FIXTURE_NOW)).toBeNull();
    expect(captureTime(null, FIXTURE_NOW)).toBeNull();
  });
});

describe("resort webcam collection", () => {
  it("picks lift-line cams by the resort's own camera names (YouTube titles via oEmbed)", async () => {
    const { fetchImpl } = createFixtureFetch();
    const { rec, payload } = await collect(new MemoryKV(), fetchImpl);
    expect(rec.status).toBe("ok");
    expect(payload.failures).toEqual([]);
    const summary = payload.cameras.map((c) => [c.resort, c.title, c.kind === "youtube" ? c.videoId : c.capturedAt]);
    expect(summary).toEqual([
      ["alta", "Snow Stake", "2026-10-31T00:55:00.000Z"],
      ["alta", "Albion Basin", null], // future Last-Modified rejected
      ["snowbird", "Snowstake", "2026-10-31T00:52:00.000Z"],
      ["snowbird", "Tram Bullpen", "2026-10-31T00:52:00.000Z"],
      ["solitude", "Moonbeam Lift Line", "NSiItCGabfo"],
      ["solitude", "Apex Express and Sunrise Lift Lines", "l2X9DlRzX54"],
      ["brighton", "Milly Express", "N-d3MuOagLg"],
      ["brighton", "Parking Lot", "4a-3iEM7bHk"],
    ]);
  });

  it("reuses known stream titles instead of re-querying oEmbed", async () => {
    const kv = new MemoryKV();
    const { fetchImpl, calls } = createFixtureFetch();
    await collect(kv, fetchImpl);
    const before = calls.filter((u) => u.includes("oembed")).length;
    await collect(kv, fetchImpl);
    const after = calls.filter((u) => u.includes("oembed")).length - before;
    expect(before).toBeGreaterThan(0);
    // Only embeds without a public oEmbed (private/unlisted) are looked up again.
    expect(after).toBeLessThanOrEqual(1);
  });

  it("isolates a failing resort page and keeps that resort's previous cameras", async () => {
    const kv = new MemoryKV();
    await collect(kv, createFixtureFetch().fetchImpl);
    const { fetchImpl } = createFixtureFetch([[/snowbird\.com\/the-mountain\/webcams/, () => new Response("down", { status: 503 })]]);
    const { rec, payload } = await collect(kv, fetchImpl);
    expect(rec.status).toBe("ok");
    expect(payload.failures).toEqual([expect.stringMatching(/^snowbird: .*503/)]);
    expect(payload.cameras.filter((c) => c.resort === "snowbird").map((c) => c.title)).toEqual(["Snowstake", "Tram Bullpen"]);
    expect(payload.cameras.filter((c) => c.resort === "alta")).toHaveLength(2);
  });

  it("drops a camera whose image is not reachable", async () => {
    const { fetchImpl } = createFixtureFetch([[/manage\.hdrelay\.com\/snapshot\/61b2/, () => new Response("err", { status: 500 })]]);
    const { payload } = await collect(new MemoryKV(), fetchImpl);
    expect(payload.cameras.filter((c) => c.resort === "snowbird").map((c) => c.title)).toEqual(["Snowstake"]);
  });

  it("is not a required source", () => {
    expect(resortCamsSource.required).toBe(false);
  });
});
