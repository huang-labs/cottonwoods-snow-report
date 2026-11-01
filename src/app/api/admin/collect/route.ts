import { runCollection } from "@/lib/collect";
import { getEnv } from "@/lib/env";
import type { SourceId } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Manual collection trigger for local development and post-deploy seeding.
 * Disabled (404) unless ADMIN_TOKEN is configured; requires a bearer token.
 */
export async function POST(request: Request) {
  const env = await getEnv();
  if (!env.ADMIN_TOKEN) return new Response("Not found", { status: 404 });
  if (request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const only = new URL(request.url).searchParams.getAll("source") as SourceId[];
  const summary = await runCollection(env, { only: only.length ? only : undefined });
  return Response.json(summary, { headers: { "Cache-Control": "no-store" } });
}
