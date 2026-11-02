import { ImageResponse, cache as imageCache } from "@cf-wasm/og";
import type { CollectorEnv } from "../lib/collect";
import { SHARE_CARD_FONTS } from "../lib/og/card-image";
import { DailySnowShareCard } from "../lib/og/daily-snow-image";
import { readSnapshot } from "../lib/store";

export const alt = "Daily Snow — the latest Cottonwoods snow forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CACHE_PATH = "/__cache/daily-snow/opengraph-image/v2";

/** Separate from the resort card so messaging apps and social sites show the daily forecast. */
export async function dailySnowShareImage(request: Request, env: CollectorEnv, ctx: ExecutionContext) {
  imageCache.setExecutionContext(ctx);
  const cacheKey = new URL(CACHE_PATH, request.url).href;
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(cacheKey).catch(() => undefined);
  if (hit) return hit;

  let post = null;
  try {
    post = (await readSnapshot(env.SNOW_KV))?.dailySnow?.current ?? null;
  } catch (err) {
    console.error("daily-snow/opengraph-image: failed to read snapshot", err);
  }
  const res = await ImageResponse.async(<DailySnowShareCard post={post} />, {
    ...size,
    fonts: SHARE_CARD_FONTS,
    headers: { "Cache-Control": `public, max-age=${post ? 600 : 60}` },
  });
  if (cache) {
    ctx.waitUntil(cache.put(cacheKey, res.clone()).catch(() => {}));
  }
  return res;
}
