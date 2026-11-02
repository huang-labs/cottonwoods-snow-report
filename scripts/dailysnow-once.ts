import { addLiveEnsemble } from "./live-ensemble";
/**
 * Builds the Daily Snow prompt from the live production report and prints the
 * Workers AI request body, for prompt tuning with the `cf` CLI:
 *   npm run dailysnow:once -- > /tmp/body.json
 *   cf ai run @cf/zai-org/glm-5.3-flash --body @/tmp/body.json
 * Options:
 *   --url <report url>     default: production /api/report
 *   --now <ISO time>       evaluate as of this time
 *   --model <id>           request body for this model (default: primary)
 *   --live-ensemble         fetch numerical CLN guidance directly (read-only)
 *   --digest               print the digest instead of the request body
 *   --validate <file>      validate a saved model response against the digest
 */
import { readFileSync } from "node:fs";
import { buildDailyDigest } from "../src/lib/dailysnow/digest";
import { buildModelInput, validateDailySnow } from "../src/lib/dailysnow/llm";
import { createFetchContext } from "../src/lib/http";
import { PRIMARY_MODEL, responseJson } from "../src/lib/recommend/llm";
import { nwsAfdSource } from "../src/lib/sources/nwsafd";
import type { ReportResponse, Snapshot, SourceRecord } from "../src/lib/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg("--url") ?? "https://cottonwoods-snow-report.huang.mx/api/report";
const now = arg("--now") ? new Date(arg("--now")!) : new Date();
const report = (await (await fetch(url)).json()) as ReportResponse;
const snapshot: Snapshot = { schemaVersion: 1, writtenAt: report.snapshotWrittenAt ?? now.toISOString(), sources: report.sources };
await addLiveEnsemble(snapshot, now);
// Until the forecast discussion source is deployed, fetch it directly.
if (!snapshot.sources.nwsafd?.payload) {
  const { payload, sourceUpdatedAt } = await nwsAfdSource.collect(createFetchContext({ COLLECTOR_CONTACT: "dailysnow-once" }, now));
  snapshot.sources.nwsafd = { id: "nwsafd", payload, sourceUpdatedAt, status: "ok", lastAttemptAt: now.toISOString(), lastSuccessfulFetchAt: now.toISOString(), lastError: null, lastErrorAt: null, consecutiveFailures: 0, diagnostics: null } satisfies SourceRecord;
}
const { digest } = buildDailyDigest(snapshot, report.dailySnow ?? null, [], now);
const saved = arg("--validate");
if (saved) {
  console.log(JSON.stringify(validateDailySnow(responseJson(JSON.parse(readFileSync(saved, "utf8"))), digest), null, 2));
} else {
  console.log(JSON.stringify(process.argv.includes("--digest") ? digest : buildModelInput(arg("--model") ?? PRIMARY_MODEL, digest), null, 2));
}
