import { ImageResponse, cache as imageCache } from "@cf-wasm/og";
import type { CollectorEnv } from "../lib/collect";
import { SHARE_CARD_FONTS, ShareCard } from "../lib/og/card-image";
import { shareCardData } from "../lib/og/shareCard";
import { buildReport } from "../lib/report";
import { readSnapshot } from "../lib/store";

export const alt = "Live snowfall at Alta, Snowbird, Solitude and Brighton";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Rendering costs a few hundred ms of CPU, so each Cloudflare location keeps
 * the PNG for this long. Matches the collector's cadence closely enough that
 * a shared link shows current numbers.
 */
const CACHE_S = 600;
// Scope cached images to the requested host, including PR previews.
const CACHE_PATH = "/__cache/opengraph-image/v4";

/** Link-preview image (iMessage, WhatsApp, Slack…) with live numbers from the KV snapshot. */
export async function shareImage(request: Request, env: CollectorEnv, ctx: ExecutionContext) {
  imageCache.setExecutionContext(ctx);
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const cacheKey = new URL(CACHE_PATH, request.url).href;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  let snapshot = null;
  try {
    snapshot = await readSnapshot(env.SNOW_KV);
  } catch (err) {
    console.error("opengraph-image: failed to read snapshot", err);
  }
  const ttl = snapshot ? CACHE_S : 60;
  const res = await ImageResponse.async(<ShareCard data={shareCardData(buildReport(snapshot))} />, {
    ...size,
    fonts: SHARE_CARD_FONTS,
    headers: { "Cache-Control": `public, max-age=${ttl}` },
  });
  if (cache) {
    ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  }
  return res;
}
