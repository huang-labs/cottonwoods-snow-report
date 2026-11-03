"use client";

import { useEffect, useState } from "react";
import type { ApiDailySnow } from "@/lib/types";

/** Matches the API's `max-age`: after this a cached post still shows at once but is fetched again. */
const FRESH_MS = 5 * 60_000;

type Entry = { post: ApiDailySnow; at: number };

/** Archived posts already loaded this page session, by date. Survives section changes. */
const loaded = new Map<string, Entry>();
/** One request per date at a time, shared by prefetches and picks. */
const inflight = new Map<string, Promise<ApiDailySnow>>();

export function loadArchivedPost(date: string): Promise<ApiDailySnow> {
  const pending = inflight.get(date);
  if (pending) return pending;
  const request = fetch(`/api/daily-snow?date=${date}`)
    .then(async (r) => (r.ok ? ((await r.json()) as ApiDailySnow) : Promise.reject(new Error(r.status === 404 ? "No post for that day" : `HTTP ${r.status}`))))
    .then((post) => {
      loaded.set(date, { post, at: Date.now() });
      return post;
    })
    .finally(() => inflight.delete(date));
  inflight.set(date, request);
  return request;
}

/** Warms the cache (on hover or focus) so a pick usually renders without waiting. Failures are retried on pick. */
export function prefetchArchivedPost(date: string | null) {
  const hit = date ? loaded.get(date) : undefined;
  if (date && (!hit || Date.now() - hit.at > FRESH_MS)) loadArchivedPost(date).catch(() => {});
}

/** Test hook: forget every loaded post. */
export function clearArchivedPosts() {
  loaded.clear();
  inflight.clear();
}

export type ArchivedPost = { post: ApiDailySnow | null; error: string | null; loading: boolean };

/**
 * An archived post by date (null = none wanted). A cached post is returned in the same render
 * as the pick; otherwise `loading` is true until the request settles.
 */
export function useArchivedPost(date: string | null): ArchivedPost {
  const [result, setResult] = useState<{ date: string; post: ApiDailySnow | null; error: string | null } | null>(null);
  // A new pick forgets the last outcome, so picking a failed date again shows loading, not the old error.
  const [requested, setRequested] = useState(date);
  if (requested !== date) {
    setRequested(date);
    setResult(null);
  }
  useEffect(() => {
    if (!date) return;
    const hit = loaded.get(date);
    if (hit && Date.now() - hit.at <= FRESH_MS) return;
    let live = true;
    loadArchivedPost(date).then(
      (post) => live && setResult({ date, post, error: null }),
      (e: Error) => live && setResult({ date, post: null, error: e.message }),
    );
    return () => {
      live = false;
    };
  }, [date]);
  if (!date) return { post: null, error: null, loading: false };
  const settled = result?.date === date ? result : null;
  const post = settled?.post ?? loaded.get(date)?.post ?? null;
  return { post, error: post ? null : settled?.error ?? null, loading: !post && !settled };
}
