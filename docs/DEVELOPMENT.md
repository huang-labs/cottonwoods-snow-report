# Local development

[← README](../README.md)

Local collection, commands, model evaluation and troubleshooting.

Requires Node 20+ (tested with Node 24.12).

```sh
npm install
cp .dev.vars.example .dev.vars        # local-only vars; never commit
npm run dev                           # build static frontend, then workerd at http://localhost:8787
# Seed local KV from the real sources (local cron does not run automatically):
curl -X POST -H "Authorization: Bearer change-me-local-only" http://localhost:8787/api/admin/collect
```

`dev`, `start`, and `preview` use `wrangler dev --local`: KV is persisted in `.wrangler/state` and remote bindings (including paid AI) are disabled. Worker edits reload automatically. Frontend edits require `npm run build` in another terminal or restarting `npm run dev`; this workflow uses the exported frontend rather than Next.js HMR. `npm start` serves an existing export. To use paid remote AI locally, build, authenticate with Wrangler, and run `npx wrangler dev` without `--local`; KV stays local unless configured remote. Builds and type generation need no credentials.

| Command | What it does |
| --- | --- |
| `npm test` | Vitest: parsers, timestamp semantics, partial failures, API output, AI scheduling and validation, app shell/navigation UI (jsdom) |
| `npm run typecheck` | `next typegen` (route types), then `tsc --noEmit` |
| `npm run collect:once` | Runs one real collection in Node with in-memory KV and prints per-source status (`-- --json` prints the full API shape) |
| `npm run recommend:once` | Prints the resort-pick model request built from production data (`-- --digest` prints the facts instead) |
| `npm run dailysnow:once` | Prints the Daily Snow model request built from production data and its post archive (`-- --digest` prints the facts; `-- --save-digest <file>` also saves them for replay; `-- --validate <response.json>` checks a saved model response) |
| `npm run dailysnow:replay -- <digests…>` | Runs saved digests through the current prompt and validator on the real model and prints one line each (valid, words, sections, figures, tokens, time). Needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; `--model <id>`, `--out <dir>` |
| `npm run build` | Next.js static export into `out/` |
| `npm run cf:build` | Static export plus Wrangler dry-run of the Worker bundle |
| `npm run smoke` | Credential-free workerd checks of all pages, navigation payloads, API routing, KV, and both share PNGs (run after build) |
| `npm run preview` | Static build, then serve assets and APIs locally in workerd |
| `npm run preview:scheduled` | Same as `preview`, with `wrangler dev --local --test-scheduled`. Trigger the cron with `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` |

To try a prompt against the real model: `npm run -s recommend:once > /tmp/body.json`, then `cf ai run @cf/zai-org/glm-5.3-flash --body @/tmp/body.json` (requires `cf auth login`). Daily Snow generations take longer than `cf ai run`'s 30 s client timeout. Save digests with `npm run -s dailysnow:once -- --now <6 AM time> --save-digest digests/<date>.json > /dev/null`, then replay them all with `npm run dailysnow:replay -- digests/`, which calls the Workers AI REST endpoint with the production 5-minute timeout. Keep saved digests out of the repository: they contain third-party report text.

Both prompt scripts accept `--live-ensemble` to collect the new numerical source directly for read-only pre-deployment tuning (no KV writes). Example: `npm run -s dailysnow:once -- --live-ensemble > /tmp/body.json`. Use the same flag and `--now` time when validating that response. `recommend:once -- --assume-in-season` explicitly overrides preseason eligibility for model evaluation; it is not a report of actual operations.

URL options: old `?slide=<id>` links redirect to that section's page.

> **Local dev caveat (macOS 27 / wrangler 4.156):** the local `workerd` runtime sometimes opens tens of thousands of loopback connections to itself. Once the ephemeral ports run out, any local request can briefly fail with `EADDRNOTAVAIL`. This was observed with the former OpenNext development setup and a minimal KV-only `getPlatformProxy()` config; development now uses Wrangler directly. It clears on its own; restart `npm run dev` if it persists.
