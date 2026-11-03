import { addLiveEnsemble } from "./live-ensemble";
/**
 * Builds the recommendation prompt from the live production report and prints
 * the Workers AI request body, for prompt tuning with the `cf` CLI:
 *   npm run recommend:once -- > /tmp/body.json
 *   cf ai run @cf/zai-org/glm-5.3-flash --body @/tmp/body.json
 * Options:
 *   --url <report url>     default: production /api/report
 *   --now <ISO time>       evaluate as of this time
 *   --assume-in-season     treat every resort as in season (test outside the season)
 *   --scenario <name>      synthetic powder-wait or bcc-now inputs for smoke testing
 *   --model <id>           request body for this model (default: primary)
 *   --live-ensemble         fetch numerical CLN guidance directly (read-only)
 *   --digest               print the digest instead of the request body
 */
import { buildDigest } from "../src/lib/recommend/digest";
import { PRIMARY_MODEL } from "../src/lib/ai/model";
import { buildModelInput } from "../src/lib/recommend/llm";
import type { ReportResponse, Snapshot } from "../src/lib/types";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const url = arg("--url") ?? "https://cottonwoods-snow-report.huang.mx/api/report";
const now = arg("--now") ? new Date(arg("--now")!) : new Date();
const report = (await (await fetch(url)).json()) as ReportResponse;
const snapshot: Snapshot = { schemaVersion: 1, writtenAt: report.snapshotWrittenAt ?? now.toISOString(), sources: report.sources };
await addLiveEnsemble(snapshot, now);
const digest = buildDigest(snapshot, {}, now);
if (process.argv.includes("--assume-in-season")) {
  for (const r of digest.resorts) r.inSeason = true;
  digest.eligible = digest.resorts.map((r) => r.id);
}
const scenario = arg("--scenario");
if (scenario) {
  if (!["powder-wait", "bcc-now"].includes(scenario)) throw new Error("Unknown scenario");
  // Explicit synthetic facts: production data alone is preseason and cannot exercise a ski-day choice.
  digest.eligible = digest.resorts.map((r) => r.id);
  digest.mode = "storm";
  digest.modeReason = "Synthetic storm scenario for model evaluation";
  for (const r of digest.resorts) {
    r.inSeason = true;
    r.operatingNow = true;
    r.operatingStatus = "Open for winter skiing";
    r.lifts = "5/6 open";
    r.terrain = ["Main powder terrain open; no terrain opening promises"];
    r.parking = ["Parking available"];
    r.notices = [];
    r.conditions = "Fresh powder";
    r.snowfall = { "24h": `${r.canyon === "LCC" ? 18 : 10}″`, overnight: `${r.canyon === "LCC" ? 18 : 10}″` };
  }
  digest.canyons = [
    { canyon: "LCC", state: scenario === "powder-wait" ? "closed-expected-open" : "closed", expectedOpen: scenario === "powder-wait" ? "9:30 AM today (estimate)" : null, closureAnnounced: null, restrictions: [], evidence: ["SR-210 closed for avalanche mitigation", scenario === "powder-wait" ? "Estimated opening 9:30 AM" : "No estimated opening time"] },
    { canyon: "BCC", state: "open", expectedOpen: null, closureAnnounced: null, restrictions: [], evidence: ["SR-190 open"] },
  ];
}
console.log(
  JSON.stringify(process.argv.includes("--digest") ? digest : buildModelInput(arg("--model") ?? PRIMARY_MODEL, digest, null), null, 2),
);
