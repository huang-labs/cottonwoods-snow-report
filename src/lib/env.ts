import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { CollectorEnv } from "./collect";

/** Bindings available to route handlers (KV + optional secrets). */
export async function getEnv(): Promise<CollectorEnv & { ADMIN_TOKEN?: string }> {
  const { env } = await getCloudflareContext({ async: true });
  const e = env as unknown as Record<string, unknown>;
  if (!e.SNOW_KV) throw new Error("SNOW_KV binding is not configured");
  return {
    AI: e.AI as CollectorEnv["AI"],
    AI_GATEWAY_ID: e.AI_GATEWAY_ID as string | undefined,
    SNOW_KV: e.SNOW_KV as CollectorEnv["SNOW_KV"],
    UDOT_API_KEY: (e.UDOT_API_KEY as string | undefined) || undefined,
    COLLECTOR_CONTACT: (e.COLLECTOR_CONTACT as string | undefined) || undefined,
    ADMIN_TOKEN: (e.ADMIN_TOKEN as string | undefined) || undefined,
  };
}
