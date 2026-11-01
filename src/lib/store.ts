import type { Snapshot } from "./types";

/** Minimal KV surface used here (Cloudflare KVNamespace satisfies it). */
export interface KVLike {
  get(key: string, type: "text"): Promise<string | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * All per-source records live in one KV value. One write per five-minute run
 * (288/day) stays well inside KV's write limits, including the free tier's
 * 1,000 writes/day, and lets the API serve a consistent snapshot in one read.
 */
export const SNAPSHOT_KEY = "snapshot:v1";

export async function readSnapshot(kv: KVLike): Promise<Snapshot | null> {
  const raw = await kv.get(SNAPSHOT_KEY, "text");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed.schemaVersion === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeSnapshot(kv: KVLike, snapshot: Snapshot): Promise<void> {
  await kv.put(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

/**
 * Cropped plume panels (PNG). Keyed by station, model run and panel, so a
 * snapshot always references images of its own run; they expire on their own
 * once newer runs have replaced them.
 */
export const plumePanelKey = (station: string, runCode: string, panel: string) =>
  `plume-panel:v1:${station}:${runCode}:${panel}`;
export const PLUME_PANEL_TTL_S = 4 * 24 * 3600;

/** In-memory KV for tests and the one-off local collection script. */
export class MemoryKV implements KVLike {
  readonly data = new Map<string, string | ArrayBuffer>();
  get(key: string, type: "text"): Promise<string | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  async get(key: string, type: "text" | "arrayBuffer"): Promise<string | ArrayBuffer | null> {
    const v = this.data.get(key);
    if (v === undefined) return null;
    if (type === "text") return typeof v === "string" ? v : new TextDecoder().decode(v);
    return typeof v === "string" ? (new TextEncoder().encode(v).buffer as ArrayBuffer) : v;
  }
  async put(key: string, value: string | ArrayBuffer) {
    this.data.set(key, value);
  }
}
