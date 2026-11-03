import { DAILY_SNOW_RETENTION_DAYS } from "../report";
import type { KVLike } from "../store";
import type { DailySnowPost, Snapshot } from "../types";
import { advanceStormTracking, mergeStormRecord, seedStormTracking, stormKey } from "./storms";

/** A bounded, read-only bootstrap. Failures retry next collection; never initialize over missing archives. */
export async function trackStorms(kv: KVLike, previous: Snapshot | null, snapshot: Snapshot, now: Date): Promise<void> {
  let state = previous?.stormTracking;
  if (!state && previous?.dailySnow?.current) {
    const posts: DailySnowPost[] = [];
    let post: DailySnowPost | null = previous.dailySnow.current;
    // Older editions may predate neighbor links; use the existing archive index too.
    const pending = (previous.dailySnow.history ?? []).map((h) => h.date)
      .filter((date) => now.getTime() - Date.parse(`${date}T12:00:00Z`) < 96 * 3_600_000);
    const seen = new Set<string>();
    while (post && posts.length < 5 && now.getTime() - Date.parse(post.generatedAt) < 72 * 3_600_000) {
      posts.push(post);
      seen.add(post.date);
      if (post.older) pending.unshift(post.older.date);
      const next = pending.find((date) => !seen.has(date));
      if (!next || posts.length >= 5) break;
      const raw = await kv.get(`dailysnow:v1:${next}`, "text");
      if (!raw) throw new Error(`Storm bootstrap missing archive ${next}`);
      post = JSON.parse(raw) as DailySnowPost;
    }
    state = seedStormTracking(posts, now);
  }
  snapshot.stormTracking = advanceStormTracking(state, snapshot, now);
}

/** Archive only material event changes. Re-read/merge narrows KV's existing concurrent-write window.
    Each record expires DAILY_SNOW_RETENTION_DAYS after its last change. */
export async function archiveStorms(kv: KVLike, snapshot: Snapshot): Promise<void> {
  for (const event of snapshot.stormTracking?.events ?? []) {
    const key = stormKey(event.id);
    const raw = await kv.get(key, "text");
    const merged = raw ? mergeStormRecord(JSON.parse(raw), event) : event;
    const body = JSON.stringify(merged);
    if (raw !== body) await kv.put(key, body, { expirationTtl: DAILY_SNOW_RETENTION_DAYS * 24 * 3600 });
  }
}
