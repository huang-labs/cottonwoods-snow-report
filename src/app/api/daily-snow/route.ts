import { dailySnowKey } from "@/lib/dailysnow";
import { getEnv } from "@/lib/env";
import { publicDailySnow } from "@/lib/report";
import { readSnapshot } from "@/lib/store";
import type { DailySnowPost } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One archived Daily Snow post: `?date=YYYY-MM-DD`. The current post comes with /api/report. */
export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: "Expected ?date=YYYY-MM-DD" }, { status: 400 });
  try {
    const env = await getEnv();
    const [raw, snapshot] = await Promise.all([env.SNOW_KV.get(dailySnowKey(date), "text"), readSnapshot(env.SNOW_KV)]);
    const post = raw ? (JSON.parse(raw) as DailySnowPost) : null;
    if (!post) return Response.json({ error: "No Daily Snow for that date" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json(publicDailySnow(post, snapshot?.dailySnow, new Date()), {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (err) {
    console.error("daily-snow: failed to read archive", err);
    return Response.json({ error: "Storage unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
