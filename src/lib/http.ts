import type { KVLike } from "./store";
export interface UpstreamCall {
  url: string;
  status: number | null;
  ms: number;
}

export interface FetchContext {
  now: Date;
  env: CollectorSecrets;
  calls: UpstreamCall[];
  fetchText(url: string, init?: FetchOptions): Promise<string>;
  fetchJson<T = unknown>(url: string, init?: FetchOptions): Promise<T>;
  /** GET a binary body, checking its content type prefix (e.g. "image/"). */
  fetchBytes(url: string, init?: FetchOptions & { contentType?: string; maxBytes?: number }): Promise<Uint8Array>;
  /** Blob storage for derived artifacts (cropped plume panels); absent in unit tests of pure parsers. */
  kv?: KVLike;
  /** Payload from the last successful collection of this source, if any. */
  previous: unknown;
  /** HEAD (falling back to ranged GET) — returns status + headers without reading the body. */
  probe(url: string, init?: FetchOptions): Promise<{ status: number; headers: Headers }>;
}

export interface CollectorSecrets {
  UDOT_API_KEY?: string;
  COLLECTOR_CONTACT?: string;
}

export interface FetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Use browser-like headers (some resort CDNs reject generic clients). */
  browserLike?: boolean;
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** Redact credentials from URLs before they are stored in diagnostics. */
export function redactUrl(url: string): string {
  return url.replace(/([?&](?:key|bearer_token|token|api_key)=)[^&]+/gi, "$1[redacted]");
}

export function createFetchContext(
  env: CollectorSecrets,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  extra: { kv?: KVLike; previous?: unknown } = {},
): FetchContext {
  const calls: UpstreamCall[] = [];
  const ua = `cottonwoods-snow-report/0.1${env.COLLECTOR_CONTACT ? ` (${env.COLLECTOR_CONTACT})` : ""}`;

  async function raw(url: string, method: string, init: FetchOptions = {}): Promise<Response> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
    const headers: Record<string, string> = init.browserLike
      ? { ...BROWSER_HEADERS, ...init.headers }
      : { "User-Agent": ua, Accept: "application/json, text/html;q=0.9, */*;q=0.5", ...init.headers };
    try {
      const res = await fetchImpl(url, { method, headers, signal: controller.signal, redirect: "follow" });
      calls.push({ url: redactUrl(url), status: res.status, ms: Date.now() - started });
      return res;
    } catch (err) {
      calls.push({ url: redactUrl(url), status: null, ms: Date.now() - started });
      const msg = err instanceof Error && err.name === "AbortError" ? "timeout" : String(err);
      throw new UpstreamError(`${method} ${redactUrl(url)} failed: ${msg}`, redactUrl(url), null);
    } finally {
      clearTimeout(timer);
    }
  }

  async function okResponse(url: string, init?: FetchOptions) {
    const res = await raw(url, "GET", init);
    if (!res.ok) {
      throw new UpstreamError(`GET ${redactUrl(url)} returned HTTP ${res.status}`, redactUrl(url), res.status);
    }
    return res;
  }

  return {
    now,
    env,
    calls,
    kv: extra.kv,
    previous: extra.previous ?? null,
    async fetchBytes(url, init) {
      const res = await okResponse(url, init);
      const type = res.headers.get("content-type") ?? "";
      if (init?.contentType && !type.startsWith(init.contentType)) {
        await res.body?.cancel();
        throw new UpstreamError(`GET ${redactUrl(url)} returned ${type || "no content type"}`, redactUrl(url), res.status);
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      if (init?.maxBytes && buf.byteLength > init.maxBytes) {
        throw new UpstreamError(`GET ${redactUrl(url)} body too large (${buf.byteLength} bytes)`, redactUrl(url), res.status);
      }
      return buf;
    },
    async fetchText(url, init) {
      return (await okResponse(url, init)).text();
    },
    async fetchJson<T>(url: string, init?: FetchOptions) {
      const res = await okResponse(url, init);
      const text = await res.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new UpstreamError(`GET ${redactUrl(url)} returned non-JSON body`, redactUrl(url), res.status);
      }
    },
    async probe(url, init) {
      let res = await raw(url, "HEAD", init);
      // Some camera hosts reject HEAD outright (405/403, or even 500).
      if (res.status >= 400) {
        res = await raw(url, "GET", { ...init, headers: { Range: "bytes=0-0", ...init?.headers } });
        await res.body?.cancel();
      }
      return { status: res.status, headers: res.headers };
    },
  };
}
