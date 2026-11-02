# Cottonwoods Snow Report

A snow and conditions dashboard for phones and desktop browsers. It covers the four Cottonwoods resorts (Alta, Snowbird, Solitude and Brighton) with resort webcams, NWS mountain weather, University of Utah ensemble plumes (accumulated snow and snow-to-liquid ratio on a Mountain Time axis), and canyon road status with UDOT webcams. Two AI features sit on top of the collected data: a resort pick for the day and a morning **Daily Snow** forecast post.

Product requirements: [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md). Source findings, design decisions and known limitations: [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md).

## Architecture

Next.js 16 builds a **static export** (`output: "export"`) into `out/`. One Cloudflare deployment contains those files as **Workers Static Assets** plus a **plain Worker** for APIs and background jobs. No Next.js server or OpenNext adapter runs in production.

```text
Browser → Cloudflare Static Assets → prerendered HTML / JS / CSS
Browser → /api/* → Worker → SNOW_KV
Cron (5 min) → Worker → upstream sources / Workers AI → SNOW_KV
Link crawler → /opengraph-image or /daily-snow/opengraph-image → Worker → PNG
```

- **Worker entry:** `worker.ts` exports the direct router (`src/worker/fetch.ts`) and `scheduled()` handler. Asset-first routing serves matching static files without invoking Worker code. `/api/*` and both share-image URLs use Worker-first routing. Unknown pages serve the exported 404; unknown APIs return 404 rather than an app shell.
- **Collection:** the cron `*/5 * * * *` runs `runCollection()` (`src/lib/collect.ts`). It fetches every *due* source concurrently, isolating each source's failure, and writes one snapshot to KV (`SNOW_KV`, key `snapshot:v1`). A failed source keeps its last successful payload. Writes merge against whatever a concurrent run (manual collect, or a cron overlapped by slow AI calls) stored since this run read the snapshot: the newer attempt wins per source, so overlapping runs never revert each other's records.
- **Per-source cadence** (`intervalMs` on each source): resorts, roads, UDOT webcams and resort webcams every 5 min; NWS and travel times every 15 min; plumes, numerical ensemble guidance and the NWS forecast discussion every 30 min. A failed attempt is retried on the next run; manual `only` runs ignore intervals. The cron log line lists the `skipped` sources.
- **API:** `GET /api/report` (`src/worker/report.ts`) reads the snapshot and adds the freshness classification. It never contacts upstream sources or the AI models.
- **Plume panels:** when a new model run appears, the collector downloads each station's chart once, crops the Accumulated Snow and Snow-to-Liquid Ratio panels (`src/lib/plumeCrop.ts`, located from the chart's axes frames), and stores the PNGs in KV (`plume-panel:v1:<station>:<run>:<panel>`, 4-day TTL). `GET /api/plume/<station>/<run>/<panel>` serves them with long-lived caching. If cropping fails, the page shows the full original chart.
  - `/plumes` and Daily Snow share `PlumePanelSvg` for white padding and a Mountain Time axis. Daily Snow stores optional `axis` metadata alongside each frozen plume still (plot bounds, model initialization and forecast length), so archived figures retain their original run and mark the posting time rather than the current time. Older posts without this metadata show a padded image without axis labels. The figure API continues to serve the raw cropped PNG; the page draws the axis.
  - New Daily Snow posts include an accumulated-snow plume whenever a candidate image can be copied. If the model omits one, code adds it after the prose with its source caption (CLN preferred, then another station), reserving one of the six figure slots. Missing plume images do not prevent publication. An accidental second opening section from the model is folded into the first, preserving its outlook and figures.
- **Numerical ensemble:** optional `ensemble` source fetches the [published Utah Snow Ensemble CLN tables](https://weather.utah.edu/text/ensgefsdslccforecast.html) independently of chart collection. Both AI features receive P10/P50/P90 snow, liquid and SLR for wholly future six-hour periods, through the ten-day horizon. Scope is the 9,416 ft nearest grid point to Alta-Collins (LCC), not BCC-specific or observed snow. Marginal percentiles cannot be summed into storm totals or subtracted from cumulative curves. Runs older than 18 h, collections older than 47 min and failed latest attempts provide no usable model amounts; the last good payload stays in KV. Exact published −0.01″ six-hour liquid traces are normalized to zero and counted; other negatives fail validation. New runs and availability changes use the existing recommendation schedule and caps. Images remain text-only figure references; no vision inference is used.
- **Frontend:** each section is its own page: `/` (regional snowfall), `/daily-snow`, `/weather`, `/plumes`, `/traffic`, `/alta`, `/snowbird`, `/solitude`, `/brighton`. The section list is `src/lib/sections.ts`; routes are `src/app/page.tsx` and `src/app/[section]/page.tsx`, prerendered static. `src/components/AppShell.tsx` sits in the root layout and polls `/api/report` on load and every 60 s, once for the whole app. The shell is an editorial masthead (brand, appearance control, section nav with a Resorts dropdown) over the routed page.
- **Appearance:** light by default, with a full dark theme. The sun/moon buttons in the masthead override the system appearance; clicking the active button returns to the system default. The choice is stored in `localStorage` under `cottonwoods-snow-report.appearance` and applied to `<html data-theme>` by an inline script before first paint, so the theme never flashes.
- **Share images:** `/opengraph-image` and `/daily-snow/opengraph-image` render the existing cards with `@cf-wasm/og`, bundled fonts, and precompiled WebAssembly. Static HTML has explicit deployment-specific Open Graph and Twitter URLs. PNGs are cached for 10 min (1 min before collection). Pinned Satori/fflate overrides apply security fixes; the HarfBuzz adapter avoids runtime WASM compilation.
- **Manual collection:** `POST /api/admin/collect` is disabled (404) unless the `ADMIN_TOKEN` secret is set, and then requires `Authorization: Bearer <token>`. Options: `?source=<id>` (repeatable) collects only those sources; `?recommend=force` asks for a new resort pick; `?dailysnow=force` writes a new Daily Snow post.

Source adapters live in `src/lib/sources/*`. Each has a pure parser, tested against captured responses in `test/fixtures/`, and a `collect()` that fetches.

## AI features

Both run inside the collection cron, after the fresh sources are stored, through the Workers AI binding `AI` and the AI Gateway named by `AI_GATEWAY_ID`. The primary model is `@cf/zai-org/glm-5.3-flash`, with `@cf/openai/gpt-oss-120b` as a one-time fallback. Output is schema-constrained JSON, validated in code before it is stored; source text is passed as data, never as instructions. Without the `AI` binding, both features are skipped. Both are labeled **AI** wherever they appear.

- **Resort pick** (`src/lib/recommend/`): today's (tomorrow's after 2 PM) pick on the Snowfall page, integrated into the resort table — the picked resort's row gets an AI badge, with its plan, summary, caveats and model metadata in a reasoning row directly beneath. It refreshes on material changes, within a daily request cap. Nothing is shown until there is a resort pick, including when the result explicitly selects no resort.
- **Daily Snow** (`src/lib/dailysnow/`): a short forecast post in the style of a local forecaster's daily write-up, written at **6 AM America/Denver** (checked on every cron run, so it follows daylight-saving time). It has a title, summary, an Update (shown as "Today") or Short Term Forecast (shown as "Next Few Days") section, an optional Extended Forecast, and inline figures: NWS 6-hour snowfall and snow-level charts, resort-reported totals, plume panels and this morning's snow-stake stills. Code decides the storm phase (pre-storm, storm, post-storm, quiet), computes the forecast totals, and writes every figure caption; the model only picks where figures go. Inch amounts in the text must match a value in the input data, or the post is rejected and the fallback is tried. Each model gets up to 5 minutes. When the fallback writes the post, the primary model's error is stored on the post as `fallbackReason` and logged in the cron's `dailySnow` outcome. Failures retry every 10 minutes, at most 3 times, until 10 AM. Inputs include current structured CLN ensemble spread, the NWS Salt Lake City Area Forecast Discussion and the last five posts, for continuity and forecast checking.
  - Shown at `/daily-snow` (the full post as the page content, with previous/next links via `?date=`) and as a highlighted teaser panel above the resort table on the Snowfall page.
  - Storage: the current post is in the snapshot; each post is archived at `dailysnow:v1:<date>` with its image stills at `dailysnow-fig:v1:<date>:<figure>` (32-day TTL). `GET /api/daily-snow?date=YYYY-MM-DD` serves an archived post and `GET /api/daily-snow/figure/<date>/<figure>` its stills.

## Local development

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
| `npm run dailysnow:once` | Prints the Daily Snow model request built from production data (`-- --digest` prints the facts; `-- --validate <response.json>` checks a saved model response) |
| `npm run build` | Next.js static export into `out/` |
| `npm run cf:build` | Static export plus Wrangler dry-run of the Worker bundle |
| `npm run smoke` | Credential-free workerd checks of all pages, navigation payloads, API routing, KV, and both share PNGs (run after build) |
| `npm run preview` | Static build, then serve assets and APIs locally in workerd |
| `npm run preview:scheduled` | Same as `preview`, with `wrangler dev --local --test-scheduled`. Trigger the cron with `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` |

To try a prompt against the real model: `npm run -s recommend:once > /tmp/body.json`, then `cf ai run @cf/zai-org/glm-5.3-flash --body @/tmp/body.json` (requires `cf auth login`). Daily Snow generations take longer than `cf ai run`'s 30 s client timeout, so POST its body to `https://api.cloudflare.com/client/v4/accounts/<account id>/ai/run/@cf/zai-org/glm-5.3-flash` with a longer timeout, then check the response's `result` with `npm run dailysnow:once -- --validate <file>`.

Both prompt scripts accept `--live-ensemble` to collect the new numerical source directly for read-only pre-deployment tuning (no KV writes). Example: `npm run -s dailysnow:once -- --live-ensemble > /tmp/body.json`. Use the same flag and `--now` time when validating that response. `recommend:once -- --assume-in-season` explicitly overrides preseason eligibility for model evaluation; it is not a report of actual operations.

URL options: old `?slide=<id>` links redirect to that section's page.

> **Local dev caveat (macOS 27 / wrangler 4.156):** the local `workerd` runtime sometimes opens tens of thousands of loopback connections to itself. Once the ephemeral ports run out, any local request can briefly fail with `EADDRNOTAVAIL`. This was observed with the former OpenNext development setup and a minimal KV-only `getPlatformProxy()` config; development now uses Wrangler directly. It clears on its own; restart `npm run dev` if it persists.

## Production

Live at **https://cottonwoods-snow-report.huang.mx**. It runs as the Worker `cottonwoods-snow-report` on the Cloudflare account "Huang Inc." (Workers Paid).

| Piece | Where |
| --- | --- |
| Worker + cron (`*/5 * * * *`) | `wrangler.jsonc` |
| KV namespace `SNOW_KV` | id `25451aae36fb40b68f530ee747940440` (in `wrangler.jsonc`) |
| Workers AI | binding `AI`; AI Gateway `snow-report` (`AI_GATEWAY_ID`) with logging, no caching and a daily request limit |
| Domain | Workers custom domain `cottonwoods-snow-report.huang.mx` (DNS record and certificate managed by Cloudflare). `workers.dev` is disabled; per-PR preview URLs are enabled. |
| Logs | Workers Logs (`observability.enabled`). Each cron logs one `{"event":"collection",…}` line, including the `recommendation` and `dailySnow` outcomes. Live tail: `npx wrangler tail cottonwoods-snow-report` |
| Plain vars | `AI_GATEWAY_ID`, `COLLECTOR_CONTACT` (site URL, sent in the User-Agent) |

**Deploys are automatic** (`.github/workflows/deploy.yml`):

- Every push to `main` typechecks, tests, builds, and smoke-checks the local Worker, then runs `npm run deploy` (static export + `wrangler deploy`).
- Every pull request from this repository passes the same checks, then is uploaded with `wrangler versions upload` as a non-deployed Worker version with a stable preview URL (`pr-<number>-cottonwoods-snow-report.huang-inc.workers.dev`), linked in a PR comment. Previews share production bindings, so they read the live KV snapshot; crons stay on the deployed version.

The workflow uses two repository secrets:

- `CLOUDFLARE_API_TOKEN`: the user API token "cottonwoods-snow-report deploy (GitHub Actions)". It is limited to this account (Workers Scripts, Workers KV, Workers Tail, Account Settings read) and the `huang.mx` zone (Workers Routes, Zone read). To rotate it, roll the token in the dashboard (My Profile → API Tokens), then run `gh secret set CLOUDFLARE_API_TOKEN`.
- `CLOUDFLARE_ACCOUNT_ID`.

Optional secrets (`npx wrangler secret put …`):

- `UDOT_API_KEY`: enables UDOT Traffic API events (closures, avalanche control). Requires a free UDOT Traffic developer key.
- `ADMIN_TOKEN`: enables `POST /api/admin/collect`. Unset in production, so the route returns 404.

To deploy by hand, set `CLOUDFLARE_API_TOKEN` (or run `npx wrangler login`), then run `npm run deploy`.

**Plan and usage:** Workers **Paid** is required. Cropping a new plume run costs roughly 100–130 ms CPU per station (PNG decode and encode), a few times a day, and an ordinary collection is close to the free plan's 10 ms CPU limit for cron invocations. Static frontend requests and asset storage are free with asset-first routing. KV: one snapshot write per run (288/day) plus one read per write (~290/day), one more write after each AI attempt, four panel writes per new plume run, one archive write and up to six figure writes per Daily Snow post, and one read per dashboard poll (1,440/day per open screen). Workers AI requests are capped in code (resort pick: 40/day reserved; Daily Snow: 12/day reserved) and by the gateway limit.

## Freshness semantics (what the badges mean)

| Badge | Meaning |
| --- | --- |
| Current | Collected on schedule, and the upstream report time is within the source's window (resorts 26 h, NWS 12 h, NWS discussion/ensemble 18 h, plumes 30 h, travel times 30 min) |
| Old report | Fetched recently, but the upstream report itself is old (for example, yesterday's report or an off-season report) |
| Report time unknown | The source publishes no time (roads aggregate, webcams) |
| Stale — source failing | No successful fetch for more than 22 min (four missed runs plus KV propagation), extended by a slower source's interval (NWS/travel times 32 min, plumes, ensemble and NWS discussion 47 min); shows the last good payload |
| Unavailable | Never collected successfully |

Every section shows the source report time (America/Denver) and the last successful check. Values distinguish **0″** (reported zero), **not reported** (the source left the field empty) and **n/a** (the source doesn't provide that measurement). Measurement windows keep each source's own label.

## Design

Mobile-first and light by default, with a full dark theme chosen by the masthead's sun/moon buttons (the system preference applies when no choice is saved). Long-form pages (resort reports, Daily Snow) are page content: one reading width, no card borders, section rules instead of boxes. The Snowfall page keeps a data density focus: the Daily Snow teaser is a pale blue panel that reaches into the page gutters (edge-to-edge on phones) while its text stays on the page's aligned edge, and the AI resort pick is marked by an accent line in the left gutter spanning its data row and reasoning. Freshness and AI markers are colored chips (green fresh, amber aging, red stale, blue AI) and measured snowfall values are snow-blue; hover and keyboard-focus highlights on the resort table extend past the content so names sit inside the painted box. The forecast tables and charts scroll within their panels rather than the page. The former TV slideshow mode is gone.
