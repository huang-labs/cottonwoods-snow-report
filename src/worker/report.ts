import type { CollectorEnv } from "../lib/collect";
import { buildReport } from "../lib/report";
import { readSnapshot } from "../lib/store";

/**
 * Serves the latest stored snapshot. Never triggers upstream collection;
 * that only happens in the scheduled handler (worker.ts).
 */
export async function report(env: CollectorEnv) {
  try {
    const snapshot = await readSnapshot(env.SNOW_KV);
    return Response.json(buildReport(snapshot), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("report: failed to read snapshot", err);
    return Response.json(
      { error: "Report storage unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
