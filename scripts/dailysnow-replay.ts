/**
 * Replays saved Daily Snow digests against the real models, for prompt tuning
 * across several days of data instead of one live run. Each digest goes
 * through the current prompt and validator; nothing is stored.
 *
 *   npm run -s dailysnow:once -- --now 2026-11-03T13:00:00Z --save-digest digests/2026-11-03.json > /dev/null
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run dailysnow:replay -- digests/ [--model <id>] [--out <dir>]
 *
 * Takes digest files or directories of them. Calls the Workers AI REST
 * endpoint directly (no AI Gateway), with the production 5-minute timeout.
 * Prints one line per digest: validity, words, sections, figures, tokens and
 * time; --out saves each raw response and the validated post.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PRIMARY_MODEL, responseJson } from "../src/lib/ai/model";
import type { DailyDigest } from "../src/lib/dailysnow/digest";
import { buildModelInput, DAILY_SNOW_TIMEOUT_MS, validateDailySnow } from "../src/lib/dailysnow/llm";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const model = option("--model") ?? PRIMARY_MODEL;
const outDir = option("--out");
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token || !args.length) {
  console.error("Usage: CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npm run dailysnow:replay -- <digest.json | dir>… [--model <id>] [--out <dir>]");
  process.exit(2);
}
const files = args.flatMap((p) => (statSync(p).isDirectory() ? readdirSync(p).filter((f) => f.endsWith(".json")).sort().map((f) => join(p, f)) : [p]));
if (outDir) mkdirSync(outDir, { recursive: true });

let failures = 0;
for (const file of files) {
  const digest = JSON.parse(readFileSync(file, "utf8")) as DailyDigest;
  const started = Date.now();
  const line = [`${basename(file)} ${model}`];
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildModelInput(model, digest)),
      signal: AbortSignal.timeout(DAILY_SNOW_TIMEOUT_MS),
    });
    const body = (await res.json()) as { success?: boolean; result?: unknown; errors?: unknown };
    if (!res.ok || !body.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
    const usage = (body.result as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
    if (outDir) writeFileSync(join(outDir, `${basename(file, ".json")}.response.json`), JSON.stringify(body.result, null, 2));
    const post = validateDailySnow(responseJson(body.result), digest);
    if (outDir) writeFileSync(join(outDir, `${basename(file, ".json")}.post.json`), JSON.stringify(post, null, 2));
    const paragraphs = post.sections.flatMap((s) => s.paragraphs);
    const words = paragraphs.map((p) => p.text).join(" ").split(/\s+/).filter(Boolean).length;
    line.push(
      `ok "${post.title}"`,
      `${words} words`,
      `sections ${post.sections.map((s) => s.id).join("+")}`,
      `figures ${paragraphs.flatMap((p) => (p.figure ? [p.figure] : [])).join(",") || "none"}`,
      `tokens ${usage?.prompt_tokens ?? "?"} in / ${usage?.completion_tokens ?? "?"} out`,
    );
  } catch (e) {
    failures++;
    line.push(`FAILED ${e instanceof Error ? e.message : String(e)}`);
  }
  line.push(`${Math.round((Date.now() - started) / 1000)} s`);
  console.log(line.join(" · "));
}
process.exit(failures ? 1 : 0);
