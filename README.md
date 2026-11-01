# Cottonwoods Snow Report

A fullscreen, auto-rotating snow/conditions dashboard for a living-room TV. It covers the four Cottonwoods resorts (Alta, Snowbird, Solitude, and Brighton) with resort webcams. It also shows NWS mountain weather, University of Utah ensemble plumes (accumulated snow and snow-to-liquid ratio, on a Mountain Time axis), and canyon road status with UDOT webcams.

The product requirements live in [docs/IMPLEMENTATION_BRIEF.md](docs/IMPLEMENTATION_BRIEF.md). Source findings, design decisions, and known limitations are in [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md).

## Architecture

One Next.js 16 app deployed as **one Cloudflare Worker** through `@opennextjs/cloudflare`:

- `worker.ts` is the custom Worker entry ([OpenNext custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker)). It re-exports the generated `fetch` handler and adds `scheduled()`.
- **Cron `*/5 * * * *`** runs `runCollection()` (`src/lib/collect.ts`). It fetches every source concurrently and isolates each source's failure, then writes one snapshot to KV (`SNOW_KV`, key `snapshot:v1`). On failure, a source keeps its last successful payload.
- `GET /api/report` (`src/app/api/report/route.ts`) reads that snapshot and adds the freshness classification. It never contacts upstream sources.
- **Plume panels:** when a new model run appears, the collector downloads each station's chart once, crops the Accumulated Snow and Snow-to-Liquid Ratio panels (`src/lib/plumeCrop.ts`, located from the chart's axes frames), and stores the PNGs in KV (`plume-panel:v1:<station>:<run>:<panel>`, 4-day TTL). `GET /api/plume/<station>/<run>/<panel>` serves them with long-lived caching. Later runs of the cron only HEAD-check the chart. If cropping fails, the slide shows the full original chart.
- The page (`src/components/Dashboard.tsx`) is a client-side slideshow. It polls `/api/report` on load and every 60 s. The slide timer is independent of polling.
- `POST /api/admin/collect` triggers a manual collection. It is disabled (404) unless the `ADMIN_TOKEN` secret is set, and then requires `Authorization: Bearer <token>`.

Source adapters live in `src/lib/sources/*`. Each one has a pure parser (tested against captured responses in `test/fixtures/`) and a `collect()` that fetches.

## Local development

Requires Node 20+ (tested with Node 24.12).

```sh
npm install
cp .dev.vars.example .dev.vars        # local-only vars; never commit
npm run dev                           # http://localhost:3000 (next dev + local KV via Miniflare)
# Seed local KV from the real sources (no cron runs under next dev):
curl -X POST -H "Authorization: Bearer change-me-local-only" http://localhost:3000/api/admin/collect
```

Other useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | Vitest: parsers, timestamp semantics, partial failures, API output, playback/UI (jsdom) |
| `npm run typecheck` | `next typegen` (route types) then `tsc --noEmit` |
| `npm run collect:once` | Runs one real collection in Node with in-memory KV and prints per-source status (`-- --json` prints the full API shape) |
| `npm run preview` | OpenNext build, then serve the real Worker bundle locally in workerd |
| `npm run preview:scheduled` | Same as `preview`, but with `wrangler dev --test-scheduled`. Trigger the cron with `curl "http://localhost:8787/__scheduled?cron=*/5+*+*+*+*"` |

URL options: `?slide=<id>` picks the first slide (`regional`, `weather`, `plumes`, `traffic`, `alta`, `snowbird`, `solitude`, `brighton`). `?kiosk=1` starts playback without the start screen (useful as a TV bookmark). `&paused=1` starts paused.

> **Local dev caveat (macOS 27 / wrangler 4.156):** the local `workerd` runtime sometimes opens tens of thousands of loopback connections to itself. Once the ephemeral ports run out, any local request can briefly fail with `EADDRNOTAVAIL`. This reproduces with a minimal KV-only `getPlatformProxy()` config and no app code, so it is upstream tooling, not this app. It clears on its own; restart `npm run dev` if it persists.

## Production

Live at **https://cottonwoods-snow-report.huang.mx**. It runs as the Worker `cottonwoods-snow-report` on the Cloudflare account "Huang Inc." (Workers Paid).

| Piece | Where |
| --- | --- |
| Worker + cron (`*/5 * * * *`) | `wrangler.jsonc` |
| KV namespace `SNOW_KV` | id `25451aae36fb40b68f530ee747940440` (in `wrangler.jsonc`) |
| Domain | Workers custom domain `cottonwoods-snow-report.huang.mx` (DNS record + certificate managed by Cloudflare). `workers.dev` and preview URLs are disabled. |
| Logs | Workers Logs (`observability.enabled`). Each cron logs one `{"event":"collection",…}` line. Live tail: `npx wrangler tail cottonwoods-snow-report` |
| Plain vars | `COLLECTOR_CONTACT` (site URL, sent in the User-Agent) |

**Deploys are automatic:** every push to `main` runs `.github/workflows/deploy.yml`. It typechecks and tests, then runs `npm run deploy` (OpenNext build + `wrangler deploy`). Pull requests are tested only. The workflow uses two repository secrets:

- `CLOUDFLARE_API_TOKEN`: the user API token "cottonwoods-snow-report deploy (GitHub Actions)". It is limited to this account (Workers Scripts, Workers KV, Workers Tail, Account Settings read) and the `huang.mx` zone (Workers Routes, Zone read). To rotate it, roll the token in the dashboard (My Profile → API Tokens), then run `gh secret set CLOUDFLARE_API_TOKEN`.
- `CLOUDFLARE_ACCOUNT_ID`.

Optional secrets (`npx wrangler secret put …`):

- `UDOT_API_KEY`: enables UDOT Traffic API events (closures, avalanche control). Requires a free UDOT Traffic developer key.
- `ADMIN_TOKEN`: enables `POST /api/admin/collect`. Unset in production, so the route returns 404.

To deploy by hand, set `CLOUDFLARE_API_TOKEN` (or run `npx wrangler login`), then run `npm run deploy`.

**Plan:** Workers **Paid** is required. Cropping a new plume run costs roughly 100–130 ms CPU per station (PNG decode and encode), a few times a day, and an ordinary collection is close to the free plan's 10 ms CPU limit for cron invocations. KV usage is one snapshot write per run (288/day) plus four panel writes per new plume run plus one read per dashboard poll (1,440/day per open screen).

## Freshness semantics (what the badges mean)

| Badge | Meaning |
| --- | --- |
| Current | Collected on schedule, and the upstream report time is within the source's window (resorts 26 h, NWS 12 h, plumes 30 h, travel times 30 min) |
| Old report | Fetched recently, but the upstream report itself is old (for example, yesterday's report or an off-season report) |
| Report time unknown | The source publishes no time (roads aggregate, webcams) |
| Stale — source failing | No successful fetch for more than 22 min (four missed runs plus KV propagation); shows the last good payload |
| Unavailable | Never collected successfully |

Every slide shows the source report time (America/Denver) and the last successful check. Values distinguish **0″** (reported zero), **not reported** (the source left the field empty), and **n/a** (the source doesn't provide that measurement). Measurement windows keep each source's own label.

## Real-TV smoke test (pending: Samsung The Frame, ~32″, not yet purchased)

Desktop tests cannot certify these items:

- [ ] Open the URL in the TV's built-in browser. Fonts are legible from the couch at 1080p/4K, and nothing overflows.
- [ ] "Start fullscreen" enters fullscreen. If the browser refuses, note the fallback (the `?kiosk=1` bookmark still plays windowed).
- [ ] Remote: ←/→ change slide; ↑/Enter reveals the controls and focuses Play/Pause; ←/→ move between controls; Enter activates; Back/Escape hides the controls. Note which media keys, if any, arrive.
- [ ] Slides advance every 20 s. Change the duration and confirm it persists across a reload.
- [ ] Leave the TV running for 2+ hours: data timestamps keep advancing ("checked N min ago" stays under 10 min), webcams refresh, and there is no memory/performance degradation.
- [ ] Unplug the network for 5 min: the "can't reach its server" notice appears, the last data stays visible, and it recovers on reconnect.
- [ ] TV sleep/wake and power cycle: does the browser relaunch on the page? Does autoplay resume (persisted after the first explicit start)? Does the screensaver/Art Mode interrupt?
- [ ] Plume panels and UDOT and resort webcams load in the TV browser (cross-origin images, no CORS needed).
- [ ] Solitude and Brighton cams are muted YouTube live embeds: check that they autoplay in the TV browser and that four players across the slideshow don't degrade it over hours.
