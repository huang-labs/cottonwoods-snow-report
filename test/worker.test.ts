import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker";
import type { CollectSummary } from "@/lib/collect";
import type { WorkerEnv } from "@/worker/env";
import { MemoryKV, readSnapshot, writeSnapshot } from "@/lib/store";
import { dailySnowFigureKey, dailySnowKey, emptyDailySnowState } from "@/lib/dailysnow";
import { DAILY_SNOW_PUBLIC_POSTS } from "@/lib/report";
import type { DailySnowHistoryEntry, DailySnowPost } from "@/lib/types";
import { createFixtureFetch, FIXTURE_NOW } from "./fixtureFetch";

function setup(adminToken?: string) {
  const env: WorkerEnv = {
    SNOW_KV: new MemoryKV(),
    ASSETS: { fetch: vi.fn(async () => new Response("static page")) },
    ADMIN_TOKEN: adminToken,
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as unknown as ExecutionContext;
  const call = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://snow.test${path}`, init), env, ctx);
  return { env, ctx, pending, call };
}

afterEach(() => vi.restoreAllMocks());

describe("Worker request routing", () => {
  it("serves reports, plume panels and HEAD without invoking assets or upstreams", async () => {
    const { env, call } = setup();
    const fetch = vi.spyOn(globalThis, "fetch");
    expect((await call("/api/report")).status).toBe(200);
    const head = await call("/api/report", { method: "HEAD" });
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(await head.text()).toBe("");
    await env.SNOW_KV.put("plume-panel:v1:CLN:2026110100:snow", new Uint8Array([137, 80, 78, 71]).buffer);
    const panel = await call("/api/plume/CLN/2026110100/snow");
    expect(panel.headers.get("content-type")).toBe("image/png");
    expect(panel.headers.get("cache-control")).toContain("immutable");
    expect((await panel.arrayBuffer()).byteLength).toBe(4);
    expect(fetch).not.toHaveBeenCalled();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("keeps unknown APIs out of the static fallback and enforces methods", async () => {
    const { env, call } = setup();
    for (const path of ["/api", "/api/missing", "/api/report/extra", "/api/plume/CLN/2026110100/snow/extra"]) {
      expect((await call(path)).status).toBe(404);
    }
    for (const path of ["/api/report", "/api/daily-snow", "/api/daily-snow/figure/2026-11-01/stake-alta", "/api/plume/CLN/2026110100/snow", "/opengraph-image", "/daily-snow/opengraph-image"]) {
      const res = await call(path, { method: "POST" });
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET, HEAD");
    }
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    expect(await (await call("/weather")).text()).toBe("static page");
    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
  });

  it("serves archived Daily Snow and figure stills directly from KV", async () => {
    const { env, call } = setup();
    const post: DailySnowPost = {
      date: "2026-11-01", phase: "quiet", title: "Daily forecast", summary: "Quiet weather.",
      sections: [], figures: {}, numbers: { canyons: [], resorts: [] },
      generatedAt: FIXTURE_NOW.toISOString(), model: "test-model", trigger: "morning",
    };
    expect((await call("/api/daily-snow")).status).toBe(400);
    expect((await call("/api/daily-snow?date=2026-11-01")).status).toBe(404);
    await env.SNOW_KV.put(dailySnowKey(post.date), JSON.stringify(post));
    // Stored but not indexed in the snapshot history: not public.
    expect((await call("/api/daily-snow?date=2026-11-01")).status).toBe(404);
    await writeSnapshot(env.SNOW_KV, {
      schemaVersion: 1, writtenAt: FIXTURE_NOW.toISOString(), sources: {},
      dailySnow: { ...emptyDailySnowState(), history: [{ date: post.date, title: post.title, phase: "quiet", forecast: [] }] },
    });
    const res = await call("/api/daily-snow?date=2026-11-01");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: post.title, date: post.date });
    const key = dailySnowFigureKey(post.date, "stake-alta");
    await env.SNOW_KV.put(key, new Uint8Array([0xff, 0xd8, 0xff]).buffer);
    const figure = await call("/api/daily-snow/figure/2026-11-01/stake-alta");
    expect(figure.status).toBe(200);
    expect(figure.headers.get("content-type")).toBe("image/jpeg");
    expect(figure.headers.get("cache-control")).toContain("immutable");
    expect((await figure.arrayBuffer()).byteLength).toBe(3);
    await env.SNOW_KV.put(key, new Uint8Array([0, 1, 2]).buffer);
    expect((await call("/api/daily-snow/figure/2026-11-01/stake-alta")).status).toBe(404);
    expect((await call("/api/daily-snow/figure/not-a-date/stake-alta")).status).toBe(404);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it("serves only the most recent posts by date; older stored posts stay in KV", async () => {
    const { env, call } = setup();
    // An index left over from before the window shrank: 12 posts, newest first.
    const dates = Array.from({ length: 12 }, (_, i) => `2026-10-${String(31 - i).padStart(2, "0")}`);
    const history: DailySnowHistoryEntry[] = dates.map((date) => ({ date, title: `Post ${date}`, phase: "quiet", forecast: [] }));
    await writeSnapshot(env.SNOW_KV, { schemaVersion: 1, writtenAt: FIXTURE_NOW.toISOString(), sources: {}, dailySnow: { ...emptyDailySnowState(), history } });
    for (const date of dates) {
      const post: DailySnowPost = {
        date, phase: "quiet", title: `Post ${date}`, summary: "Quiet weather.", sections: [], figures: {},
        numbers: { canyons: [], resorts: [] }, generatedAt: FIXTURE_NOW.toISOString(), model: "test-model", trigger: "morning",
      };
      await env.SNOW_KV.put(dailySnowKey(date), JSON.stringify(post));
    }
    const newest = await call(`/api/daily-snow?date=${dates[0]}`);
    expect(newest.status).toBe(200);
    expect(((await newest.json()) as { archive: unknown[] }).archive).toHaveLength(DAILY_SNOW_PUBLIC_POSTS);
    expect((await call(`/api/daily-snow?date=${dates[DAILY_SNOW_PUBLIC_POSTS - 1]}`)).status).toBe(200);
    expect((await call(`/api/daily-snow?date=${dates[DAILY_SNOW_PUBLIC_POSTS]}`)).status).toBe(404);
    expect(await env.SNOW_KV.get(dailySnowKey(dates[DAILY_SNOW_PUBLIC_POSTS]), "text")).not.toBeNull();
  });

  it("disables admin collection without a token and requires authorization when enabled", async () => {
    const disabled = setup();
    expect((await disabled.call("/api/admin/collect", { method: "POST" })).status).toBe(404);
    const { call, env } = setup("test-token");
    expect((await call("/api/admin/collect")).headers.get("allow")).toBe("POST");
    expect((await call("/api/admin/collect", { method: "POST" })).status).toBe(401);
    const { fetchImpl } = createFixtureFetch();
    vi.spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
    const res = await call("/api/admin/collect?source=alta", {
      method: "POST", headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as CollectSummary).results.map((r: { id: string }) => r.id)).toEqual(["alta"]);
    expect((await readSnapshot(env.SNOW_KV))?.sources.alta?.payload).toBeTruthy();
  });

  it("collects on scheduled events using the same direct bindings", async () => {
    const { env, ctx, pending } = setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(createFixtureFetch().fetchImpl);
    vi.spyOn(console, "log").mockImplementation(() => {});
    await worker.scheduled({ scheduledTime: FIXTURE_NOW.getTime(), cron: "*/5 * * * *" } as ScheduledController, env, ctx);
    await Promise.all(pending);
    expect((await readSnapshot(env.SNOW_KV))?.sources.alta?.status).toBe("ok");
  });
});
