import type { FetchContext } from "../http";
import { decodeEntities } from "../metric";
import type { PrimaryResortId, ResortCam, ResortCamsPayload } from "../types";
import { extractAltaJson } from "./alta";
import { assertValid, type SourceDefinition } from "./types";

/**
 * Resort-operated cameras for the individual resort pages: every camera each
 * resort publishes, with the snow stake and lift lines first.
 *
 * Cameras are discovered from each resort's own webcam page on every run, so
 * re-pointed streams (YouTube live IDs change when a stream restarts) are
 * picked up. Each resort is isolated: one failing page only drops its cameras.
 */

export const ALTA_WEATHER_URL = "https://www.alta.com/weather";
export const SNOWBIRD_WEBCAMS_URL = "https://www.snowbird.com/the-mountain/webcams/view-all-webcams/";
export const SOLITUDE_WEBCAMS_URL = "https://www.solitudemountain.com/mountain-and-village/webcams";
export const BRIGHTON_CONDITIONS_URL = "https://www.brightonresort.com/conditions";

/**
 * Cameras shown first per resort, in this order, matched against the resort's
 * own camera names. Every other camera follows in the resort's page order.
 */
export const FEATURED: Record<PrimaryResortId, RegExp[]> = {
  // Alta publishes no lift-line camera.
  alta: [/^snow stake$/i, /^albion basin$/i],
  // Snow stake first, as at Alta. No Gad Zoom camera is published; Tram
  // Bullpen is Snowbird's lift-line camera.
  snowbird: [/^snowstake$/i, /^tram bullpen$/i],
  solitude: [/moonbeam.*lift line/i, /apex.*sunrise/i],
  brighton: [/milly express/i, /parking lot/i],
};

/** All cameras, featured ones first (in `featured` order), the rest in page order. */
export function featuredFirst<T extends { title: string }>(found: T[], featured: RegExp[]): T[] {
  const first = featured.flatMap((re) => found.find((c) => re.test(c.title)) ?? []);
  return [...new Set([...first, ...found])];
}

/** A Last-Modified header as capture time, rejecting future values (some hosts send local time as GMT). */
export function captureTime(lastModified: string | null, now: Date): string | null {
  if (!lastModified) return null;
  const t = Date.parse(lastModified);
  if (Number.isNaN(t) || t > now.getTime() + 2 * 60_000) return null;
  return new Date(t).toISOString();
}

// ---------- Alta: `window.Alta.weather.mountainCams` on the weather page ----------

export function parseAltaCams(html: string): Array<{ title: string; imageUrl: string }> {
  const data = extractAltaJson(html) as unknown as { weather?: { mountainCams?: Array<{ name?: string; url?: string }> } };
  const cams = data.weather?.mountainCams ?? [];
  assertValid(cams.length > 0, "Alta: weather.mountainCams not found");
  return cams.filter((c) => c.name && c.url).map((c) => ({ title: c.name!, imageUrl: c.url! }));
}

// ---------- Snowbird: webcam cards on the view-all page ----------

/** Cards are `<a aria-label="Tram Bullpen - null - View Webcam" …><img src="https://manage.hdrelay.com/snapshot/…">`. */
export function parseSnowbirdCams(html: string): Array<{ title: string; imageUrl: string }> {
  const out: Array<{ title: string; imageUrl: string }> = [];
  for (const m of html.matchAll(/aria-label="([^"]+?) - [^"]*View Webcam"[^>]*>\s*<img src="(https:\/\/[^"]+)"/g)) {
    const title = decodeEntities(m[1]).trim();
    if (!out.some((c) => c.title === title)) out.push({ title, imageUrl: decodeEntities(m[2]) });
  }
  assertValid(out.length > 0, "Snowbird: no webcam cards found");
  return out;
}

// ---------- Solitude / Brighton: YouTube live embeds ----------

export function youtubeIds(html: string): string[] {
  return [...new Set([...html.matchAll(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/g)].map((m) => m[1]))];
}

interface OEmbed {
  title?: string;
  html?: string;
}

/** Some streams' oEmbed omits `title` and carries it only on the embed iframe. */
export function oembedTitle(meta: OEmbed): string {
  return (meta.title || decodeEntities(/\btitle="([^"]*)"/.exec(meta.html ?? "")?.[1] ?? "")).trim();
}

/**
 * Stream titles come from YouTube oEmbed, not from page layout (captions sit
 * on different sides of the player on different sites). Titles of IDs already
 * known from the previous run are reused, so a steady state costs one page
 * fetch per resort.
 */
async function youtubeCams(
  ctx: FetchContext,
  resort: PrimaryResortId,
  pageUrl: string,
  titles: Record<string, string>,
): Promise<ResortCam[]> {
  const ids = youtubeIds(await ctx.fetchText(pageUrl, { browserLike: true }));
  assertValid(ids.length > 0, `${resort}: no YouTube camera embeds found`);
  const found: Array<{ title: string; videoId: string }> = [];
  for (const id of ids) {
    let title: string | undefined = titles[id];
    if (title === undefined) {
      const meta = await ctx
        .fetchJson<OEmbed>(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`)
        .catch(() => null);
      if (meta) titles[id] = title = oembedTitle(meta);
    }
    if (title) found.push({ title: title.replace(/\s*-\s*(Brighton Ski Resort|Solitude.*)$/i, ""), videoId: id });
  }
  // A stream with no public title (private or unlisted) can't be labelled, so it is skipped.
  return featuredFirst(found, FEATURED[resort]).map((c) => ({ resort, kind: "youtube", pageUrl, ...c }));
}

async function imageCams(
  ctx: FetchContext,
  resort: PrimaryResortId,
  pageUrl: string,
  parse: (html: string) => Array<{ title: string; imageUrl: string }>,
): Promise<ResortCam[]> {
  const chosen = featuredFirst(parse(await ctx.fetchText(pageUrl, { browserLike: true })), FEATURED[resort]);
  const cams = await Promise.all(
    chosen.map(async (c): Promise<ResortCam | null> => {
      const res = await ctx.probe(c.imageUrl, { browserLike: true }).catch(() => null);
      if (!res || res.status >= 400 || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
      return { resort, kind: "image", pageUrl, title: c.title, imageUrl: c.imageUrl, capturedAt: captureTime(res.headers.get("last-modified"), ctx.now) };
    }),
  );
  return cams.filter((c): c is ResortCam => c !== null);
}

export const resortCamsSource: SourceDefinition<ResortCamsPayload> = {
  id: "resortcams",
  label: "Resort webcams",
  category: "webcams",
  required: false,
  attribution: "Alta, Snowbird, Solitude and Brighton webcams (resort websites)",
  sourceUrl: SNOWBIRD_WEBCAMS_URL,
  // Per-camera capture times are shown on each image instead.
  reportMaxAgeMs: null,
  async collect(ctx) {
    const previous = ((ctx.previous as ResortCamsPayload | null)?.cameras ?? []) as ResortCam[];
    const prev = (r: PrimaryResortId) => previous.filter((c) => c.resort === r);
    // Stream titles resolved on earlier runs are reused.
    const streamTitles: Record<string, string> = { ...(ctx.previous as ResortCamsPayload | null)?.streamTitles };
    const jobs: Array<[PrimaryResortId, Promise<ResortCam[]>]> = [
      ["alta", imageCams(ctx, "alta", ALTA_WEATHER_URL, parseAltaCams)],
      ["snowbird", imageCams(ctx, "snowbird", SNOWBIRD_WEBCAMS_URL, parseSnowbirdCams)],
      ["solitude", youtubeCams(ctx, "solitude", SOLITUDE_WEBCAMS_URL, streamTitles)],
      ["brighton", youtubeCams(ctx, "brighton", BRIGHTON_CONDITIONS_URL, streamTitles)],
    ];
    const settled = await Promise.allSettled(jobs.map(([, p]) => p));
    const cameras: ResortCam[] = [];
    const failures: string[] = [];
    settled.forEach((r, i) => {
      const resort = jobs[i][0];
      if (r.status === "fulfilled" && r.value.length) {
        cameras.push(...r.value);
        return;
      }
      // Keep this resort's cameras from the previous run: image cams carry their
      // own capture time, and a stream player shows its own live/offline state.
      cameras.push(...prev(resort));
      failures.push(`${resort}: ${r.status === "rejected" ? (r.reason instanceof Error ? r.reason.message : String(r.reason)) : "no cameras found"}`);
    });
    assertValid(cameras.length > 0, `No resort cameras found (${failures.join("; ")})`);
    return { payload: { cameras, failures, streamTitles }, sourceUpdatedAt: null };
  },
};
