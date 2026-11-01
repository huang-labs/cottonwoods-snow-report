import { ImageResponse } from "next/og";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/env";
import { SHARE_CARD_FONTS, ShareCard } from "@/lib/og/card-image";
import { shareCardData } from "@/lib/og/shareCard";
import { buildReport } from "@/lib/report";
import { readSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";
export const alt = "Live snowfall at Alta, Snowbird, Solitude and Brighton";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Rendering costs a few hundred ms of CPU, so each Cloudflare location keeps
 * the PNG for this long. Matches the collector's cadence closely enough that
 * a shared link shows current numbers.
 */
const CACHE_S = 600;
const CACHE_KEY = "https://cottonwoods-snow-report.huang.mx/__cache/opengraph-image/v2";

/** Link-preview image (iMessage, WhatsApp, Slack…) with live numbers from the KV snapshot. */
export default async function Image() {
  const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
  const hit = await cache?.match(CACHE_KEY).catch(() => undefined);
  if (hit) return hit;

  let snapshot = null;
  try {
    snapshot = await readSnapshot((await getEnv()).SNOW_KV);
  } catch (err) {
    console.error("opengraph-image: failed to read snapshot", err);
  }
  const ttl = snapshot ? CACHE_S : 60;
  const res = new ImageResponse(<ShareCard data={shareCardData(buildReport(snapshot))} />, {
    ...size,
    fonts: SHARE_CARD_FONTS,
    headers: { "Cache-Control": `public, max-age=${ttl}` },
  });
  if (cache) {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(cache.put(CACHE_KEY, res.clone()).catch(() => {}));
  }
  return res;
}
