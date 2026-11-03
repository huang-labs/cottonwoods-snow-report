import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchContext, UpstreamError } from "@/lib/http";

afterEach(() => vi.useRealTimers());

describe("upstream response budgets", () => {
  it.each(["fetchText", "fetchJson", "fetchBytes"] as const)("%s times out after headers if the body stalls", async (method) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const cancel = vi.fn();
    const ctx = createFetchContext({}, new Date(), async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Response(new ReadableStream({ cancel }));
    });
    const result = ctx[method]("https://upstream.test/?token=private", { timeoutMs: 10 });
    const rejected = expect(result).rejects.toMatchObject({ name: "UpstreamError", status: 200, message: expect.stringContaining("timeout") });
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.calls).toEqual([{ url: "https://upstream.test/?token=[redacted]", status: 200, ms: 10 }]);
  });

  it.each(["fetchText", "fetchJson", "fetchBytes"] as const)("%s enforces streamed byte limits without buffering the rest", async (method) => {
    const cancel = vi.fn();
    const ctx = createFetchContext({}, new Date(), async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4, 5, 6])); },
      cancel,
    })));
    await expect(ctx[method]("https://upstream.test", { maxBytes: 4 })).rejects.toThrow("body too large");
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.calls).toHaveLength(1);
  });

  it("rejects oversized declared bodies and bad content types and cancels them", async () => {
    for (const headers of [new Headers({ "content-length": "100" }), new Headers({ "content-type": "text/html" })]) {
      const cancel = vi.fn();
      const ctx = createFetchContext({}, new Date(), async () => new Response(new ReadableStream({ cancel }), { headers }));
      await expect(ctx.fetchBytes("https://upstream.test", { maxBytes: 4, ...(headers.has("content-type") ? { contentType: "image/" } : {}) })).rejects.toBeInstanceOf(UpstreamError);
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it("reads UTF-8 split across chunks and parses JSON at the exact limit", async () => {
    const bytes = new TextEncoder().encode('{"snow":"❄"}');
    const ctx = createFetchContext({}, new Date(), async () => new Response(new ReadableStream({
      start(c) { for (const b of bytes) c.enqueue(new Uint8Array([b])); c.close(); },
    })));
    expect(await ctx.fetchJson("https://upstream.test", { maxBytes: bytes.length })).toEqual({ snow: "❄" });
    expect(await ctx.fetchText("https://upstream.test", { maxBytes: bytes.length })).toBe('{"snow":"❄"}');
  });

  it("bounds a fetch that never returns headers", async () => {
    vi.useFakeTimers();
    const ctx = createFetchContext({}, new Date(), () => new Promise(() => {}));
    const rejected = expect(ctx.fetchText("https://upstream.test", { timeoutMs: 10 })).rejects.toMatchObject({ status: null });
    await vi.advanceTimersByTimeAsync(11);
    await rejected;
    expect(ctx.calls).toHaveLength(1);
  });

  it("cancels the ranged probe fallback without reading its body", async () => {
    const cancel = vi.fn();
    const ctx = createFetchContext({}, new Date(), async (_url, init) => init?.method === "HEAD"
      ? new Response(null, { status: 405 }) : new Response(new ReadableStream({ cancel })));
    expect((await ctx.probe("https://upstream.test")).status).toBe(200);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ctx.calls.map((c) => c.status)).toEqual([405, 200]);
  });
});
