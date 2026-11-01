import { decode, encode } from "fast-png";
import { describe, expect, it, vi } from "vitest";
import { runCollection } from "@/lib/collect";
import { cropSnowPanels } from "@/lib/plumeCrop";
import { MemoryKV, plumePanelKey, readSnapshot } from "@/lib/store";
import { denverMidnightsBetween } from "@/lib/time";
import type { PlumePayload } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW, fixtureBytes } from "./fixtureFetch";

const chart = () => fixtureBytes("utah-plume-CLN-2026110100.png");

describe("plume panel cropping", () => {
  it("finds the accumulated snow and SLR panels from the chart's axes frames", () => {
    const panels = cropSnowPanels(chart());
    expect(panels.map((p) => p.id)).toEqual(["snow", "slr"]);
    for (const p of panels) {
      const img = decode(p.png);
      expect([img.width, img.height]).toEqual([p.width, p.height]);
      // Half the 1984 px figure width, title included, UTC tick labels cut off.
      expect(p.width).toBeGreaterThan(850);
      expect(p.width).toBeLessThan(1000);
      expect(p.height).toBeGreaterThan(450);
      expect(p.height).toBeLessThan(600);
      expect(p.plot.left).toBeGreaterThan(40); // y-axis label and tick labels kept
      expect(p.plot.right - p.plot.left).toBeGreaterThan(800);
      expect(p.plot.top).toBeGreaterThan(15); // panel title kept
      expect(p.height - p.plot.bottom).toBeLessThan(15); // only tick marks below the frame
    }
  });

  it("refuses an image without the expected panel layout", () => {
    const blank = encode({ width: 400, height: 300, data: new Uint8Array(400 * 300 * 4).fill(255), channels: 4, depth: 8 });
    expect(() => cropSnowPanels(blank)).toThrow(/frame edge columns/);
  });
});

describe("plume collection", () => {
  it("stores cropped panels per station and run, and references them by same-origin URL", async () => {
    const kv = new MemoryKV();
    const { fetchImpl } = createFixtureFetch();
    await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl, only: ["plumes"] });
    const p = (await readSnapshot(kv))!.sources.plumes!.payload as PlumePayload;
    for (const c of p.charts) {
      expect(c.cropError).toBeNull();
      expect(c.forecastHours).toBe(240);
      expect(c.panels!.map((x) => x.url)).toEqual([
        `/api/plume/${c.stationCode}/2026103012/snow`,
        `/api/plume/${c.stationCode}/2026103012/slr`,
      ]);
      const stored = await kv.get(plumePanelKey(c.stationCode, "2026103012", "snow"), "arrayBuffer");
      expect(decode(new Uint8Array(stored!)).width).toBe(c.panels![0].width);
    }
  });

  it("crops each run once; later collections of the same run reuse the stored panels", async () => {
    const kv = new MemoryKV();
    const { fetchImpl, calls } = createFixtureFetch();
    await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl, only: ["plumes"] });
    const first = calls.filter((u) => u.endsWith(".png")).length;
    await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl, only: ["plumes"] });
    const second = calls.filter((u) => u.endsWith(".png")).length - first;
    expect(second).toBe(2); // one HEAD per station, no re-download
    const p = (await readSnapshot(kv))!.sources.plumes!.payload as PlumePayload;
    expect(p.charts.every((c) => c.panels?.length === 2)).toBe(true);
  });

  it("falls back to the full original chart when cropping fails", async () => {
    const kv = new MemoryKV();
    const notAChart = encode({ width: 40, height: 30, data: new Uint8Array(40 * 30 * 4).fill(255), channels: 4, depth: 8 });
    const { fetchImpl } = createFixtureFetch([
      [/weather\.utah\.edu\/.*\.png$/, (_u, init) => new Response(init?.method === "HEAD" ? null : (notAChart.slice().buffer as ArrayBuffer), { headers: { "content-type": "image/png" } })],
    ]);
    const summary = await runCollection({ SNOW_KV: kv }, { now: FIXTURE_NOW, fetchImpl, only: ["plumes"] });
    expect(summary.results[0].ok).toBe(true); // the plume run itself is still valid
    const p = (await readSnapshot(kv))!.sources.plumes!.payload as PlumePayload;
    expect(p.charts.every((c) => c.panels === null && c.cropError)).toBe(true);
    expect(p.charts[0].imageUrl).toMatch(/^https:\/\/weather\.utah\.edu\//);
  });
});

describe("GET /api/plume/[station]/[run]/[panel]", () => {
  const call = async (kv: MemoryKV, station: string, run: string, panel: string) => {
    vi.resetModules();
    vi.doMock("@opennextjs/cloudflare", () => ({ getCloudflareContext: async () => ({ env: { SNOW_KV: kv } }) }));
    const { GET } = await import("@/app/api/plume/[station]/[run]/[panel]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ station, run, panel }) });
    vi.doUnmock("@opennextjs/cloudflare");
    return res;
  };

  it("serves a stored panel as a long-cacheable PNG", async () => {
    const kv = new MemoryKV();
    await kv.put(plumePanelKey("CLN", "2026110100", "slr"), new Uint8Array([137, 80, 78, 71]).buffer);
    const res = await call(kv, "CLN", "2026110100", "slr");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("rejects unknown stations, runs and panels without touching storage", async () => {
    const kv = new MemoryKV();
    const spy = vi.spyOn(kv, "get");
    for (const [s, r, p] of [["XYZ", "2026110100", "snow"], ["CLN", "latest", "snow"], ["CLN", "2026110100", "precip"]]) {
      expect((await call(kv, s, r, p)).status).toBe(404);
    }
    expect(spy).not.toHaveBeenCalled();
    expect((await call(kv, "CLN", "2026110100", "snow")).status).toBe(404); // valid but not stored
  });
});

describe("Mountain Time axis", () => {
  it("lists Denver midnights across the end of DST", () => {
    const start = new Date("2026-10-31T00:00:00Z"); // Oct 30, 6 PM MDT
    const ms = denverMidnightsBetween(start, new Date(start.getTime() + 72 * 3_600_000));
    expect(ms.map((d) => d.toISOString())).toEqual([
      "2026-10-31T06:00:00.000Z", // Oct 31 00:00 MDT
      "2026-11-01T06:00:00.000Z", // Nov 1 00:00 MDT (DST ends at 2 AM)
      "2026-11-02T07:00:00.000Z", // Nov 2 00:00 MST
    ]);
  });
});
