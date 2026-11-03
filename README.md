# Cottonwoods Snow Report

A snow and conditions dashboard for phones and desktop browsers. It covers the four Cottonwoods resorts (Alta, Snowbird, Solitude and Brighton) with resort webcams, NWS mountain weather, University of Utah ensemble plumes (accumulated snow and snow-to-liquid ratio on a Mountain Time axis), and canyon road status with UDOT webcams. Two AI features sit on top of the collected data: a resort pick for the day and a morning **Daily Snow** forecast post.

Product requirements: [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md). Source findings, design decisions and known limitations: [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md).

## Architecture

Next.js 16 builds a **static export** (`output: "export"`) into `out/`. One Cloudflare deployment contains those files as **Workers Static Assets** plus a **plain Worker** for APIs and background jobs. No Next.js server or OpenNext adapter runs in production.

```text
Browser → Cloudflare Static Assets → prerendered HTML / JS / CSS
Browser → /api/* → Worker → SNOW_KV
Cron (5 min) → Worker → upstream sources / Workers AI → SNOW_KV
Link crawler → /share-brand-v2.png → Cloudflare Static Assets → branded PNG
Link crawler → /daily-snow/opengraph-image → Worker → latest forecast PNG
```

- **Worker entry:** `worker.ts` exports the direct router (`src/worker/fetch.ts`) and `scheduled()` handler. Asset-first routing serves matching static files without invoking Worker code. `/api/*` and `/daily-snow/opengraph-image` use Worker-first routing. Unknown pages serve the exported 404; unknown APIs return 404 rather than an app shell.
- **Collection:** the cron `*/5 * * * *` runs `runCollection()` (`src/lib/collect.ts`). It fetches every *due* source concurrently, isolating each source's failure, and writes one snapshot to KV (`SNOW_KV`, key `snapshot:v1`). A failed source keeps its last successful payload. Writes merge against whatever a concurrent run (manual collect, or a cron overlapped by slow AI calls) stored since this run read the snapshot: the newer attempt wins per source. AI attempt bookkeeping and last-good publication advance independently, and completion wins over reservation for the same attempt. This merge is best effort: KV propagation and the gap between the merge read and write can still lose concurrent updates; strict reservations/publication require serialization.
- **Upstream budgets:** each HTTP request has a 15-second default deadline through body consumption and an 8 MB decoded-body limit for text, JSON and binary responses (callers can override either; Daily Snow still downloads stay capped at 3 MB). Streaming stops as soon as the byte budget is exceeded. Image probes cancel their bodies without downloading them.
- **Per-source cadence** (`intervalMs` on each source): resorts, roads, UDOT webcams and resort webcams every 5 min; NWS and travel times every 15 min; plumes, numerical ensemble guidance and the NWS forecast discussion every 30 min. A failed attempt is retried on the next run; manual `only` runs ignore intervals. The cron log line lists the `skipped` sources.
- **API:** `GET /api/report` (`src/worker/report.ts`) reads the snapshot and adds the freshness classification. It never contacts upstream sources or the AI models.
- **Plume panels:** when a new model run appears, the collector downloads each station's chart once, crops the Accumulated Snow and Snow-to-Liquid Ratio panels (`src/lib/plumeCrop.ts`, located from the chart's axes frames), and stores the PNGs in KV (`plume-panel:v1:<station>:<run>:<panel>`, 4-day TTL). `GET /api/plume/<station>/<run>/<panel>` serves them with long-lived caching. A run still current three days after cropping is re-cropped, restarting the TTL; a failed crop is retried hourly, at most three times per run (`src/lib/plumePanels.ts`). If cropping fails, or a stalled last-good payload outlives its stored panels, the page shows the full original chart and Daily Snow leaves those panels out of its figure choices.
  - `/plumes` and Daily Snow share `PlumePanelSvg` for white padding and a Mountain Time axis. Daily Snow stores optional `axis` metadata alongside each frozen plume still (plot bounds, model initialization and forecast length), so archived figures retain their original run and mark the posting time rather than the current time. Older posts without this metadata show a padded image without axis labels. The figure API continues to serve the raw cropped PNG; the page draws the axis.
  - New Daily Snow posts include an accumulated-snow plume whenever a candidate image can be copied. If the model omits one, code adds it after the prose with its source caption (CLN preferred, then another station), reserving one of the six figure slots. Missing plume images do not prevent publication. An accidental second opening section from the model is folded into the first, preserving its outlook and figures.
- **Numerical ensemble:** optional `ensemble` source fetches the [published Utah Snow Ensemble CLN tables](https://weather.utah.edu/text/ensgefsdslccforecast.html) independently of chart collection. Both AI features receive P10/P50/P90 snow, liquid and SLR for wholly future six-hour periods, through the ten-day horizon. Scope is the 9,416 ft nearest grid point to Alta-Collins (LCC), not BCC-specific or observed snow. Marginal percentiles cannot be summed into storm totals or subtracted from cumulative curves. Runs older than 18 h, collections older than 47 min and failed latest attempts provide no usable model amounts; the last good payload stays in KV. Exact published −0.01″ six-hour liquid traces are normalized to zero and counted; other negatives fail validation. New runs and availability changes use the existing recommendation schedule and caps. Images remain text-only figure references; no vision inference is used.
- **Frontend:** each section is its own page: `/` (regional snowfall), `/daily-snow`, `/weather`, `/plumes`, `/traffic`, `/alta`, `/snowbird`, `/solitude`, `/brighton`. The section list is `src/lib/sections.ts`; routes are `src/app/page.tsx` and `src/app/[section]/page.tsx`, prerendered static. `src/components/AppShell.tsx` sits in the root layout and polls `/api/report` on load and every 60 s, once for the whole app. Resort names in the snowfall table and Forecast links use client navigation, preserving that shared report without another loading screen. The shell is a masthead (brand, appearance control) and a row of section tabs (`src/components/SectionNav.tsx`: the current tab is marked by a sliding blue underline, the row scrolls sideways on phones, and Resorts reveals a second row of resort links with the same underline treatment). The resort row stays visible on individual resort pages; elsewhere Resorts toggles it without changing the page, Escape closes it and returns focus to Resorts, and navigating to another section closes it. Both rows scroll independently on phones and respect reduced-motion preferences. Their dividers align with the page content gutters, sit beneath the active underlines, and stay clear of scroll fades. The Resorts label stays fixed and marks the parent section on resort pages, above the routed page. Page components live in `src/components/sections/` (plus `dailysnow/`); `src/components/snowfall/` renders the shared six-hour snowfall chart; `src/components/charts.tsx` draws snow levels. Snowfall keeps one bar per six-hour period, with visible inch amounts and start times inside equal-width Mountain Time day groups. Missing periods reserve blank slots, including on partial edge days. The single figure scrolls horizontally when its readable minimum width exceeds the container; source amounts are never aggregated or split at midnight. Daily Snow retains its saved forecast.
- **Appearance:** light by default, with a full dark theme. The sun/moon buttons in the masthead override the system appearance; clicking the active button returns to the system default. The choice is stored in `localStorage` under `cottonwoods-snow-report.appearance` and applied to `<html data-theme>` by an inline script before first paint, so the theme never flashes.
- **Share images:** all previews are dark-mode 1200 × 630 PNGs. Only `/daily-snow` has a dynamic image: it uses the latest post’s headline, date, summary, AI badge and model attribution (`/daily-snow/opengraph-image`), including when sharing archive query links. Every other page, including `/`, uses the bundled branded image `/share-brand-v2.png`, retaining its own page title and description. The Daily Snow image renders with `@cf-wasm/og`, bundled fonts and precompiled WebAssembly, and caches for 10 min (1 min before collection). Static HTML has explicit deployment-specific Open Graph and Twitter URLs. Regenerate the branded asset after changing its source or shared styles with `npm run share:render` and commit the PNG; version its filename and metadata URL when replacing it to refresh crawler caches. Pinned Satori/fflate overrides apply security fixes; the HarfBuzz adapter avoids runtime WASM compilation.
- **Manual collection:** `POST /api/admin/collect` is disabled (404) unless the `ADMIN_TOKEN` secret is set, and then requires `Authorization: Bearer <token>`. Options: `?source=<id>` (repeatable) collects only those sources; `?recommend=force` asks for a new resort pick; `?dailysnow=force` writes a new Daily Snow post.

Source adapters live in `src/lib/sources/*`. Each has a pure parser, tested against captured responses in `test/fixtures/`, and a `collect()` that fetches.

## AI features

Both run inside the collection cron, after the fresh sources are stored, through the Workers AI binding `AI` and the AI Gateway named by `AI_GATEWAY_ID`. The primary model is `@cf/zai-org/glm-5.3-flash`, with `@cf/openai/gpt-oss-120b` as a one-time fallback. Output is schema-constrained JSON, validated in code before it is stored; source text is passed as data, never as instructions. Without the `AI` binding, both features are skipped. Both are labeled **AI** wherever they appear.

The shared pieces live in `src/lib/ai/`: `model.ts` builds the request body, runs the primary model and then the fallback with a timeout per attempt, and parses the JSON; `grounding.ts` checks that every inch amount in the output (over 1″, within 1″) matches an inch amount in the input. Only inch amounts count: inch-named numeric fields (`snowIn`, `next72In`, …) and amounts written in inches in source text, not elevations, temperatures, wind speeds, percentages or dates. Each feature supplies its prompt, schema and validator.

- **Resort pick** (`src/lib/recommend/`): today's (tomorrow's after 2 PM) pick on the Snowfall page, integrated into the resort table — the picked resort's row gets an AI badge, with its plan, summary, caveats and model metadata in a reasoning row directly beneath. It refreshes on material changes, within a daily request cap. Nothing is shown until there is a resort pick, including when the result explicitly selects no resort.
- **Daily Snow** (`src/lib/dailysnow/`): a short forecast post in the style of a local forecaster's daily write-up, written at **6 AM America/Denver** (checked on every cron run, so it follows daylight-saving time). It has a title, summary, an Update (shown as "Today") or Short Term Forecast (shown as "Next Few Days") section, an optional Extended Forecast, and inline figures: NWS 6-hour snowfall and snow-level charts, resort-reported totals, plume panels and this morning's snow-stake stills. Code decides the storm phase (pre-storm, storm, post-storm, quiet), computes the forecast totals, and writes every figure caption; the model only picks where figures go. Inch amounts in the text must match an inch amount in the input data (or a run of consecutive NWS six-hour amounts added up), or the post is rejected and the fallback is tried. Each model gets up to 5 minutes. When the fallback writes the post, the primary model's error is stored on the post as `fallbackReason` and logged in the cron's `dailySnow` outcome. Failures retry every 10 minutes, at most 3 times, until 10 AM. Inputs include current structured CLN ensemble spread, the NWS Salt Lake City Area Forecast Discussion, and continuity with earlier posts (`src/lib/dailysnow/continuity.ts`): the full text of the last post (its amounts are out of date and are not accepted as data), how the phase moved since then, the last five posts' titles and forecasts, the coming storm's total as each earlier post gave it, and, for a storm that ended in the last 48 hours, what we forecast next to what each resort reported. Forecasts are compared only when their storm windows overlap (within 6 hours), never by rolling 24 h or 72 h totals. A forced rewrite of today's post reads the post before it from the archive.
  - Shown at `/daily-snow` (the full post as the page content, with compact previous/next date buttons above the heading and after the article on all screen sizes, via `?date=`) and as a highlighted teaser panel at the top of the Snowfall page, above its header.
  - **Storm memory** (`src/lib/dailysnow/storms.ts`): collection tracks observed storms across days, even without AI. Reported storm totals survive upstream zero resets; earlier rolling observations retain their original window and times, never become full-storm totals, and are never added together. A source counter restarting within an event is kept as a separate segment with the full-event amount marked unknown. The recap and figure use the same record frozen with the edition. The tracker wraps up after 12 hours without an increase when the next 18 forecast hours are dry (<0.5″ in each canyon), closes after 24 such hours, and leaves the article's recap context 36 hours after closure. Snow in the near-term forecast bridges lulls; 48 hours without new evidence closes tracking with an explicit unconfirmed-end reason. Repeated old totals cannot reopen a storm. These are editorial grouping rules, not measured meteorological onset/end times.
  - Forecast totals: rolling 12/24/72-hour and seven-day calculations use unrounded hourly allocations of NWS interval snowfall, with fractional boundary hours allocated uniformly. The digest states this estimate basis and exact start time. Every hour covering the requested interval must be present; missing/duplicate coverage returns unavailable, while fully covered zero remains zero. Six-hour-only legacy snapshots cannot establish coverage, so totals stay unavailable until the next successful NWS collection. Existing bar charts and source measurement windows are unchanged.
  - Storage: the current post is in the snapshot; each post is archived at `dailysnow:v1:<date>` with new image stills at `dailysnow-fig:v2:<date>:<figure>:<sha256>`. Posts and stills expire 30 days after their post date (`DAILY_SNOW_RETENTION_DAYS`, measured from noon UTC that day; re-writing a post to link it forward keeps that expiry). Optional `stormTracking` in the snapshot holds source cursors and the three most recent events; each event is also archived at `dailysnow-storm:v1:<id>`, written only on material changes and expiring 30 days after the last one. New posts embed optional `stormRecap` data; their recap figures also freeze that data, so later observations do not alter an earlier edition. Initial collection bootstraps from at most five editions within 72 hours, using their structured observations rather than AI prose; existing posts need no migration. The app keeps only a recent archive, not a permanent one (roughly 10–20 KB per post plus about 100 KB per image still, up to six). `GET /api/daily-snow?date=YYYY-MM-DD` serves a stored post within the retention window and returns 404 past it, including for posts stored before retention existed. Each post stores links to its neighbors (`older` when it is written, `newer` added when the next post is written), so the previous/next buttons walk back through the retained posts; responses drop an `older` link and `archive` entries past retention. Once the latest post itself is past retention (a long off-season), `/api/report` returns no Daily Snow rather than a post whose stills are gone. The desktop history rail shows up to five recent posts, including the latest edition; phones use the date buttons without a history list or disclosure. Each response's `archive` lists only the 10 most recent posts (`DAILY_SNOW_ARCHIVE_POSTS`, the snapshot index), which the history rail draws from. To list the whole archive, use `cf kv keys list --prefix dailysnow:v1:`. `GET /api/daily-snow/figure/<date>/<figure>?v=<sha256>` serves revision-specific stills with immutable caching. Same-day rewrites publish new references after image writes; a failed replacement cannot alter the previous edition's stills. Legacy posts retain their `dailysnow-fig:v1:<date>:<figure>` keys and unversioned URLs, now served with five-minute revalidation. There is no migration or production backfill. Unreferenced revision artifacts from rewrites and failed publications expire with the rest of that date. Keys written before retention existed have no expiry and stay in KV until deleted; reads treat them as expired.

## AI code review

The official [PR-Agent Action](https://github.com/marketplace/actions/the-pr-agent)
runs **one advisory review per eligible PR event** through OpenRouter. A short
routing step selects a model; PR-Agent owns inference, review formatting,
persistent comments, inline findings, coverage and failure reporting.

Apply exactly one author label. PR-number parity keeps the selected reviewer
stable across pushes while distributing reviews between the other two families:

| Author label | Even PR number | Odd PR number |
| --- | --- | --- |
| `author:codex` | Claude Opus 5.5 | GLM 5.3 |
| `author:claude` | GPT-6.1 Sol | GLM 5.3 |
| `author:glm` | Claude Opus 5.5 | GPT-6.1 Sol |

Setup: store a dedicated OpenRouter key as Actions secret `OPENROUTER_API_KEY`;
set its spending cap/reset period in OpenRouter. Defaults are
`anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, and `z-ai/glm-5.3`. Optional
repository variables `AI_REVIEW_CLAUDE_MODEL`, `AI_REVIEW_GPT_MODEL`, and
`AI_REVIEW_GLM_MODEL` accept explicit same-vendor model IDs, without the
`openrouter/` prefix. Model fallbacks and auto routers are disabled. OpenRouter
may switch hosting providers serving the same model. Review content is sent to
OpenRouter and the selected provider under your account privacy settings.

Reviews run on open, reopen, ready-for-review, pushes and author-label changes.
Drafts, forks, Dependabot and bot events are skipped. Missing/conflicting author
labels produce an Actions notice without inference. A collaborator with current
write/maintain/admin permission can post exactly `/review` to rerun; other
commands and arguments are ignored. Automatic description rewriting and code
suggestion generation are disabled. Review findings are advisory: keep this
workflow optional in branch protection. Model/run details identify the reviewer;
GitHub tests and preview deployment remain independent.

The `pull_request_target` workflow and review configuration come from trusted
base/default branches, with no checkout or execution of PR code. PR-Agent reads
PR data and default-branch AGENTS.md through GitHub's API. Repeated requests for
the same head cancel each other; different heads have separate concurrency groups
so delayed older jobs cannot cancel newer heads. Native PR-Agent owns how
in-progress/full-diff reviews and their persistent findings are updated.

Policy is in `.pr_agent.toml`: **high reasoning for all three models**, a 131,072-token
context budget and a 32,768-token completion allowance shared by reasoning and
the final review. Each model call has up to 20 minutes; the job allows 45 minutes
for startup and one transient-error retry. Large-PR chunking stays disabled.
An exhausted budget fails the review rather than lowering reasoning effort.
These limits are not dollar caps. The official Action wrapper is pinned
to v0.49.0's commit; its Dockerfile uses upstream's rolling `github_action` image.
Update deliberately and check live model compatibility after upgrades.

Automatic reviews activate after merging this workflow/config into main. Existing
PRs need a new eligible event. Provider/auth/credit failures appear in PR-Agent's
native output and Actions logs; fix the configuration and post `/review` to retry.

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

**Plan and usage:** Workers **Paid** is required. Cropping a new plume run costs roughly 100–130 ms CPU per station (PNG decode and encode), a few times a day, and an ordinary collection is close to the free plan's 10 ms CPU limit for cron invocations. Static frontend requests and asset storage are free with asset-first routing. KV: one snapshot write per run (288/day) plus one read per write (~290/day), one more write after each AI attempt, four panel writes per new plume run, one archive write, up to six figure writes, and one read plus one write to link the previous post per Daily Snow post, and one read per dashboard poll (1,440/day per open screen). Workers AI requests are capped in code (resort pick: 40/day reserved; Daily Snow: 12/day reserved) and by the gateway limit.

## Freshness semantics (what the badges mean)

Collection recency, upstream report age and publication availability are separate. Source thresholds are intentionally different: a daily resort report and a travel measurement do not expire at the same age. `src/lib/report.ts` classifies sources; `src/lib/freshness.ts` owns their public labels, tones and explanations. API state names remain compatible (`stale` displays as “Updates delayed”, `time-unknown` as “Time unknown”).

| Badge | Treatment | Meaning |
| --- | --- | --- |
| Current | Green | Collected on schedule, and the upstream report time is within the source's window: resorts 26 h, NWS 12 h, NWS discussion/ensemble 18 h, plumes 30 h, travel times 30 min |
| Old report | Amber | Fetched recently, but the upstream report exceeds that source's window |
| Time unknown | Neutral | A recent collection succeeded, but the source publishes no time or its report time could not be established |
| Updates delayed | Amber | No successful fetch for more than 22 min, extended by a slower source's interval: NWS/travel times 32 min; plumes, ensemble and NWS discussion 47 min. The last good payload remains visible. This does not identify whether the source or collector is responsible. |
| Unavailable | Red | No usable collected payload is available |

Source badges live in page footers and resort headers. The Snowfall footer summarizes the resorts, worst state first. The global required-feed banner groups unavailable and delayed feeds separately. A confirmed failed latest check is shown separately from freshness; recently collected data can remain Current while a subsequent check has failed. Source footers retain the source report time (America/Denver), last successful check and attribution. Measurement windows keep each source's own label; **0″**, **not reported** and **—** mean reported zero, an empty reported field and a measurement the source does not provide, respectively.

Editorial content uses the same badge shape and semantic tones, with wording appropriate to its purpose:

| Surface | Rule and behavior |
| --- | --- |
| Resort pick | “Recommendation needs updating” (amber) when the target date changes (tomorrow after 2 PM Denver) or generation exceeds 12 h. “Updates failing” (red) after three consecutive failures. Retain the prose but remove the resort row's AI-pick endorsement for either state. |
| Latest Daily Snow | Always show edition date and posting time. Yesterday's edition is normal before 6 AM Denver; publication is pending during the 6–10 AM window. Show “Latest edition delayed” (amber), identically in teaser and article, when an expected edition is missing after retries/request budget are exhausted or the window closes. An in-flight final attempt can finish after 10 AM. An edition older than yesterday remains delayed overnight. |
| Quiet-day Daily Snow | No delay warning when usable resort/forecast inputs establish that no edition is expected under the existing season/snow activity gate. Missing or delayed inputs cannot establish an intentional pause. |
| Archived Daily Snow | Date and “Archive”, without a publication warning. The history rail calls the latest stored edition “Latest” with its date, never assumes it is today's. |

The API adds optional `dailySnow.publicationStatus` (`current`, `scheduled`, `pending`, `delayed`, `paused`) on the latest edition in `/api/report`; archive responses omit it. The existing `outdated` and `failing` fields remain for compatibility. Publication status is computed on reads using the schedule and shared activity rules; reads never collect sources or invoke AI. No additional KV keys or migrations are required.

Context-specific qualifications stay beside the information they qualify: camera stills older than 3 h have an amber “not updating” caption; unknown capture times and stream-player status remain explicit. UDOT camera request time is not capture time. Noncurrent travel measurements retain an amber “Not live” explanation and muted values. Resort road notices older than 24 h are omitted. Dashboard polling errors, or more than 3 min since the last successful response, produce a global connection banner. Ensemble AI inputs retain their stricter eligibility checks. These rules are independent of badge presentation.

## Design

Mobile-first and light by default, with a full dark theme chosen by the masthead’s sun/moon buttons (the system preference applies when no choice is saved).

- **One type scale.** `src/app/globals.css` defines size tokens (display, h2, title, h3, prose, body, meta, caption, label) and every page uses them: page titles are the display size, section headings h2, item names (resort names, the Daily Snow teaser title) the title size, timestamps and notes caption. Add a token rather than a new pixel size.
- **One page pattern.** Each page is a title with a muted subtitle, its sections, and its source line(s) at the foot (freshness chip, source time, last check, attribution). Freshness chips live in source lines and resort headers, not mid-sentence. The Snowfall table has no chips in its rows. The value legend sits just under the table, and the page ends with a source line (`ResortsSourceLine`) like the other pages': the worst resort's chip, the resorts in each state when not all are current, the oldest "Last successful check", any failed latest checks, and the four resorts as attribution on the right.
- **No card chrome.** Long-form pages (resort reports, Daily Snow) are page content: one reading width, no borders, sections separated by space. The pale panel fill is reserved for summaries: the Daily Snow teaser (reaching into the page gutters, edge-to-edge on phones), the next-storm box, the road-status box, resort snow tiles and code-drawn charts. Photos and plume images stand on their own.
- **Data marks.** Measured values are snow-blue, zeros gray; inch and degree marks are raised to the cap line. Status chips share semantic tones (green current, amber old/delayed, red unavailable/confirmed failure, neutral unknown); AI provenance stays blue. The AI resort pick is an accent line spanning its table row and reasoning row.
- **Snowfall windows.** Every resort shows the same windows in the same order, under our labels (Overnight, 12 h, 24 h, 48 h, 72 h, 7 days, Storm, Season; `SNOW_LABEL` in `src/components/sections/resort-display.ts`). A window the resort doesn’t publish keeps its slot as “—”. On resort pages the resort’s own wording appears only where its window differs (Alta’s 12 h for overnight, Solitude’s “since lifts closed”); the Snowfall table shows no note under its values, since its column headers name the windows (“Overnight / 12 h”). Source notes that cover several windows are listed once. Values are never derived: each number is the resort’s own.
- **Notices.** Resort alerts and road notices share one compact list (`NoticeList` in `ui.tsx`): title and text as one sentence, source and time beneath, most severe first. On resort pages they sit under the jump links, so the header block is identical on every resort.
- **Phones.** One breakpoint (900px). The snowfall table shows each resort as a name line (with its report time), its 24 h total as a headline, and the other windows on one line of text, and charts redraw at the screen width, so the NWS forecast table and six-hour snowfall charts scroll inside their own boxes.
