import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache: every page/API response here is dynamic and the report
// snapshot lives in KV, written by the scheduled handler in worker.ts.
export default defineCloudflareConfig({});
