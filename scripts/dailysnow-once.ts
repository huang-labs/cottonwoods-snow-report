import { addLiveEnsemble } from "./live-ensemble";
/**
 * Builds the Daily Snow prompt from the live production report and its post
 * archive, and prints the Workers AI request body, for prompt tuning:
 *   npm run -s dailysnow:once > /tmp/body.json
 * then POST it to the Workers AI REST endpoint (or replay saved digests with
 * `npm run dailysnow:replay`). Read-only: nothing is written anywhere.
 * Options:
 *   --url <report url>     default: production /api/report
 *   --now <ISO time>       evaluate as of this time
 *   --model <id>           request body for this model (default: primary)
 *   --live-ensemble        fetch numerical CLN guidance directly (read-only)
 *   --digest               print the digest instead of the request body
 *   --save-digest <file>   also save the digest, for `dailysnow:replay`
 *   --validate <file>      validate a saved model response against the digest
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PRIMARY_MODEL, responseJson } from "../src/lib/ai/model";
import { historyEntry } from "../src/lib/dailysnow/continuity";
import { buildDailyDigest } from "../src/lib/dailysnow/digest";
import { buildModelInput, validateDailySnow } from "../src/lib/dailysnow/llm";
import { createFetchContext } from "../src/lib/http";
import { nwsAfdSource } from "../src/lib/sources/nwsafd";
import type { ApiDailySnow, ReportResponse, Snapshot, SourceRecord } from "../src/lib/types";

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

// The cron keeps compact history entries; rebuild them from the archived posts the API serves.
const current = report.dailySnow ?? null;
const posts = await Promise.all(
  (current?.archive ?? []).map(async ({ date }) => {
    if (date === current?.date) return current;
    const res = await fetch(new URL(`/api/daily-snow?date=${date}`, url));
    return res.ok ? ((await res.json()) as ApiDailySnow) : null;
  }),
);
const history = posts.filter((p): p is ApiDailySnow => !!p).map(historyEntry);

const { digest } = buildDailyDigest(snapshot, current, history, now);
const saveTo = arg("--save-digest");
if (saveTo) writeFileSync(saveTo, JSON.stringify(digest, null, 2));
const saved = arg("--validate");
if (saved) {
  console.log(JSON.stringify(validateDailySnow(responseJson(JSON.parse(readFileSync(saved, "utf8"))), digest), null, 2));
} else {
  console.log(JSON.stringify(process.argv.includes("--digest") ? digest : buildModelInput(arg("--model") ?? PRIMARY_MODEL, digest), null, 2));
}
