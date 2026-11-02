import { handleFetch } from "./src/worker/fetch";
import type { WorkerEnv } from "./src/worker/env";
import { runCollection } from "./src/lib/collect";

export default {
  fetch: handleFetch,

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runCollection(env, { now: new Date(controller.scheduledTime) }).then((summary) => {
        const failed = summary.results.filter((r) => !r.ok);
        console.log(
          JSON.stringify({
            event: "collection",
            cron: controller.cron,
            durationMs: summary.durationMs,
            ok: summary.results.length - failed.length,
            skipped: summary.skipped,
            recommendation: summary.recommendation,
            dailySnow: summary.dailySnow,
            failed: failed.map((f) => ({ id: f.id, error: f.error })),
          }),
        );
      }),
    );
  },
} satisfies ExportedHandler<WorkerEnv>;
