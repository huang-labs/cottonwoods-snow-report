import { getEnv } from "@/lib/env";
import { buildReport } from "@/lib/report";
import { readSnapshot } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Serves the latest stored snapshot. Never triggers upstream collection;
 * that only happens in the scheduled handler (worker.ts).
 */
export async function GET() {
  try {
    const env = await getEnv();
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
