import { ImageResponse } from "next/og";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/env";
import { SHARE_CARD_FONTS } from "@/lib/og/card-image";
import { DailySnowShareCard } from "@/lib/og/daily-snow-image";
import { readSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const alt = "Daily Snow — the latest Cottonwoods snow forecast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const CACHE_KEY = "https://cottonwoods-snow-report.huang.mx/__cache/daily-snow/opengraph-image/v1";

/** Separate from the resort card so messaging apps and social sites show the daily forecast. */
export default async function Image() {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(CACHE_KEY).catch(() => undefined);
  if (hit) return hit;

  let post = null;
  try {
    post = (await readSnapshot((await getEnv()).SNOW_KV))?.dailySnow?.current ?? null;
  } catch (err) {
    console.error("daily-snow/opengraph-image: failed to read snapshot", err);
  }
  const res = new ImageResponse(<DailySnowShareCard post={post} />, {
    ...size,
    fonts: SHARE_CARD_FONTS,
    headers: { "Cache-Control": `public, max-age=${post ? 600 : 60}` },
  });
  if (cache) {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(cache.put(CACHE_KEY, res.clone()).catch(() => {}));
  }
  return res;
}
