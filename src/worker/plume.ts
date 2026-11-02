import type { CollectorEnv } from "../lib/collect";
import { PLUME_STATIONS } from "../lib/sources/plumes";
import { plumePanelKey } from "../lib/store";

const PANELS = new Set(["snow", "slr"]);
const STATIONS = new Set<string>(PLUME_STATIONS.map((s) => s.code));

/**
 * Serves a cropped plume panel stored by the collector. URLs embed the model
 * run, so a given URL never changes content and can be cached for a long time.
 */
export async function plumePanel(env: CollectorEnv, station: string, run: string, panel: string) {
  if (!STATIONS.has(station) || !/^\d{10}$/.test(run) || !PANELS.has(panel)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const png = await env.SNOW_KV.get(plumePanelKey(station, run, panel), "arrayBuffer");
    if (!png) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
    });
  } catch (err) {
    console.error("plume panel: storage read failed", err);
    return new Response("Storage unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
