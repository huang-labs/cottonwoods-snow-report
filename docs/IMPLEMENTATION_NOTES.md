# Implementation notes

Findings from implementation on 2026-10-30, verified against the live sources and current docs. Where a finding refines the brief's (`IMPLEMENTATION_BRIEF.md`) preliminary reconnaissance, it is recorded here. The brief itself was revised once, for the phone/desktop-first change below.

This file is reference material: source findings, design decisions and known limitations that the code doesn't explain. It is not a changelog. As of 2026-11-03, PRs no longer append dated entries; the PR description records each change and its validation, and lasting decisions are edited into the relevant section here or in the README. The dated sections below are kept as history and may be superseded by later code or sections.

## Scope changes after v1 (2026-11-01, requested by the owner)

These supersede the brief where they differ.

- **Static frontend + direct Worker** (2026-11-01): Next.js remains the authoring/build framework and exports `out/`; it no longer runs as a request-time server. OpenNext and its self-reference binding were removed. Workers Static Assets serves pages, JS, CSS, icons, and Next navigation payloads directly; `src/worker/` owns the report, plume, admin, Daily Snow archive/figure, and both live share-image endpoints with direct bindings. Cron, namespace, domain, source cadences, and snapshot schema are unchanged. The share image uses `@cf-wasm/og` with patched Satori/fflate versions and a precompiled HarfBuzz adapter for workerd. Local development builds the export and runs `wrangler dev --local`; frontend changes require a rebuild. CI runs a real workerd smoke test as well as unit tests and typechecking. Rebased onto `e237ef8` to retain Daily Snow, its preview metadata, resort browse-page redesign, and numerical ensemble guidance; validation passed 173 tests plus all nine static pages, both share PNGs, and per-section share metadata in workerd.

- **Phone/desktop-first navigation** (2026-11-01; the brief was revised to match). Each section is a static page (`/`, `/daily-snow`, `/weather`, `/plumes`, `/traffic`, `/alta`, `/snowbird`, `/solitude`, `/brighton`) under the masthead nav. The report poller lives in the root layout's `AppShell`, so page changes don't refetch. Section pages share the site-wide live link-preview image; their titles are per section. The TV slideshow mode that this change kept was removed on 2026-11-02 (PR #25, below).

- **Park City, Deer Valley and Snowbasin removed** (adapters, fixtures, regional rows). The Snowfall page lists only the four Cottonwoods resorts. Old snapshot records of removed sources are dropped on the next write.
- **Plumes: two panels per station.** Only Accumulated Snow and Snow-to-Liquid Ratio are shown, for Alta-Collins and Silver Lake Brighton (four panels). They are cropped server-side. This replaces the brief's "show the original charts unmodified" for this product; the crop is pixel-for-pixel, apart from the UTC tick labels being cut off.
- **Plume time axis in Mountain Time.** Verified: the charts' x-axis is UTC. Tick labels read "00z 01-Nov", and the title reads "Initialized 0000 UTC 01 Nov 2026". The axis spans exactly init → init + 240 h (`F240` in the file name; first and last ticks sit on the frame edges). The UTC labels are cropped off, and the Plumes page draws a Mountain Time axis: day names centered on each local day, dashed local-midnight lines, and a "now" line. Reason: 00Z is 5 PM MST (6 PM MDT) the *previous* day, so "00z 02-Nov" is the evening of Nov 1 locally, an easy misread. The plot's own gridlines stay at 00Z/12Z (5 AM/5 PM MST); the dashed lines are the local day boundaries.
- **Section order:** see `SECTIONS` in `src/lib/sections.ts`.
- **Resort webcams** on each resort page (below).
- **Per-source collection intervals** (2026-11-01): slow sources skip cron runs. NWS and travel times are collected every 15 min and plumes every 30 min; everything else every 5 min. Cost is unchanged (usage is a few percent of Workers Paid included limits); this saves about 80 upstream requests an hour, roughly 22% of the collector's requests, mostly to weather.utah.edu and api.weather.gov.

## All resort webcams on the resort pages (2026-11-02)

Each resort page's Webcams section used to show only two curated cameras per resort (the featured lift-line/snow-stake picks). The collector already discovered every camera on each resort's own page, so it now keeps all of them except a small exclusion list: featured cameras first, then the rest in page order (Alta 7, Snowbird 6, Solitude 9, Brighton 5 as of 2026-11). Featured leads per the owner: Solitude's Snowstake and Brighton's Parking Lot come first — the parking lot answers "how busy is it" before the lift line; Snowbird's Hidden Peak 360 is excluded as a 360° panorama with no snow information. Costs per run: about five more image probes, and oEmbed lookups for YouTube IDs not yet cached — including failed lookups, which are cached too, so a private stream costs one call ever. Embeds with no public oEmbed title show "video unavailable" in their players, so they are dropped instead of listed. The section's styles were unchanged (the existing grid takes any count; phones collapse to one column). Snowbird's Hidden Peak camera turned out to be a `backend.roundshot.com` image, now covered by a fixture route.

## Resort page headings (2026-11-02)

"Lifts & terrain" is now just **Lifts**, and **Named terrain & gates** was promoted from an h3 sub-heading to an equal h2 section heading (same `resort-section-heading` treatment as every other resort section). They stay in one `resort-operations` section; the jump nav gained a "Terrain" anchor for the new heading.

## Concurrent snapshot writes (2026-11-02)

The snapshot is a read-modify-write cycle on one KV key, and two runs can overlap: a manual `POST /api/admin/collect` during a cron run, or a cron whose model calls (up to 2 × 5 min for the Daily Snow) span the next triggers. Because KV has no compare-and-swap, the second writer used to store the snapshot it had read at its own start, silently reverting the first writer's fresh records (and AI state) wholesale.

`writeSnapshot` (`src/lib/store.ts`) now re-reads the stored snapshot immediately before each put and merges (`mergeSnapshot`): per source, the record with the newer `lastAttemptAt` wins; the recommendation and Daily Snow states compare `lastAttemptAt` (falling back to the current output's `generatedAt`), so a later attempt — booked or completed — wins and equal timestamps let the writing run's state through. The incoming snapshot must contain a record for every live source (`runCollection` guarantees this by carrying previous records); keys missing from it are treated as removed sources and dropped, as before. This narrows the lost-update window from a whole run (collection plus model calls) to the gap between the merge read and the put, plus KV's own propagation lag (up to ~60 s across locations). A KV-based advisory lock was considered and rejected: KV's get-then-put is itself not atomic, so a lock cannot provide real mutual exclusion and only adds failure modes. True serialization would need a Durable Object, which is not justified at this write volume.

Known residual risks, accepted: two runs that both start before either books an AI attempt can both run the model, so the daily call cap can drift upward by one attempt in a rare overlap; and a merge read that misses a just-written snapshot due to KV propagation still behaves like the old last-writer-wins for that pair. Tests cover the overlap interleaving and the merge policy in `test/collect.test.ts` (`concurrent snapshot writers`).

## First scheduled Daily Snow: timeout and forecast-discussion updates (2026-11-02)

The first 6 AM post (13:00 UTC, the day after the DST change, scheduled correctly) was written by the fallback model. AI Gateway logs show why: GLM 5.3 Flash returned HTTP 200 with `finish_reason: stop` after **127.7 s** (8,270 prompt / 3,889 output tokens), but the Daily Snow timeout was 120 s, so the Worker had already moved on; gpt-oss-120b answered in 37.8 s (1,911 output tokens). Replaying both responses through `validateDailySnow` against the exact 6 AM digest (taken from the gateway's request log): both pass, but GLM's post used the structured ensemble, four figures and an Extended section (378 words), while gpt-oss used one figure, no ensemble and no Extended section (192 words). The only earlier GLM Daily Snow call (Nov 1 manual, before the ensemble digest) took 36 s with a 4,662-token prompt; the ensemble periods and recent-post history grew the prompt 77%.

- `DAILY_SNOW_TIMEOUT_MS` is now 5 minutes per model. The cron wall-time limit is 15 minutes, so two timeouts plus figure copies fit; `IN_FLIGHT_MS` is derived from it (12 minutes) so later crons don't start a second attempt meanwhile. CPU time is unaffected (waiting on the model is not CPU).
- The primary model's error used to be discarded when the fallback succeeded, leaving no trace in the snapshot or Workers Logs. It is now logged (`console.warn`), stored on the post as `fallbackReason` (also served by the API) and included in the cron's `dailySnow` outcome.
- NWS issued a 5:13 AM AFD update whose unchanged sections keep their original time in the header (`.DISCUSSION, Issued 1037 PM MST Sun Nov 1 2026...`). The parser didn't accept the comma, found no discussion section, and the source failed every run until the next full issuance (no content was lost that morning: the text matched the 10:37 PM product already stored). The header form is now parsed, and the original time is kept as the section's `issued` so the model sees how old the text is. Fixture: `test/fixtures/nws-afd-SLC-update.json`.

Not addressed here: prompt tuning (GLM introduced a plume image with a sentence quoting the six-hour numerical rows, which the prompt forbids; gpt-oss under-uses figures and the ensemble).

## Platform versions (verified 2026-10-30)

- Initial implementation (before the static-export migration): `next@16.4.3`, `react@19.3.1`, `@opennextjs/cloudflare@1.20.15` (peer range `next >=15.5.28 <16 || >=16.4.1`; the adapter changelog adds Next 16.4 support and Turbopack builds), `wrangler@4.156.0`, TypeScript 7.0.2.
- Initial Worker entry used OpenNext: `worker.ts` imports `./.open-next/worker.js`, exports `fetch: handler.fetch` plus `scheduled`, and `wrangler.jsonc` `main` points at `worker.ts`.
- Next 16 route-segment config: `dynamic = "force-dynamic"` remains valid because Cache Components is not enabled.
- `npm audit` reports advisories in `glob`/`minimatch`, pulled in by the adapter's build-time CLI. They are not part of the deployed Worker.

## Storage decision

The brief asks to store "the latest successful normalized data per source in KV". Each source has its own record (payload, `sourceUpdatedAt`, `lastSuccessfulFetchAt`, `lastAttemptAt`, status, error, consecutive failures, upstream diagnostics). All records live inside **one** KV value (`snapshot:v1`), for three reasons:

- One write per run (288/day) fits KV's free-tier write limit (1,000/day). Per-source keys would need about 3,500 writes/day.
- The API serves a mutually consistent snapshot with a single read.
- Only the collection cron writes during normal operation (`POST /api/admin/collect` is the other writer, disabled unless `ADMIN_TOKEN` is set), and `writeSnapshot` merges against the latest stored snapshot so concurrent runs keep each other's records (2026-11-02, above).

## Sources: final integrations

| Source | Endpoint used | Format | Report time used | Notes |
| --- | --- | --- | --- | --- |
| Alta | `https://www.alta.com/lift-terrain-status` | `window.Alta = {…}` JSON embedded in HTML | `conditions.dated_at` (Denver local) | Gives 12 h / 24 h / storm / base / YTD, base/mid/top temps, one wind value with no stated site (shown as such), per-lift status and notes, terrain areas, access gates, road/parking alerts. No overnight or 48 h field, so those show as n/a. |
| Snowbird | `https://api.snowbird.com/api/v1/dor/drupal/snow-reports`, `…/dor/drupal/lifts`, `…/terrains`, `…/dor/sensors`, `…/dor/drupal/parking` | JSON (the snowbird.com Gatsby site loads these client-side; the page HTML has no data) | Report `updated` epoch (publish time); the report's own `date` label is shown too | `overnight_amount` comes from the latest Primary report. 24/48/72 h and 7-day totals are Snowbird's `computed` rolling values relative to fetch time, labelled as such. No storm total. Sensor times are "MM DD HHMM" without a year, interpreted as Denver local. Lifts, terrain, sensors, and parking degrade independently (`missingSections`). |
| Solitude | `https://v4.mtnfeed.com/resorts/solitude.json` (public widget config: resort id 65 + public bearer token), then `https://mtnpowder.com/feed/v3.json` | JSON (Mountain Powder feed behind the site's conditions widget) | `SnowReport.LastUpdate` | Uses the preferred (mid) reporting location: since-lifts-closed / 24 / 48 / 72 h / 7-day, storm total, base, season. Named terrain is listed trail by trail within named areas (Honeycomb Canyon, Evergreen Peak, …), never inferred from counts. The token is read each run and redacted from diagnostics; the API never exposes it. |
| Brighton | `https://www.brightonresort.com/api/reportpal?resortName=br&useReportPal=true` | JSON (same-origin endpoint behind the "Loading…" fields) | `updated` | Overnight / 12 / 24 / 48 / 72 h / 7-day / season / base, per-lift status, comments. No temperature or wind in this feed (the site uses NOAA), so those point to the weather slide. No storm total. |
| Utah plumes | `https://weather.utah.edu/index.php?t=ensgefsds&d=PL&r=CLN` and `r=PKCU1` | HTML: "Current selection … NNNNNNNNNN initialization." plus the SciAnimator `images_vis` list | Model run (UTC) from the run code | Without a `runcode` parameter the page serves the latest run. The chart PNG is checked with HEAD (status, content type, Last-Modified) before acceptance. Original charts are shown unmodified (82-member GEFS + ECMWF ENS, full 10-day range, percentiles). Station codes verified against the station menu: CLN = Alta-Collins, PKCU1 = Silver Lake Brighton. |
| NWS | `https://api.weather.gov/gridpoints/SLC/108,167` (Alta) and `/110,168` (Brighton), plus `/forecast` text | JSON | Grid `updateTime` | Snowfall, QPF, snow level, temperature, wind, gust, and PoP, resampled hourly into Denver 6 AM/6 PM day/night blocks (DST-safe; verified across the 2026-11-01 change), 6-hour snow bars, and the next ≥1″ storm episode. |
| Roads | UDOT Cottonwood Canyons site (`/road-information/`: header alerts and mouth-of-canyon sign blocks); UDOT overhead-sign messages relayed by `api.snowbird.com/api/v1/dor/traffic` (statewide, filtered to SR-190/209/210 and Wasatch Blvd); UDOT pass conditions relayed by `brightonresort.com/api/reportpal-roads`; Snowbird `dor/drupal/roads` ("Highway SR-210" row only; other rows are CMS test entries); optional UDOT Traffic API `event` (needs `UDOT_API_KEY`) | Mixed | Per notice when the source supplies one | Severity: closure/avalanche/interlodge wording counts as critical. All notices, including seasonal gate notices (for example, the Guardsman Pass closure), show on the roads slide. Resort road/parking statuses (Alta road status, parking at all four resorts) are shown too. |
| Travel times | ArcGIS `CC_Routes_TT/FeatureServer/0` (anonymous query) | JSON | `LATEST_LOCAL_DATETIME` (measurement), **not** `EditDate` | See below. |
| Webcams | `https://www.udottraffic.utah.gov/map/Cctv/171450` (SR-210 Seven Turns, MP 7.4) and `/171447` (SR-190 S-Curves, MP 6.38) | JPEG | none published | IDs and captions come from the UDOT Cottonwood Canyons page. Availability is checked server-side. The browser loads them directly with a once-a-minute cache-buster. UDOT publishes no capture time; the image overlay shows one, and the UI says so. |

### Plume panel cropping

`src/lib/plumeCrop.ts` decodes the chart with `fast-png` (pure JS, Worker-safe). It finds the matplotlib axes frames, the long vertical black edges that carry one segment per panel row, and requires a 3×2 layout with solid top and bottom frame lines. It crops the right column's top (snow) and bottom (SLR) panels, keeping the panel title, the y-axis label and the tick marks, and cutting at the first blank row below the frame. Figure-level text that intrudes into the title band (the "Powered by …" credit) is blanked. Any layout mismatch throws, and the plume source then stays successful with `cropError` set; the slide falls back to the full original chart.

Cost: about 90–130 ms CPU per station in Node, once per new model run. Same-run collections reuse the stored panels after a HEAD check: about 55 ms wall time, measured under local workerd.

### Resort webcams (`resortcams` source, optional)

Discovered from each resort's own page on every run. Every camera the resort publishes is collected, with the featured cameras (lift lines, snow stakes) first and the rest in page order. Each resort is isolated: on failure, that resort keeps its previous cameras, and the failure is listed.

| Resort | Discovery | Featured cameras | Capture time |
| --- | --- | --- | --- |
| Alta | `window.Alta.weather.mountainCams` on `alta.com/weather` (7 cameras) | Snow Stake (Collins), Albion Basin; then Mount Baldy, Mount Superior, Sugarloaf Peak, East Greeley, Salt Lake Valley | Image `Last-Modified`. Albion Basin and Mount Baldy (prismcam) send a Last-Modified about an hour in the future, which is rejected ("capture time not published"). Alta publishes no lift-line camera. |
| Snowbird | Webcam cards on `snowbird.com/the-mountain/webcams/view-all-webcams/` (name + snapshot image) (6 cameras) | Tram Bullpen (the tram lift line), Snowstake; then Peruvian Gulch, Mineral Basin, Little Cloud, Hidden Peak | Image `Last-Modified`. **No Gad Zoom camera is published** on Snowbird's site. Hidden Peak is a `backend.roundshot.com` image; the rest are `manage.hdrelay.com`, which returns 500 to HEAD, so the probe falls back to a ranged GET. Hidden Peak 360 (also roundshot) is excluded as a 360° panorama with no snow information. |
| Solitude | YouTube live embeds on the webcams page (9 cameras) | Solitude Snowstake, Moonbeam Lift Line, Apex Express and Sunrise Lift Lines; then the other six in page order | Live stream. The embedded player shows live/offline status. |
| Brighton | YouTube live embeds on `brightonresort.com/conditions` (5 cameras) | Parking Lot, Milly Express; then Molly Greens View, Top of Crest Lift, Explorer Lift | Live stream. |

Stream titles come from oEmbed, not page layout. On Solitude's page each caption follows its player, so reading the preceding caption mislabels every stream by one. Titles are cached in the payload — including failed lookups, so a private stream costs one oEmbed call ever — and an unchanged page costs no oEmbed calls. Embeds with no public oEmbed title (three on Solitude's page as of 2026-11) are dropped: their players only show "video unavailable". Live-stream thumbnails were rejected: they carry no capture time, and an offline stream serves its custom promo still. Images that become unreachable are dropped. Images older than 3 h are labelled "not updating".

### Travel-time freshness (resolved: not shown as live)

`LATEST_LOCAL_DATETIME` is 2025-03-04 (a Tuesday) on every segment, and `DAY_OF_WEEK` is "Tuesday". Meanwhile `EditDate` advances every five minutes, and some `Current_Travel_Time__min_` values drift between samples (for example, Alta → P&R 13 → 15 min). Because the measurement-time field is frozen, the values cannot be verified as current measurements. The UI shows them struck through under "Not live … cannot be verified as current".

The field's time zone is undocumented. It is read as Denver wall time stored as UTC (Esri "local" convention), and any resulting time in the future is rejected. If UDOT resumes updating this field in season, values within 30 minutes become "Current" automatically. Verify that interpretation against the UDOT dashboard during the first storm.

### UDOT developer API

The documentation (2026-10-30) confirms a developer key is required (`key` query parameter, registered account) and throttling at 10 calls per 60 s. One `event` call per five-minute run is well within that. No key was available, so the integration is implemented but unverified against live responses. The roads feed reports "UDOT Traffic API events: not configured" until a key is set.

## Release status against the brief's v1 requirements

- Real snowfall for all four primary resorts: **working** (Alta, Snowbird, Solitude, Brighton all collect and validate from the Worker runtime under local workerd).
- Latest Utah plumes: **working** (dynamic run discovery plus image check).
- Degradable: NWS, roads, UDOT webcams and resort webcams work. Travel times are collected but flagged not live. UDOT API events need a key.
- Deployed 2026-11-01 to https://cottonwoods-snow-report.huang.mx (see [Deployment and operations](DEPLOYMENT.md)). First production cron (18:10 UTC): all 10 sources collected successfully from Cloudflare's network, with no resort CDN blocking. That run cropped a new plume run and used 1.5 s CPU (3.1 s wall time). The first tick after the cron trigger was created (18:00) did not fire; schedules took a few minutes to become active.

## AI ski recommendation (2026-11-01)

The regional snowfall slide now includes a short recommendation, a plan (go now or wait for a posted canyon opening), reasons, caveats, a backup, and its update time. The recommended resort row gets an AI pick badge. The target switches to tomorrow at 2 PM America/Denver. No eligible resorts produces an explicit, rule-based no pick without a model request. Old picks remain visible with warnings; outdated or repeatedly failing picks lose the row badge.

The existing five-minute collector builds a compact digest after fetching sources. It stores the fresh sources and request reservation before awaiting AI, then writes the resulting recommendation separately. API reads never trigger inference. Failure of both models preserves the previous pick and records the error. The additional snapshot write happens only on an inference attempt (up to 20/day with the conservative request reservation); this corrects the original proposal's claim that no additional KV writes were needed.

- Primary: `@cf/zai-org/glm-5.3-flash`, high reasoning, 3,000 output-token limit. Fallback: `@cf/openai/gpt-oss-120b`, medium reasoning. Both return schema-constrained JSON, then receive application validation against eligible resorts. Source prose is treated as data rather than instructions.
- Workers AI is bound as `AI`; gateway `snow-report` is selected by `AI_GATEWAY_ID`. The gateway was created with logging, no response caching, postpaid Workers AI billing, and a sliding limit of 40 model requests per 86,400 seconds. Fallback is explicit in application code, rather than a dynamic gateway route.
- App scheduling checks every five minutes: critical changes at least ten minutes apart; material changes at least thirty minutes apart; morning refreshes at 5:30 and 7:15; a two-hour maximum age during 5 AM–4 PM. Quiet hours are 9 PM–4:30 AM, with critical changes and target changes still allowed. Failures retry after ten minutes. Requests reserve two slots per attempt (primary plus fallback), capped at 40 per Denver date; manual forcing honors the cap. KV is not an atomic lock, so the gateway limit also bounds overlapping manual/cron requests.
- Storm mode starts at 6″ recent/overnight snowfall or 4″ forecast during the target ski day. Tomorrow uses overnight and next-day forecasts. Storm mode prioritizes powder; fair mode prioritizes an easy commute, conditions and parking. NWS snowfall/QPF provides a derived SLR; plume raster images are not sent to the model.
- Eligibility uses operating/scheduled lifts plus four days of last-observed operation, excluding explicit season closure. Stale resort records do not refresh that memory. A first deployment during overnight closure may need to observe operating lifts before it can confirm the season. Today's interlodge canyon is excluded; closed roads with estimates remain candidates for a conditional wait strategy. Tomorrow's road conditions are a forecast assessment, not a promise.
- Canyon classification excludes seasonal sign messages **before** splitting their lines; this prevents Guardsman Pass's three-line closure from becoming an LCC closure. Missing affirmative road status is unknown. Missed opening estimates stay on the original day rather than moving to tomorrow. UDOT/resort text parsing still needs validation against real in-season storm notices.
- Frozen UDOT commute measurements are omitted from model facts entirely. A smoke test caught the fallback quoting these numbers despite a prompt warning, which is why withholding the values is necessary. Live measurements must be within thirty minutes and the source collection must be fresh. Named terrain is available only when explicitly reported open; familiar terrain examples in the prompt are not availability evidence.

Validation includes fixture-based digest, canyon, schedule, persistence and fallback tests, plus card/badge rendering tests. Live GLM inference on a synthetic 18″ LCC / 10″ BCC storm selected Alta with a conditional wait for a 9:30 AM estimate and Solitude as backup. With no LCC opening estimate, the fallback chose Solitude in the already-open BCC. Model prose can still overstate crowd or wait assumptions; prompt rules explicitly forbid claims of light crowds or guaranteed opening waits. These are model smoke tests, not evidence of actual resort conditions. The CLI helper defaults to production facts; `--scenario powder-wait` and `--scenario bcc-now` explicitly inject synthetic facts.

Manual refresh: authenticated `POST /api/admin/collect?recommend=force` (same existing admin bearer token). Prompt inspection: `npm run recommend:once -- --digest`; direct inference: `npx tsx scripts/recommend-once.ts > /tmp/snow-ai.json`, then `cf ai run @cf/zai-org/glm-5.3-flash --body @/tmp/snow-ai.json`. For local remote AI, build and run `npx wrangler dev` without `--local` with Wrangler authentication; ordinary `npm run dev` uses `--local` to disable remote bindings. Builds/type generation need no API token. No deployment has been performed for this feature.

Cost: [Cloudflare's pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) provides 10,000 free Neurons/day, resetting at midnight UTC; Paid usage above that is billed separately from the $5 Workers subscription. The [GLM model](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) is $0.15/M input and $0.50/M output tokens. Observed smoke requests consumed roughly 51–171 Neurons each. The request cap and bounded output keep expected usage modest, but are not a dollar spending cap or a guarantee that shared account usage remains inside the free allowance.

## AI Daily Snow (2026-11-01)

A morning forecast post modeled on OpenSnow's Utah Daily Snow (five sample posts from Oct 10 – Nov 1 2026 were studied for structure and tone), written by the same models as the resort pick from the collected data. It is not a copy of any forecaster's work: no persona, name or sign-off, and it is labeled AI everywhere it appears.

What the samples share, and how each maps to the design:

- **Structure:** a 2–5 word title, a 2–3 sentence Summary, then "Update" or "Short Term Forecast", and "Extended Forecast" only when there is something to say. The schema enforces that order; roads and resort choice are left to the resort pick. The page renders these ids as "Today", "Next Few Days" and "Extended Forecast" — the owner asked on 2026-11-02 to drop the literal "Update" heading, which read as if the post had been revised.
- **Storm-cycle phase:** posts read differently before, during and after a storm and in quiet spells. The phase is computed in code (`phaseOf`: ≥4″ in the next 12 h, or ≥2″ next 12 h with ≥2″ reported in 24 h = storm; ≥4″ reported in 48 h/storm or ≥2″ in 24 h = post-storm; ≥3″ in 72 h = pre-storm; else quiet) and the prompt tells the model what each phase covers.
- **Forecast verification** ("we got exactly 5.9″"): each post stores its forecast totals and storm windows; later posts match storms by window and get code-computed forecast trends and forecast-versus-reported comparisons (see "Daily Snow continuity and AI pipeline cleanup", 2026-11-03).
- **Water, snow level, elevation and snow-to-liquid ratio:** passed as NWS blocks with derived SLR, six-hour snow with snow levels, and code-computed 24 h / 72 h / 7-day totals.
- **Figures introduced by the prose** ("…at the stakes:"): each paragraph may name one figure id from an enum of figures that exist. Captions are written in code. The model is text-only and is told it cannot see images.
- **Synoptic discussion and confidence:** the NWS Salt Lake City Area Forecast Discussion (`src/lib/sources/nwsafd.ts`) supplies the pattern, timing and confidence language. Key messages, discussion/short/long term and watches are kept; aviation, hydrology and fire weather are dropped. Without it, the extended outlook can only restate the 7-day grid.

Not available, and the prompt forbids inventing them: observed station liquid (the samples use Alta-Collins), model-comparison and 500 mb maps, ensemble statistics (plume charts are images only). A SNOTEL source would add observed liquid later.

Figures are frozen at posting time so archived posts show that morning's data: chart data is stored in the post, and image stills (plume panels from KV, snow-stake cams fetched live; stake stills older than 3 h are not offered) are copied to `dailysnow-fig:v1:<date>:<id>`. A still that can't be copied is dropped from its paragraph.

Validation (`validateDailySnow`): length clips; the opening section must be update or short-term and extended may only follow it; unknown or repeated figures are dropped (at most six); and every inch amount in the text must be within 1″ of some number in the model input, otherwise the attempt fails over to the fallback model. The number check catches invented totals, not arithmetic errors.

Scheduling (`src/lib/dailysnow/schedule.ts`): checked on every cron run in Denver local time, so 6 AM follows daylight-saving changes (Cloudflare crons are UTC only). One post per Denver date; retries every 10 minutes after a failure, at most 3 attempts a day, none after 10 AM. Each attempt reserves two model requests (cap 12/day, manual runs included). An attempt newer than its last finish blocks new ones for 6 minutes, longer than two 120 s model timeouts plus figure copies; as with the pick, KV is not an atomic lock. It runs in parallel with a due resort pick and shares its second snapshot write. Off-season (no resort in season, no snow reported or forecast in 7 days) it does not post.

**AI Gateway limit:** the `snow-report` gateway was created with a sliding limit of 40 requests per 86,400 s, sized for the resort pick. Daily Snow adds up to 12/day (normally 2), so raise the gateway limit to about 52, or a busy pick day can rate-limit the morning post.

Manual run: `POST /api/admin/collect?dailysnow=force` (admin bearer token). Prompt inspection: `npm run dailysnow:once -- --digest`; direct inference: `npm run -s dailysnow:once > /tmp/body.json`, then POST it to the Workers AI REST endpoint (see below; `cf ai run` times out), and `npm run dailysnow:once -- --validate /tmp/result.json` on the response's `result` object. Live inference (2026-11-01, 5:15 PM, production data, storm phase): GLM 5.3 Flash answered in 42 s (4,725 prompt + 2,554 output tokens, ~181 neurons) with "Snowing Now, Colder Tonight", 179 words, two figures; gpt-oss-120b answered in 24 s (~259 neurons) with "Storm Underway", 228 words. Both passed validation. Both left out the Extended section and ran shorter than the 250–450-word target; that may need prompt tuning once real 6 AM posts exist. gpt-oss writes "7 in" rather than 7″, so the amount check treats a bare "in" as inches. `cf ai run` gives up after 30 s, shorter than a Daily Snow generation; call the REST endpoint (`POST /accounts/<id>/ai/run/<model>`) with a longer timeout instead.

Expected cost: one or two model requests a day, with up to 8,000 output tokens (reasoning included) on a ~4,000-token prompt.

## Structured Utah Snow Ensemble guidance (2026-11-01)

This supersedes the initial Daily Snow limitation above that ensemble statistics were unavailable. The charts remain raster images and are never sent to a vision model. The separate optional `ensemble` collector reads the [published CLN text tables](https://weather.utah.edu/text/ensgefsdslccforecast.html), linked by the [CLN plume page](https://weather.utah.edu/index.php?t=ensgefsds&d=PL&r=CLN). Only this endpoint/station was verified; no BCC endpoint is inferred.

The captured live run is **1200 UTC 01 Nov 2026, 82 members**, nearest grid point to Alta-Collins (40.579 N, 111.654 W, 9,416 ft). Six tables supply cumulative liquid/snow, six-hour liquid/snow, SLR and wet-bulb 0.5 height. The parser requires their exact headings/units/location, seven ordered percentile rows (Min/P10/P25/P50/P75/P90/Max), 40 columns, finite nonnegative normalized values and exact Denver labels matching initialization + 6-hour UTC leads. UTC lead mapping avoids guessing offsets across DST. The captured HTML fixture retains every original heading, label and value, removing styles/attributes and compacting whitespace only.

The live feed contains three **−0.01″ six-hour liquid** values. Only this exact nonphysical trace is normalized to zero, with the count stored and disclosed in the digest; other negatives are rejected. The upstream cause is unverified. Some cumulative percentiles decrease slightly in the published run, so cumulative monotonicity is not assumed. No cumulative arithmetic reaches the models.

Both AI digests share P10/P50/P90 six-hour snow, liquid and independently supplied SLR through day 10, with explicit UTC boundaries and Denver labels. Only periods whose **start is at or after now** are included: partly elapsed periods are withheld rather than prorated. Marginal percentiles cannot be summed into storm/night totals, subtracted from cumulative curves for interval ranges, or divided to derive SLR. Guidance describes a forecast at one LCC grid point, not measured snowfall, BCC amounts, a canyon comparison, or a measured snow level. The wet-bulb height and cumulative tables are retained for provenance but withheld from AI facts. NWS still determines phase/mode and the existing computed forecast totals; ensemble guidance supplies additional forecast spread/context.

Collection is independent of plume images, every 30 minutes with next-cron retries after failure. Existing collection persistence preserves the last good payload. A failed latest attempt, run older than 18 hours, invalid/future freshness or last success older than 47 minutes withholds all numerical periods from usable model facts; the digest discloses unavailability, last run and last success. Old snapshots with no ensemble record continue to work. Recommendation fingerprints include numerical run/availability changes through the existing material-change cadence, quiet hours and request caps. Primary/fallback, Daily Snow scheduling, storage schema version and number of KV writes are unchanged.

Existing files touched and why:

- `src/lib/types.ts`, `src/lib/sources/index.ts`: additive source contract/registration; snapshots already have optional source entries.
- `src/lib/recommend/digest.ts`, `src/lib/dailysnow/digest.ts`: shared scoped/fresh numerical facts; existing digest fixtures remain compatible.
- `src/lib/recommend/schedule.ts`: run/availability fingerprint under existing limits.
- `src/lib/recommend/llm.ts`, `src/lib/dailysnow/llm.ts`: distinguish ensemble/NWS/observations and exact periods, prohibit percentile arithmetic and image-derived values; Daily Snow confidence may use structured spread. Also forbid invented stake readings/future base depths and comparing mismatched NWS/ensemble windows. Plume figures may have a different initialization and cannot be called six-hour numerical plots.
- `scripts/recommend-once.ts`, `scripts/dailysnow-once.ts`: opt-in `--live-ensemble` read-only tuning; shared helper fetches directly before digest construction.
- `test/fixtureFetch.ts`, `test/collect.test.ts`: register the real fixture and use a clock after the newest capture for all-adapter collection checks.
- `README.md`, this file: source, operations, semantics, validation and limitations.

New modules contain parsing/collection (`src/lib/sources/ensemble.ts`), the AI boundary (`src/lib/ensemble.ts`), the tuning helper, captured fixture and 20 dedicated tests. No routes, styles or image collection were changed.

Validation: **168 tests in 14 files pass**, including parser drift/negative/nonfinite/order/shape failures, spring/fall DST lead mapping, independent chart success during numerical failure, last-good preservation, missing legacy/freshness cases, both model inputs and capped scheduling. `npm run typecheck` and `git diff --check` pass. Live parsing of the actual upstream response confirmed all six tables, 40 periods, 82 members and three trace corrections. No build/browser check was needed for this server-data/prompt change.

Real Workers AI tuning used production report facts plus direct live numerical collection, with no production KV writes. Resort-pick evaluations explicitly assumed eligibility outside the season; both models still chose no pick from the closed-lift reports. Two rounds of both primary/fallback features plus a final Daily Snow pair were used (10 requests total). Initial fallback prose invented stake readings and mislabeled an ensemble range as NWS; prompt revisions forbid these, require exact local windows/source attribution, and distinguish accumulated image figures. All evaluated responses passed the existing schema/amount validator, demonstrating its limitation: number presence does **not** prove attribution, time-window arithmetic, or prose correctness. A final manual assessment is recorded below. The primary/fallback remain GLM 5.3 Flash / gpt-oss-120b. No deployment, forced production generation or production KV write was performed.

Final tuning assessment: GLM returned in 22 s (8,370 input / 1,212 output tokens), cited the University of Utah range **2–5.7″, P50 3.2″, 11 PM–5 AM** at Alta-Collins, and passed application validation. GPT OSS returned in 14 s (8,391 / 1,809 tokens) and passed validation, but still called the guidance “our own” and used loose timing/density language; its additional invalid `short-term` section after `update` was discarded by the existing section validator. Earlier fallback attempts also invented image readings and crossed source/period boundaries despite all amounts appearing somewhere in the input. Prompt tuning reduces these errors but does not guarantee factual prose. In particular, the validator cannot certify ensemble attribution/period semantics; monitoring real posts remains necessary. The final no-discussion prompt also permits a brief numerical ensemble outlook without inventing synoptic mechanisms. No browser/server was started because the change has no UI/layout effects; real model requests exercised the actual digest/prompt path.

## Snowfall AI visibility (2026-11-01)

The Daily Snow teaser now remains visible on the regional snowfall slide in slideshow mode, using the same summary/link as browse mode. The full Daily Snow article remains excluded from slide rotation. The recommendation card renders only when a resort is selected: a missing recommendation or an explicit `pick: null` leaves no card or waiting placeholder. Existing picks still show their outdated/failing warnings.

Existing files touched: `src/app/globals.css` removes the slideshow-only teaser hiding rule; `src/components/RecommendationCard.tsx` gates the card on a pick; `test/dailysnow-ui.test.tsx` covers absent/no-pick recommendations and preservation of an old pick; `README.md` documents visibility; this file records the decision and validation. No collection, model, API or storage behavior changes.

Validation: 25 tests across Daily Snow UI and navigation/playback pass; `npm run typecheck`, `npm run build` and `git diff --check` pass. Local workerd on port 8791 serves a read-only copy of the live report with all 12 source payloads and the real “Storm On, Better Snow Tonight” teaser; no production writes or live model calls. Browser/responsive visual checks were not run. The existing regional slide permits vertical scrolling when content exceeds the viewport.

## Regional snowfall resort links (2026-11-01)

Each resort name in the regional snowfall table now links to its existing resort page (`/alta`, `/snowbird`, `/solitude`, `/brighton`), including when its report is missing or stale. Native anchors support keyboard activation, opening in another tab and leaving the slideshow for the selected resort page. Scoped underlines, hover color and focus outlines make the links discoverable without changing table dimensions or measurement rendering.

Existing files touched: `src/components/slides/RegionalSlide.tsx` adds links through the existing `sectionHref` helper; `src/app/globals.css` styles only those links; this file records the decision and validation. No routes, storage or setup change.

Validation: 25 tests across playback and Daily Snow UI pass; `npm run typecheck`, `npm run build` and `git diff --check` pass. Local workerd at http://localhost:8794 serves this branch with successfully collected real reports for all four resorts (all current). Browser visual checks at phone, laptop and TV widths were not run; links preserve existing name sizing and table layout. No production writes.

## Inch-mark alignment (2026-11-01)

Snowfall and base-depth metrics now align the small inch mark with the visible top of the number in both browse and TV presentations. The previous 60% unit size shared the number's baseline, leaving the mark near the middle. The inch-only modifier raises the mark by the difference in cap heights (`2cap / 3` at 60% size). Aligning to the line box's top was visibly too high; the final cap-height offset follows the glyphs instead. Full-size inch marks in prose, weather tables and figures already share the number's cap height.

Existing files touched in this follow-up: `src/components/ui.tsx` adds the inch-only unit modifier; `src/app/globals.css` supplies its cap-height offset; this file records validation. Other units and missing/unavailable values retain their rendering. No setup, routes, storage or README changes are needed.

Validation: 33 playback, resort-report UI and Daily Snow UI tests pass; typecheck, final static build and git diff --check pass. Browser checks with real resort data cover the regional snowfall page and all four resort pages at 390×844 and 1366×768 in browse mode and 1920×1080 in paused TV mode (15 page/viewport combinations). Inch marks align across large/small totals and zeros; canvas/range checks put visible glyph tops within 1.8 CSS pixels across these fonts and sizes. Other units remain baseline-aligned; none of these pages overflows horizontally. The regional table retains its existing internal horizontal scroll on phones. Phone/laptop/TV screenshots were inspected during tuning. Local data includes reported zeros and unavailable measurements; no production writes. No persistent test was added for this small presentation change: jsdom cannot verify glyph positioning.

## Whole-row resort navigation (2026-11-01)

The regional snowfall links now cover each entire resort row, including measurements, badges, padding and the report-time cell. The native anchor is stretched within its isolated row so zeros and translucent unit text cannot intercept clicks. Each resort remains one keyboard stop, with native Enter/new-tab behavior and preserved table semantics. Names return to clean, un-underlined text; hovering highlights the row and name, while keyboard focus adds a row outline. Hover styling is limited to hover-capable pointers.

This follow-up changes only `src/app/globals.css` and this note. Browser validation with real data confirms all four rows' hit targets at five positions each at laptop/TV widths (1366×768 and 1920×1080), plus phone targets at 390×844 before and after horizontal table scrolling. Clicking Alta's report-time cell navigates to `/alta`; Tab focuses the single Alta link with a visible row outline, and Enter navigates correctly. Hover screenshot reviewed. No page overflow; phone table scrolling remains available. 25 playback/resort UI tests, typecheck, final build and git diff --check pass. The inch-mark fix is preserved. No production writes.

## Daily Snow plume axes (2026-11-02)

Daily Snow previously displayed the raw cropped plume PNG. That crop deliberately omits the upstream UTC labels because `/plumes` draws its own Mountain Time axis and white margin. Displaying it directly left Daily Snow without a time axis or space around the plot.

Both pages now use `src/components/PlumePanelSvg.tsx`, extracted from the existing plumes renderer without changing its geometry. Daily Snow freezes the plot bounds, model initialization and forecast horizon with the image metadata. Its marker says “posted” at the post's generation time; `/plumes` retains its moving “now” marker. Daily Snow uses the natural aspect ratio rather than the plumes page's viewport sizing. No source adapter, crop algorithm, AI prompt, schedule or inference behavior changes.

Compatibility: `axis` is optional. Existing posts without it show the original still with white padding but cannot draw the missing axis. Deploying this fix does not backfill production posts; doing that requires a separately authorized write using verified metadata for the original run. The figure API remains a raw PNG, with the axis composed by the frontend. Tomorrow's generated posts automatically include the metadata, including in their archive entry.

Existing files touched:
- `src/components/slides/PlumeSlide.tsx`: delegates panel drawing to the shared component while retaining its wrapper, captions and current-time marker.
- `src/components/dailysnow/figures.tsx`: uses the shared drawing when frozen axis metadata exists, with a legacy image fallback.
- `src/components/dailysnow/DailySnow.tsx`: supplies the post's generation time to its figures.
- `src/lib/dailysnow/digest.ts`: captures the original plume run's axis metadata with each figure candidate.
- `src/lib/types.ts`: adds the optional image-axis metadata.
- `src/app/globals.css`: scopes natural sizing and legacy crop padding to Daily Snow figures.
- `test/dailysnow-ui.test.tsx`: covers padding geometry, Mountain Time day labels, the posting marker and legacy images; existing tests cover missing posts and ordinary stake images.
- `test/dailysnow.test.ts`: verifies axis metadata survives the actual posting/copy path.
- `README.md`: documents the additional stored metadata and raw-image/API distinction.
- This file: records the decision, validation and limitations.

Validation: all 183 tests across 15 files, `npm run typecheck`, `npm run build` and `git diff --check` pass. Local workerd remains at http://localhost:8791 on `fix/dailysnow-plume-figure-axis`, seeded with the real “Winding Down, Then a Break” GLM post and its original CLN 2026110200 image. Added axis metadata was matched to that exact source run. The local current and archived post APIs return that metadata; the frozen PNG returns 200 image/png; `/daily-snow` and `/plumes` return 200. No production writes or new model calls were made for this fix. Phone/laptop/TV visual checks were not run: T3 preview failed because its required system libraries are absent, and sudo installation is blocked by the container's no-new-privileges setting. Shared plumes drawing is mechanically preserved, but responsive visual review remains outstanding.

## Daily Snow section preservation and required snow plume (2026-11-02)

Investigation of the 16:54 UTC force repost used the exact AI Gateway request and response (`01a19d2f-2896-7073-83ab-e56cceffe530`). GLM received all intended inputs: four resort reports, both current NWS forecasts, the 5:13 AM NWS discussion product (with its original section issuance times), current 00Z numerical CLN guidance with 37 future six-hour periods and 82 members, previous-post context, yesterday's forecast history, four plume figure candidates and two stake candidates. Brighton's report was still from 11:59 PM the previous night and was correctly identified as old in the prose. Sources skipped by the collection cadence were reused from the snapshot, not removed from the prompt.

GLM returned five paragraphs and four figure references. Its second section was labeled `short-term` after `update`, violating the requested order. The validator silently discarded that entire section: two paragraphs about the break and next storm, the LCC NWS snowfall chart and the CLN snow plume. This was content loss in validation, not model omission or an image-copy failure. Replaying the exact response through the new validator preserves all five paragraphs and four figures.

The validator now folds an alternate opening label into the opening section before any extended outlook. It retains up to six paragraphs from each incoming section (up to twelve after folding); duplicate labels, misplaced extended sections, unknown/repeated figures and ungrounded amounts retain their existing checks. Slicing each input section before allocating figure slots also prevents discarded excess paragraphs from consuming those slots. The prompt explicitly requests only one opening and asks for an accumulated-snow plume.

Publication independently ensures a snow plume exists whenever one of the existing figure candidates has an image that can be copied. An already selected and successfully copied snow plume keeps its model-chosen position. Otherwise code tries CLN first, then another station, and stores the successful plume for rendering after the prose with its existing source caption; no extra model prose or request is generated. If six optional figures filled the budget, the last optional figure reference is cleared to reserve a slot. Images remain frozen with their original axis metadata. Missing candidate images do not prevent publication, and SLR panels do not satisfy the accumulated-snow requirement. Candidate freshness/availability semantics are unchanged. Existing production/archive posts are not rewritten by deploying this change.

Existing files touched: `src/lib/dailysnow/llm.ts` preserves the alternate opening and clarifies the prompt; `src/lib/dailysnow/index.ts` guarantees copying an available snow plume within the six-figure budget; `src/components/dailysnow/DailySnow.tsx` renders a code-added plume after the prose if no paragraph references it; both Daily Snow test files cover recovered content, required/fallback/missing plumes, the budget and rendering; `README.md` documents the behavior; this file records the investigation and validation. New `src/lib/dailysnow/plume.ts` shares the accumulated-snow figure predicate between publication and rendering. No adapters, schedules, shared types, routes or storage keys change.

Validation: exact saved gateway-response replay preserves five paragraphs and all four figures. A fresh direct REST GLM call against the exact original digest with the revised prompt completed in 41.5 s (8,423 input / 1,968 output tokens), passed application validation, and returned `update` + `extended` with a CLN snow plume. Known prose limitation: it still attached that plume to a paragraph quoting numerical six-hour guidance despite the instruction to introduce the image neutrally; the validator cannot certify source/period semantics. Required-image publication is enforced independently of prompt compliance. No fallback-model live call was made for this change.

Local review: http://localhost:8791/daily-snow on `fix/dailysnow-required-plume`, using the original real gateway response replayed through the actual posting path and seeded into local snapshot/archive KV with its frozen plume. All five paragraphs and four figures are present. This change makes no production KV writes and does not force another production post. Browser/responsive visual checks were not run; the prior preview attempt was blocked by absent system libraries. Final test/typecheck/build totals are recorded below.

Final validation: 189 tests across 15 files pass, along with `npm run typecheck`, `npm run build` and `git diff --check`. The local archived-post API returns the recovered five paragraphs/four figures and the frozen plume endpoint returns 200 image/png.

## Sentence-boundary paragraph clipping (2026-11-02)

The 17:45 UTC force repost produced a paragraph ending "En…": the model wrote more than the 600-character paragraph budget and `validateDailySnow` clipped at an arbitrary character index, cutting "Ensemble" mid-word. The truncation was in stored post data, not the page.

Paragraph clipping now ends at the last complete sentence that keeps at least 60% of the budget (falling back to the last word boundary with an ellipsis when no sentence fits), so a paragraph that overruns loses its final partial sentence instead of being mangled. The shared helper is `src/lib/clip.ts` (`clipText`); the Daily Snow validator uses it for title, summary and paragraphs, and the Daily Snow share card uses it for title and summary. The paragraph budget also rises from 600 to 800 characters, and the prompt now states the budget and asks the model to keep each idea in a sentence that can stand on its own. `src/lib/recommend/llm.ts` keeps its own simple clip; the resort pick was not part of this change.

Existing files touched: `src/lib/dailysnow/llm.ts` (clip call sites, budget, prompt line), `src/lib/og/daily-snow-image.tsx` (share-card truncation), plus the new `src/lib/clip.ts` and tests in `test/clip.test.ts` and `test/dailysnow.test.ts`. No adapters, schedules, storage keys, routes or rendering change.

Validation: 195 tests across 16 files pass, including new clip unit tests and a validator integration test (long paragraph clipped at the sentence boundary with its figure preserved; share-card rendering with long copy unchanged). `npm run typecheck` passes. A live production regeneration after the deploy produced a five-paragraph post whose longest paragraph (533 characters) ends at a complete sentence with the ensemble-confidence caveat intact — no mid-word truncation. The first force attempt died with a client-side TLS read timeout before the worker started a run (the stored post was unchanged); a retry succeeded. `force` bypasses the in-flight window by design (it only respects the daily call cap), so the retry was safe.

Final validation: 195 tests across 16 files pass, along with `npm run typecheck` and `git diff --check`. `npm run build` was not run: no routing, styling or build behavior changes.

## 2026-11-02 — Mobile-first redesign and TV removal (PR #25)

The dashboard was reworked for phones and desktop browsers and the TV/slideshow mode was removed entirely. The design was tuned live against a throwaway preview shell over eleven owner review rounds; this note records the final result. The interim preview-round entries were consolidated into this section.

**Final design.** Light-first editorial shell: a masthead (brand with an accent "Snow Report", light/dark appearance control, section nav with a Resorts dropdown) over one routed page, no footer. The appearance choice lives on `<html data-theme>`, applied by an inline script before first paint (no flash), stored under `cottonwoods-snow-report.appearance`; with no choice the system preference decides, and the palette is a full dark theme rather than an inversion. One narrow breakpoint (900px) covers everything below desktop. Long-form pages (resort reports, Daily Snow) are page content: one reading width, no card borders, section rules instead of boxes; only summary panels (teaser, next storm, resort snow tiles, code-drawn charts) carry a fill.

**Snowfall page.** The Daily Snow teaser is a pale blue panel reaching 16px into the page gutters (edge-to-edge, zero radius on phones) with matching inner padding so its text keeps the page's aligned edge; its time sits right on desktop and wraps to its own row on phones. The resort-recommendation card is gone — the AI pick is part of the table: an "AI pick" chip on the resort's row, a reasoning row directly beneath, and an accent line 12px left of the text spanning both. The table box itself reaches 16px into the page gutters (first/last cells pad the text back to the page edge), so row tints, hover highlights and the 1px dividers all share one width with no painted extensions — dividers measure a uniform 1px across the full width. On phones the table becomes full-width stacked resort blocks (name plus a three-column metric grid, header row hidden), so nothing scrolls horizontally. Freshness and AI chips are boxy with a 4px radius and carry semantic color (green current, amber aging, red stale, blue AI); measured values are snow-blue, zeros muted gray.

**Consistency pass (handoff review).** A review of the whole branch found the styling had grown by accretion: about twenty ad hoc font sizes, TV-era `em` sizes on Weather and Roads, neutralized `.slide`/`.panel`/`.pill` classes, duplicated page-title rules and a snow-bar chart copied between Weather and Daily Snow with `min-width: 720px`, which overflowed Daily Snow by 366px on a 390px phone once a real post with figures was loaded (local KV had none, so earlier sweeps missed it). The pass:
- Defines one type scale and spacing set as CSS tokens in `globals.css` and rewrites both stylesheets on it. The Daily Snow teaser title now matches resort names (title size); page subtitles, section headings, captions and labels are the same size on every page.
- Renames `src/components/slides/` to `sections/` and the `*Slide` components to `*Page` (`RoadsPage` for the `traffic` section), with `.page`/`.page__header`/`.page__sub` replacing the slide classes.
- Adds `src/components/charts.tsx`: snow-bar and snow-level charts drawn at the container’s measured width (ResizeObserver), so one SVG unit is one CSS pixel and 12px labels stay 12px on any screen; no horizontal scrolling. Weather and Daily Snow both use it.
- Daily Snow: an article header with 16px between the meta row and the title, a lighter lead paragraph, charts on the pale panel and images (plumes, stake cams) on their own white ground with no panel. Legacy plume crops keep their white margin.
- Roads: freshness chips leave the header (one sat mid-sentence between “Roads” and “checked”); the page ends with a source line per feed. Notices share the resort-notice pattern, travel times don’t wrap “16 min”, parking is a list and no longer prints “Alta Alta parking”.
- Resort pages: degree marks raised like inch marks; tight tracking only at display sizes, so “33.2” no longer runs together at 24px; lifts and named terrain share one status-list pattern; observation stations sit two across on phones; the three snow tiles sit side by side on phones when none carries a source note.
- Removes dead CSS and the unused `MetricValue` `showLabel` prop.

**Roads, resort pages and snowfall windows (review round).** The owner found Roads hollow yet cluttered and the resort pages inconsistent from one resort to the next. Changes:
- Snowfall shows in fixed slots and shared labels on the Snowfall table and every resort page (see [Design](DESIGN.md), “Snowfall windows”). Before, each resort page dropped the windows its source lacked, so tiles shifted between resorts, and every value carried the source’s label (“Snow 24 Hrs.”, “24 Hour”, “Last 24 hours”). Measurement windows are still the resort’s own; we don’t sum history into windows a resort doesn’t publish (Alta’s 48 h) or invent a storm total, since both would be our numbers presented as theirs. “n/a” became “—”.
- Resort headers say “Updated” and the time for every resort; the source’s exact definition (for example Snowbird’s “Snow report … (published)”) stays in the source line. Alerts moved below the jump links and use the shared compact notice list.
- Roads mirrors Weather: two canyon columns, each with the camera, a road-status panel, and travel times showing the main routes (every downhill segment, and uphill from the first origin to each resort) with “Show all N segments”. The not-live warning is one line per canyon and the layer-rewrite detail is one page note; stale values are muted rather than struck through. Resort road notices older than 24 hours are dropped (Alta’s 11-day-old “Road Status: Open” repeated Snowbird’s current one). Parking is grouped by resort, one column on phones.

Not changed: the resort-pick prompt still says “Write for a TV dashboard” (`src/lib/recommend/llm.ts`); changing it needs a live model check, so it is left for a follow-up.

**Removed.** `Slideshow.tsx`, `NavBar.tsx`, the TV resort slide (`ResortSlide.tsx`), the standalone `RecommendationCard.tsx`, kiosk mode (`?kiosk=1`), per-slide-duration preferences, `slideshowStep`/the `slideshow` flag in sections, and the design-preview shell, fixture and scripts. Legacy `?slide=<id>` links still redirect to their section page. `test/playback.test.tsx` became `test/app-shell.test.tsx`; recommendation and resort-report tests follow the integrated row and browse-only rendering.

**Gotchas worth remembering.** A pseudo-element on a `<tr>` is wrapped by Chromium in an anonymous table cell that participates in column layout (it shifted the pick's cell 125px); hang such pseudos on the cells instead, or move to block layout where the row can carry them. Box-shadows on cells of a collapsed, horizontally scrollable `display: block` table can be missing from the first paint until an unrelated repaint. Painting highlight/divider extensions into reserved gutters with pseudo-element strips produced off-by-one double borders; the robust fix was structural — bleed the table box into the page gutters so backgrounds and cell borders share one width by construction. And a missing module (`./resort-columns`) passed builds and typechecks on stale incremental caches until an edit forced a recheck; the inline definitions were restored.

**Validation.** 189 tests across 16 files (new: fixed snowfall slots per resort, qualifiers and once-only source notes, snowfall table labels, travel-route toggle), `next typegen && tsc --noEmit`, `npm run build` and `npm run smoke` pass. Browser checks on the real dev server with the production report served read-only through request interception (real Daily Snow post with all four figure kinds, real resort, road and plume data; an AI pick fixture for the table row): all 9 pages at 390px and 1366px, light and dark, zero horizontal overflow and zero page errors. Not run: production deploy and real-device testing.

## 2026-11-02 — Daily Snow history rail (PR: t3/daily-snow-history-sidebar)

The Daily Snow page now shows recent posts in a left rail beside the article on wide screens (≥901px), headed "Recent posts" (not "Past N days": the rail counts posts, and a day can have none): today's post pinned at the top with the phase label, then up to two archived posts with their date and two-line title. The entry whose post is on screen gets the accent bar and the panel fill. The bar is a real 3px left border on every entry (transparent until active) with square left corners, so it spans the full height of the fill by construction; an inset box-shadow followed the 8px radius and curved, and an inset pseudo-element strip fell short of the fill, so the highlight follows the viewed post instead of staying on today's. Clicking an entry swaps the post in place (`?date=`). Phones render no rail: they navigate with the archive links below the post, which now stay on every view, desktop included. The rail is hidden while the live post is the only one there is.

Design was prototyped as three variants (left rail, date-chip strip, expandable panel) on the real `/daily-snow` route; the owner picked the rail with 3 posts, no mobile affordance, and a straight full-height accent bar. The full prototype, switcher and styles are preserved on the throwaway branch `prototype/dailysnow-history` (commit a9264dc); this file records the verdict.

Existing files touched: `src/components/dailysnow/DailySnow.tsx` (page content moves inside a `dailysnow-layout` flex wrapper; shared labels move out), `src/app/globals.css` (`.dailysnow-layout` and `.dailysnow__history*` styles in the Daily Snow section), `test/dailysnow-ui.test.tsx` (archive-nav queries scoped to the nav, which now shares the page with rail entries; new tests for cap, de-dup, empty history and rail highlight). New files: `src/components/dailysnow/HistoryRail.tsx` and `src/components/dailysnow/labels.ts` (`PHASE_LABEL`, `postDate` — shared by the page and the rail so neither imports the other).

Behavior notes: the archive API includes the live post as history's first entry, so the rail filters it out before adding its own "Today" entry. Rail entries and the archive nav share one `pick` handler, so selection stays consistent however you navigate; `data-active` marks the entry whose post is on screen even when that post is older than the rail's window (then no entry is highlighted). The rail shows no per-post phase for archived posts — the API exposes `{ date, title }` only; adding phase/forecast per entry would be an API change.

Known limitation: on narrow desktops (901–1100px) the article shrinks below its 720px reading width to make room for the rail; it never overflows.

**Permanent archive, linked posts (2026-11-03).** Posts (`dailysnow:v1:<date>`) and their stills (`dailysnow-fig:v1:<date>:<figure>`) are now written without a KV expiry, so KV keeps every post as the business archive, and `/api/daily-snow?date=` serves any of them, so old links keep working. Before, posts expired after 32 days while the snapshot indexed up to 30 posts, so a run of failed days could leave index entries pointing at expired posts ("Post not available"). With no expiry an index entry can no longer outlive its post.

The owner wants the prev/next links under a post to walk back through every post ever made, which a capped list can't do. So each post carries its neighbors: `older` (date and title) is set from the snapshot index when the post is written, and `newer` is added to the previous post in KV right after (one extra read and write per post). Linking forward is best-effort: a failure is logged and costs only that one `newer` link, never the new post. `ArchiveNav` prefers these links and falls back to the `archive` list for posts written before them. The page's `pick` maps the live post's date to "no `?date=`", so a `newer` link to today's post returns to the live view. The archive list is now only the recent-posts window: `DAILY_SNOW_ARCHIVE_POSTS = 10` on both `/api/report` and `/api/daily-snow` (down from 30), and the rail takes its 3 from it. It lives in `src/lib/report.ts`, beside the API shaping, because `dailysnow/digest.ts` already imports `report.ts`. The prompt still uses the 5 most recent posts, and it copies named fields from the previous post, so the links never reach the model. Measured sizes in production: a post is about 9 KB and a plume still about 105 KB.

Existing posts: KV sets the expiry on each write, so posts written before this change keep their 32-day expiry (2 posts and 1 still in production on 2026-11-03, expiring in early December), and the owner chose to let them expire. One exception: the first post after deploy links the latest existing post forward, and that rewrite has no expiry, so that one post is kept. The chain then ends there; the posts before it are reachable through the archive list until they leave the 10-post window or expire.

Existing files touched for this: `src/lib/dailysnow/index.ts` (no expiry on writes, neighbor links, index cap), `src/lib/report.ts` (the archive cap), `src/lib/types.ts` (`DailySnowLink`, optional `older`/`newer` on posts, doc comments), `src/components/dailysnow/DailySnow.tsx` (`ArchiveNav` follows the links; `pick` normalizes the live date), `README.md` (storage, KV operations), and tests in `test/worker.test.ts`, `test/dailysnow.test.ts` and `test/dailysnow-ui.test.tsx`.

## 2026-11-03 — Readable six-hour snowfall charts

Weather and Daily Snow share one six-hour bar figure with visible inch amounts and period start times. Equal-width Mountain Time day groups include blank slots for unavailable periods, including partial first/last days, so Monday retains the same width as every other day. The figure uses a 44px minimum per slot and scrolls horizontally inside a keyboard-focusable region when needed. No daily aggregation or expandable second chart. Daily Snow retains its frozen forecast.

The grouping helper enumerates UTC six-hour slots and assigns each to its actual Denver start date, preserving amounts across both DST transitions. Missing slots never become zeros; real zero amounts display 0.0″. Screen-reader labels include the date, six-hour duration and MST/MDT start time. Source periods can cross local midnight and do not retain hourly coverage; this change neither splits amounts nor claims completeness within a period. The repository no longer has a TV slideshow.

Existing files touched: src/components/charts.tsx removes the obsolete snow renderer (snow levels unchanged); src/components/sections/WeatherPage.tsx and src/components/dailysnow/figures.tsx use the shared figure; README.md documents presentation and scrolling; this notes file records decisions. New chart, scoped CSS, grouping helper, and tests live separately. No source, storage, cron, or AI changes.

Validation: 18 snowfall/Daily Snow UI tests pass, including missing periods, zero amounts, preserved individual values, and both DST transitions. Typecheck, production build and diff whitespace check pass. Browser checks at 320/390/1366px on Weather and Daily Snow confirm equal day widths, fitting amount labels and no page overflow; scrolled Daily Snow to inspect the snow-bearing periods visually. Preview uses real public NWS and saved Daily Snow data copied into local KV. Other sources were not seeded, so the missing-feed banner is expected. No production writes, real-device Safari checks, or model runs.

## 2026-11-03 — Remove leftover slideshow references

PR #25 removed the TV slideshow, but `AGENTS.md`, the brief, the current-state list at the top of these notes, the README and four code comments still described it, including the no-longer-existent `slideshow: false` flag and `test/playback.test.tsx`. Those now describe only the phone and desktop pages. The dated entries above are left as written because they record what was true when each change landed.

Left in place on purpose: the legacy `?slide=<id>` redirect in `AppShell` (it is live behavior for old bookmarks, documented in the README and covered by `test/app-shell.test.tsx`), and the resort-pick prompt's "Write for a TV dashboard" line in `src/lib/recommend/llm.ts`, which needs a live model check before it changes.

## 2026-11-03 — Headline snowfall summary on phones

The owner disliked the phone layout from PR #25, which split each resort's five values across a three-column grid of two rows. Two replacements were tried and rejected: a horizontally scrolling table, and the five values on one line under short column headers. Below 900px each resort is now a block with three lines:

- the name and chips, with the report time on the right;
- the 24 h total as a 40px headline labeled "24 h";
- the other windows as one line of text, such as "12 h 2″ · 48 h — · Storm 15″ · Base 20″".

Each item in that line is named by the window the figure actually covers, so Alta's overnight figure reads "12 h". Solitude's note ("Since lifts closed") follows its value. When the line wraps, the separator that would start the new line is clipped: every item leads with a fixed-width "·", and the line is shifted left by one separator inside a clipped box. Phones drop the "checked …" age but keep "latest check failed". The AI pick's reasoning row and accent line are unchanged.

The headline window is `PHONE_LEAD` in `RegionalPage.tsx`. 24 h is the one window every resort reports with the same name, so the headline doesn't change meaning from one resort to the next.

On phones the summary is a visual copy in an extra `aria-hidden` cell (`.snow-phone`, hidden on desktop). The original value cells stay in the DOM, visually hidden, so screen readers still read the table once. The phone-only window label under every value (`.cell-label__window`) is removed because the summary names its own windows. Desktop rendering is unchanged.

Files touched: `src/components/sections/RegionalPage.tsx` (the `PhoneSummary` cell; `cell()` also returns the window used; window label removed), `src/app/globals.css` (phone table rules), `test/resort-report-ui.test.tsx` (header labels and a phone summary test) and `README.md`.

Validation: 204 tests across 17 files, `npm run typecheck` and `npm run build` pass. Browser checks ran on the local dev server with freshly collected real resort data and a stubbed AI pick (local AI is off). At 320, 390 and 900px the page has no horizontal overflow, and wrapped lines start without a stray separator. At 320px the chips wrap under the resort name. At 1366px the table matches main. Not run: real-device Safari and dark mode (colors are unchanged).

## 2026-11-03 — Underline section tabs

The owner asked for a cleaner, mobile-first nav: the current section marked by a blue underline instead of a filled, rounded rectangle. The decisions agreed before building:

- **Active state.** The current tab has accent-blue text over a 2px accent bar that sits on the nav's 1px divider. Inactive tabs are muted. Hover only darkens the text to `--text` and draws no bar, so hover never looks like the current tab.
- **One row everywhere.** The 3×2 phone grid is gone. Tabs keep their natural width in one row that scrolls sideways on phones (hidden scrollbar, edge fades when more tabs are off screen). On load and after navigating, the current tab is scrolled into view. On desktop everything fits and nothing scrolls.
- **Not sticky.** The tab row was first pinned to the top of the viewport, but on desktop it collided with the Daily Snow history rail, which is itself sticky at `top: 20px`. The pages are short enough that a pinned nav isn't worth it, so the nav now scrolls with the page. The divider is a full-width inset shadow.
- **Sliding bar.** `SectionNav` keeps one `.section-nav__bar` element and moves it to the current tab with a 220ms transform/width transition. The transition turns on only after the first placement, so the bar doesn't fly in on load, and `prefers-reduced-motion` turns it off. Before the bar measures (server HTML, or without JS), the current tab draws its own `::after` bar. A `ResizeObserver` re-measures when fonts load or the viewport changes.
- **Resorts.** The four resorts still share one tab, labeled with the current resort on a resort page and underlined there like any other tab. A scrolling row clips absolutely positioned children, so the menu is `position: fixed`, placed under the tab from its bounding rect when it opens and on scroll or resize. The edge fades are overlays on the `<nav>`, not a `mask-image` on the row, because a mask would also hide the fixed menu. For the same reason, nothing above the menu may set `transform`, `filter` or `backdrop-filter`: each of those makes the fixed menu position against that element instead of the viewport. In the menu, the current resort is accent text with a 2px left rule.
- **Tighter masthead.** The tabs are already 48–52px tall, which leaves room above their labels, so the masthead's bottom padding drops from 20px to 4px on desktop and from 14px to 0 on phones. That brings the brand-to-tab gap on desktop from about 68px to about 52px.
- **Appearance control.** The light/dark buttons lose their filled background. The active icon is accent blue and the others are muted, so nothing pill-shaped remains in the header.

Files touched: new `src/components/SectionNav.tsx` (tabs, bar, resorts menu, outside-click/Escape handling moved from the shell), `src/components/AppShell.tsx` (renders `SectionNav` after the masthead `<header>`; nav markup and menu effects removed), `src/app/globals.css` (masthead padding and appearance control, `.section-nav*` rules replacing `.editorial-nav nav*`, the phone grid removed, reduced motion), `test/app-shell.test.tsx` (new resorts selector, current-tab marker, tab bar outside the header) and `README.md`.

Validation: 204 tests across 17 files, `npm run typecheck` and `npm run build` pass. Browser checks ran on the local dev server (Chromium, freshly collected real data). At 1280px the tabs, brand and page title share the same left edge (x = 82), and a client-side click moved the bar to the new tab with the 220ms transition. At 390px the row scrolls with edge fades, the current tab (Roads) is scrolled into view on load, the resorts menu opens unclipped and inside the viewport, and dark mode renders correctly. Not run: real-device Safari or iOS, and a 320px width.

## 2026-11-03 — Snowfall freshness in the table footer

Every Snowfall row carried a green "Current" chip, and nearly all the time all four did, so the chip read as decoration. Each resort is collected and classified separately, so one footer badge on its own would hide one resort failing while the others are fine. Rejected along the way in PR #41: a chip only on non-current rows, and a separate bordered status line under the legend. The owner wanted the status in the existing legend row, using the table's last row line as the footer rule.

**Footer.** The rows carry no freshness chip (the AI pick chip is unchanged). The rollup is a pure function, `summarizeFreshness` in `src/components/sections/freshness-summary.ts`: worst state, resort labels grouped worst first, and the oldest last successful check (null if any resort was never collected). Group labels reuse the badge wording (`FRESHNESS_TEXT`, now exported from `ui.tsx`). `SnowTableFoot` sits 14px under the table's last line, laid out like the other pages' source lines (roads puts its attribution on the right the same way):

- left: one badge for the worst state across the four resorts (unavailable, stale, old report, report time unknown, current), then, when all are current, "Last successful check: 2 min ago" (the oldest of the four resorts' last successful checks, worded like the other pages' source lines), or else the resorts in the worst state, followed by any other states with their own label, worst first ("Stale — source failing · Solitude · Old report: Brighton · Current: Alta, Snowbird");
- right: the value legend (reported zero, not reported, not provided), pushed right with `margin-left: auto`. When the line is too long it wraps to its own line, still right-aligned; on phones it wraps under the status.

The report-time column still shows each resort's report time, "checked … ago" and "latest check failed". On desktop the column (header included) is right-aligned, so its report times end on the same edge as the footer legend. The hidden phone-summary cell follows it in each row, so the report-time cell carries the page-edge padding itself; measured, the header, all four report times and the legend end at the same x (1241px at 1366, 992px at 1024).

**No notes under values.** The table no longer shows a note under a value (Alta's "12 h" in the overnight column, Solitude's "Since lifts closed"); the column header "Overnight / 12 h" names the window. The phone summary still names each figure by the window it covers (Alta's line reads "12 h 1″") but drops Solitude's note. The page subtitle no longer mentions notes. Resort pages keep their qualifiers. Without the notes, and without the chip that used to make every name cell two lines, rows share one height with no reserved space. Desktop rows then get 24px above and below (was 18px), the same gap as under the page header; 28px (the gap under the Daily Snow teaser) was tried and dropped. Measured on a local server seeded with real resort data: every row is 88px at 1366 and 1024px and 136px at 390px (Solitude's line no longer wraps). At 320px, longer lines wrap, so Snowbird, Solitude and Brighton are 162px and Alta 136px; phone blocks size to their content.

Files touched: new `src/components/sections/freshness-summary.ts`, `src/components/sections/RegionalPage.tsx` (row chip and value notes removed, `SnowTableFoot`, subtitle), `src/components/ui.tsx` (`FRESHNESS_TEXT` exported), `src/app/globals.css` (footer layout, unused `.legend`, `.cell-label` and `.snow-phone__note` rules removed, name margin when it has no chips), `test/regional-freshness.test.tsx` (new: footer rendering and `summarizeFreshness`), `test/resort-report-ui.test.tsx` (no notes under values) and `README.md` (design notes).

Validation: 213 tests across 18 files, `npm run typecheck` and `npm run build` pass; the no-notes test fails against the previous component. Browser on the seeded local server: row heights as above, no horizontal overflow at 1366, 1024, 390 and 320px, the footer legend aligned to the page's right edge, and a mocked mixed-state footer at 1024px. Not run: dark mode (no new colors) and real-device Safari.

## 2026-11-03 — Full-width page intros on desktop

The `.page__sub` intro under each page title keeps its `72ch` cap (561px at 14px) on phones and tablets, up to 900px. From 901px, the layout's existing desktop breakpoint, the cap is removed. The intro then spans the header width, up to 1116px inside the 1180px page container, and reads as one line that lines up with the content below.

Natural widths at 14px: Regional 882px, Weather 798px, Roads 585px. Plumes was about 1236px with the longest date, so its last sentence is trimmed to "Times in MT (source charts use UTC); dashed lines mark midnight, the orange line is now." (about 1040px). It keeps the run code, both initialization times and the line legend. Desktop text width is the viewport minus 64px, so all four are one line from about 1104px up. Between 901px and 1104px, Regional and Plumes can take two lines. New intros should stay under about 1050px at 14px.

Files touched: `src/app/globals.css` (removes the cap from 901px) and `src/components/sections/PlumesPage.tsx` (intro wording).

Validation: 213 tests across 18 files and `npm run typecheck` pass. In Chromium, Regional, Weather and Roads intros were checked at six widths:

- 1366px and 1280px: one 1116px line each.
- 901px: 837px wide; Regional takes two lines, Weather and Roads one.
- 900px and 768px: capped at 561px, two lines each.
- 390px: 3, 3 and 2 lines.

Local KV had no plume data, so the Plumes intro was measured by injecting worst-case text ("Wed, Nov 26, 12:00 PM MT"). Not run: `npm run build`, real-device Safari.

## 2026-11-03 — Single-row masthead on phones

Below 900px the brand used to break "Snow Report" onto a second, smaller line. It now stays on one line next to the appearance buttons, as on desktop: the brand doesn't wrap, and its size scales with the viewport (`clamp(16px, 5.5vw, 23px)`) so the whole name fits even at 320px. To leave the brand more room, the phone masthead also tightens the appearance control: buttons 40px → 34px wide (still 44px tall), brand-to-control gap 16px → 12px, and a -8px right margin so the moon icon's edge sits on the 20px gutter. Only the narrow-screen masthead rules in `src/app/globals.css` changed.

Checked with headless Chromium (brand font size, gap from brand to sun icon, masthead height): 320px 17.6px, 23px, 44px; 360px 19.8px, 36px; 375px 20.6px, 40px; 430px and 768px 23px; 1280px unchanged at 26px and 48px. On phones the icons are 16px apart (22px on desktop) and the moon's right edge is 20px from the screen edge. The brand is never clipped and the page never scrolls sideways. Not run: real-device Safari.

## 2026-11-03 — Daily Snow continuity and AI pipeline cleanup

**Continuity with earlier posts** (`src/lib/dailysnow/continuity.ts`). Before this change the model saw the last post's title and summary, plus each recent post's rolling 24 h / 72 h / next-storm totals. Those rolling totals start at a different time in each post, so "yesterday's 72 h: 10″, today's: 6″" read like a forecast change when it was mostly a shifted window; the 2026-11-02 post compared yesterday's 24 h forecast with reported storm totals this way. The digest now carries:

- `previousPost`: the last post's full paragraphs, for continuity ("what changed since yesterday", no repeated opening or title). Its amounts are out of date: the validator leaves them out of the allowed amounts, and the prompt says not to quote them. A forced rewrite of today's post reads the post before it from the archive (`older` link).
- `phaseChange`, e.g. "pre-storm (Sunday's post) → storm (today)".
- `stormTrend`: the coming storm's total as each earlier post and today's NWS forecast gave it, matched by storm window (windows overlap, allowing 6 hours of drift).
- `lastStorm`: for a storm whose window ended in the last 48 hours, each earlier post's forecast for it (marked before or after it began) and each resort's reported storm and 24 h totals with report times. The model words the comparison; resort storm totals start at each resort's own storm start, so the prompt asks for "rough" when it is close.
- `recentPosts` lines now state when each rolling window started, and the prompt forbids comparing them.

History entries gain optional `postedAt` and per-canyon `storm` windows. Entries stored before this change lack them and are never matched, so trend and verification fill in as new posts are written (within two days of deployment); no migration is needed.

**Shared AI module** (`src/lib/ai/`). The resort pick and Daily Snow each had their own copy of the model list, request body, timeout and fallback loop. `model.ts` now holds one `askWithFallback` (primary, then fallback once; returns the model and, when the fallback answered, why the primary didn't) plus the request body, and `grounding.ts` holds the inch-amount check. `src/lib/recommend/llm.ts` no longer exports `AiLike`, the model ids or `responseJson`; import them from `src/lib/ai/model.ts`.

**Tighter amount check.** It used to accept an inch amount within 1″ of *any* number in the input JSON: elevations, temperatures, wind speeds, percentages, dates and times included, so most invented amounts up to ~100″ passed. Now only inch amounts count: numbers in inch-named fields (`…In`) and amounts written in inches in strings, plus, for Daily Snow, each run of consecutive NWS six-hour amounts (the only addition the prompt allows). The resort pick now runs the same check, which it lacked. The first live GLM run exposed a parser false positive ("highs near 38 in Little Cottonwood" read as 38″), previously masked because the temperature 38 was an allowed number; a bare "in" before a capitalized word is no longer a unit.

**Replay for tuning.** `dailysnow:once` now rebuilds history from the post archive (it used to pass none) and can `--save-digest`; `dailysnow:replay` runs saved digests through the current prompt and validator on the real model. Digests stay out of the repository (third-party report text); build a set of real 6 AM digests over the coming days and replay it on each prompt change.

**Live runs** (production data and archive collected 2026-11-02 ~10:30 PM, evaluated as of 6 AM 2026-11-03, post-storm phase; resort reports were evening data and so marked stale, and ensemble numbers were unavailable at that simulated time):

- GLM 5.3 Flash: first run rejected by the parser false positive above (79 s). After the fix: valid in 61 s, 6,023 prompt / 3,408 output tokens, "Done at 15″, Light Refresher Wednesday", 366 words, update + extended, four figures. It used the new context as intended: "From Sunday evening we had 6.5″ for Little Cottonwood and 2.8″ for Big Cottonwood, and both canyons cleared those numbers by a wide margin", and "essentially unchanged from the 1.7″ and 1.4″ in the NWS forecast we shared yesterday — the window just shifted a few hours later". The title ran six words (prompt asks 2–5).
- gpt-oss-120b: valid in 21 s, 5,999 / 1,151 tokens, "Fresh Powder Pause", 274 words. It ignored `lastStorm` and `stormTrend`, mentioned stake undercounting with no stake figure offered, and wrote "5 in. overnight" for Snowbird's 24 h figure. The fallback remains weaker; the validator cannot catch these.
- Resort pick (preseason, so both models correctly picked none; `--assume-in-season`): GLM 6,256 / 306 tokens and gpt-oss 6,303 / 860 tokens, both valid under the new amount check.

## 2026-11-03 — Daily Snow teaser leads the Snowfall page

The Daily Snow teaser moved from between the Snowfall header and the resort table to the top of the page, above the "Regional snowfall" header. Spacing is unchanged: the teaser keeps its 28 px gap to whatever follows (now the title) and the header keeps its 24 px gap to the table. With no post the teaser renders nothing and the page starts at its header, as before.

A tighter Snowfall header-to-table gap (15 px desktop, 10 px phones) was tried so the intro-to-table gap measured the same as the teaser-to-title gap. It looked worse in review and was reverted; the header keeps the shared 24 px gap.

## 2026-11-03 — Daily Snow archive navigation without flashes

- **Problem (reproduced on production):** picking a post from the history rail or the archive links replaced the whole layout (rail and article) with a "Loading…" placeholder for the length of the `/api/daily-snow?date=` request (about 130 ms on production), then swapped the new post in. A `?date=` link first rendered the live post, then the placeholder, then the archived post, because the date was read in an effect after the first render.
- **Fix:** `src/components/dailysnow/archive.ts` keeps archived posts loaded this page session in memory, shares one request per date and prefetches on hover or focus of rail entries and archive links. While a pick loads, the post already on screen stays put (rail entry highlighted immediately, article `aria-busy`, dimmed only if the load passes 200 ms). Cached posts show in the same render as the click. Entries older than five minutes (the API `max-age`) show at once and refresh in the background. Failures aren't cached, so picking that date again retries. `?date=` is read on the first render; this is safe because `DailySnowPage` only mounts in the browser after the report loads. The "· Archive" label now follows the post on screen, not the pending pick.
- **Verified:** in Chromium against production API responses, with a local proxy adding 800 ms to archive requests, at 1280×900 and 390×844. The page went straight from the live post (busy) to the archived post with no placeholder, back-and-forth picks made no new requests, and a `?date=` link never showed the live post. A first deep-link visit still shows "Loading…" until its post arrives, because nothing is cached yet to show in its place.

## 2026-11-03 — Snowfall titles

- The Snowfall page header reads "Resort snowfall" (was "Regional snowfall"); the section id, route and nav label are unchanged.
- The Daily Snow NWS snowfall figure is titled with its caption ("NWS 6-hour snowfall forecast · Alta / Snowbird (LCC)") in the chart's heading slot, replacing "6-hour snowfall · inches", and no longer repeats it below. The caption dropped the "· updated …" NWS grid time. That time was frozen into the post at generation (not live), but it named the NWS grid's issue time, which read like a page refresh time. Posts already stored with the suffix have it stripped at render. The chart's footer note is unchanged.

## 2026-11-03 — Dark share previews by page role

Every page except `/daily-snow`, including the homepage, shares the static branded `public/share-brand-v2.png`. Daily Snow alone has a dynamic preview of the latest stored post (also for archive query links), with its date, bounded headline/summary, AI badge and stored model attribution. Before a post exists it shows a neutral introductory fallback. Page titles/descriptions remain specific to the linked page. Both images use the site’s dark palette, pale text and blue wordmark accent, open spacing and fine rules at 1200 × 630; browser appearance settings do not change them.

The branded PNG is regenerated with `npm run share:render`; its source and palette are shared with Daily Snow. A rendering test compares the committed asset with its source. The dark branded asset replaces the light version at a new versioned URL. The Daily Snow handler bumps its internal cache version, retaining host-scoped caches and existing 600/60-second TTLs. Messaging services can retain their own cached previews after deployment; replacing the branded asset requires a new filename and metadata URL. The site does not control messaging-service cache expiry.

The unused dynamic snowfall renderer, data helper and `/opengraph-image` Worker route are removed. Its old URL now follows the normal static 404 path. Shared font configuration lives in `image-fonts.ts` for the branded asset generator and Daily Snow handler. No source, data freshness, storage, collection or AI inference changes.

Satori mutates style objects during rendering: passing the same frame object directly caused later renders to lose header/footer content. Each image passes a fresh copy, and image tests check visible header/footer ink on repeated Daily Snow renders, dark background, dimensions, model labels and long copy. The static branded image intentionally places its large wordmark in the middle.

Validation: 23 relevant tests across share images, metadata and Worker routing passed; `npm run typecheck`, `npm run build`, `npm run smoke` and `git diff --check` passed. Smoke uses a local workerd instance with empty KV: all nine exported pages reference the intended image, both static and Daily Snow PNGs decode at 1200 × 630, the retired snowfall endpoint returns 404, and navigation payloads, API methods and HEAD work. Inspected the regenerated dark branded PNG and a dark Daily Snow PNG with long copy. Not run: native iMessage/WhatsApp clients, a deployed preview or new live AI generation. No production KV writes.

Existing files touched (relative to main):
- `src/app/layout.tsx` and `src/lib/metadata.ts`: shared static image metadata with the Daily Snow override.
- `src/lib/og/daily-snow-image.tsx`: matching forecast renderer, bounded copy and AI/model attribution.
- `src/lib/og/card-image.tsx`, `src/lib/og/shareCard.ts` and `src/worker/share-image.tsx`: removed unused live snowfall preview code.
- `src/worker/daily-snow-share-image.tsx`: shared font import and cache version bump.
- `src/worker/fetch.ts` and `wrangler.jsonc`: remove obsolete Worker route and Worker-first entry.
- `test/share-card.test.tsx`: dark/repeated Daily Snow renders, branded asset consistency and model attribution; obsolete snowfall tests removed.
- `test/metadata.test.ts`: homepage static image and section-specific image routing.
- `test/worker.test.ts`: remove obsolete route from the method-enforcement checks.
- `scripts/check-share-preview.ts`: fetch and decode the intended image for every page.
- `scripts/smoke-worker.ts`: static brand asset, retired route and metadata checks alongside Daily Snow PNG checks.
- `package.json`: reproducible `share:render` command.
- `README.md`: image routing, regeneration and cache operations.
- `docs/IMPLEMENTATION_NOTES.md`: decisions, validation, limitations and file scope.

New files: `src/lib/og/style.tsx`, `src/lib/og/image-fonts.ts`, `src/lib/og/branded-image.tsx`, `scripts/render-share-image.ts`, `public/share-brand-v2.png`.

## 2026-11-03 — Resort navigation without report reloads

- **Cause:** clicking a resort name in the snowfall table used a plain anchor, unloading the document and its shared report poller. Production browser instrumentation confirmed a document unload and a fresh `/api/report` request on arrival at Alta. This recreates the initial loading screen; the resort dropdown already uses client navigation.
- **Fix:** `RegionalPage.tsx` uses Next.js `Link` for all four resort names. `ResortReportPage.tsx` uses the same component for its Forecast link, which had the same reload behavior. Existing hash jump links and external source links keep their behavior. The shared poller, source adapters and freshness rules are unchanged. Direct visits still need the initial report request.
- **Regression:** five app-shell tests exercise the four table links and the Forecast link through the mocked router boundary, then render the destination in the existing shell and assert no loading screen or extra report fetch. All five failed before the change and passed afterward. The browser check covers the real Next.js router, which jsdom does not mount.
- **Verified:** 233 tests across 18 files, typecheck, static build and Worker smoke (9 pages) pass. In the built local Worker seeded through fixture collection, all four table-to-resort transitions at 1280 px and 390 px retained the document, showed no loading state, and made zero navigation-triggered report requests. The phone Forecast transition also retained the report; resort pages had no horizontal document overflow. Production KV was not written.

## 2026-11-03 — Consistent freshness and publication notices

**Decision.** Keep source-specific age windows and data eligibility rules, and separate collection recency, upstream report age and editorial publication availability. This supersedes older notes describing red stale badges, amber unknown times, generic editorial “Outdated” text and a history entry called “Today”.

**Source presentation.** `src/lib/freshness.ts` owns labels, explanations and tones. `StatusBadge` shares the existing chip geometry and theme tokens: green Current, amber Old report / Updates delayed, neutral Time unknown, red Unavailable / confirmed update failure, blue AI provenance. The API's existing freshness enum remains unchanged. A stale collection note no longer asserts that the source is failing: the classifier establishes elapsed time, not the cause. Confirmed failed latest attempts remain separate. The global required-feed banner groups unavailable feeds separately from delayed feeds with retained payloads. Camera stills older than 3 h use amber captions; contextual travel-time and connection explanations keep their existing placements.

**Editorial notices.** The resort pick retains its target-day/12-hour limit and three-failure threshold. Either condition removes the row endorsement while keeping the reasoning; the badges say “Recommendation needs updating” and “Updates failing”. Daily Snow shows one shared “Latest edition delayed” badge in its teaser and latest article when an expected replacement misses its publication opportunity. Yesterday's edition is normal before 6 AM Denver, then pending through the existing 6–10 AM attempt window. Exhausting three attempts or the daily call budget ends that opportunity early. An in-flight final attempt remains pending through its existing lease, even after 10 AM. Editions older than yesterday stay delayed overnight. Denver calendar arithmetic handles spring and fall DST changes. Archived views keep their date and Archive label without a publication warning; the history rail says Latest plus the actual edition date.

**Quiet days and API.** The existing season/recent-snow/forecast-snow gate is shared through `dailySnowActivity`, without changing model eligibility or computed facts. Only usable resort and NWS inputs can establish an intentional quiet-day publication pause; missing or delayed inputs cannot suppress the delay notice. `/api/report` adds optional `dailySnow.publicationStatus` (current/scheduled/pending/delayed/paused). Existing `outdated` and `failing` flags remain compatible, and archive responses omit the new field. This is pure classification on reads: no source calls, model requests, KV writes or schema migration. A missing first post keeps its existing empty state.

**Validation.** 249 tests in 20 files pass, including new Denver midnight/window boundaries, retry and call-cap exhaustion, an attempt crossing the cutoff, prior-day failures, older editions, quiet/missing inputs, both DST changes, archive suppression, matching teaser/article badges, required-feed grouping and retained recommendation warnings. Typecheck, static build and `git diff --check` pass. The workerd smoke passes all nine pages, navigation assets, API methods, KV, both share PNGs, metadata and HEAD responses. No live model inference was run; prompts and eligibility were not retuned.

Browser checks used this worktree's local Worker on port 8794 with an empty KV and local copies of the real production API report and November 1 Daily Snow archive. Delayed/missing source records and a clearly labeled retained recommendation fixture exercised warning states. No production writes were made. Checked Snowfall, Daily Snow, Alta, Roads, Weather and Plumes at 390×844 and 1366×768; Snowfall also at 320×740. Light and dark status colors were checked. No page-width overflow occurred. Fixed the phone teaser's timestamp/status alignment and allowed the longer history date to wrap as a unit. Archived figure assets were not copied into local KV; this validates the article/status layout, not local figure availability. Browser screenshots stayed outside the repository.

**Existing files touched and why:**

- `src/lib/report.ts`: factual delayed-collection note and optional publication classification in the report response.
- `src/lib/types.ts`: clarify the existing stale state and add the optional editorial status type.
- `src/lib/dailysnow/digest.ts`: share the unchanged activity gate with public publication availability; guard quiet-day claims against unusable inputs.
- `src/lib/dailysnow/schedule.ts`: update the publication-delay comment; cadence, limits and execution are unchanged.
- `src/components/ui.tsx`: reusable status badge and source label/tone mapping.
- `src/components/dashboard-context.tsx`: distinguish unavailable and delayed required feeds.
- `src/components/sections/RegionalPage.tsx`: explicit recommendation badges, preserving endorsement suppression.
- `src/components/dailysnow/DailySnow.tsx`: identical latest-publication badge in teaser/article; preserve archive treatment.
- `src/components/dailysnow/HistoryRail.tsx`: Latest plus edition date instead of unconditional Today.
- `src/app/globals.css`: shared semantic tones and wrapping/alignment for editorial metadata and feed groups.
- `src/components/sections/resort-report.css`: amber for old camera images.
- `test/collect.test.ts`: distinguish elapsed collection age from an unverified failure cause.
- `test/app-shell.test.tsx`: updated required-feed banner rendering.
- `test/regional-freshness.test.tsx`: updated unknown-time wording in the existing footer grouping checks.
- `test/recommend-ui.test.tsx`: retained recommendation warnings and absent endorsement.
- `test/dailysnow-ui.test.tsx`: shared badges, expected publication states, archive suppression and actual latest date.
- `test/dailysnow.test.ts`: report-level activity/publication integration and compatible old flags.
- `README.md`: complete state/threshold/placement/effect reference, including the optional API field.
- `docs/IMPLEMENTATION_NOTES.md`: this decision, scope and verification record.

**New files:** `src/lib/freshness.ts`, `src/lib/dailysnow/publication.ts`, `test/freshness-ui.test.tsx`, `test/publication-status.test.ts`. No source adapters, source thresholds, inference schedules, storage keys or routes changed. Revert restores prior labels and publication notices without a data migration.

## 2026-11-03 — Daily Snow storm observation memory

**Problem verified against the public archives.** Monday November 2 retained Alta's reported 15″ storm total and Snowbird's 15″ rolling 48-hour observation. Tuesday November 3 retained Alta's reset storm field (0″) and Snowbird's smaller 48-hour window (12″), then called them “the final numbers.” Snowbird's upstream API computes its rolling totals at fetch time even when its published report timestamp does not change. The article figures were already frozen correctly; the missing piece was event memory across editions.

**Contained implementation.** `src/lib/dailysnow/storms.ts` is a pure observation reducer, separate from the existing daily forecast phase and source adapters. It records first-observed time (not meteorological onset), last evidence of accumulation, lifecycle, per-resort source-reported storm totals, and qualified rolling observations. Positive increases in reported snowfall/season values indicate additional snow; amounts are never accumulated by summing overlapping windows. A lower positive storm report with a newer source timestamp is retained as a correction. Zero resets preserve the earlier observation. If a counter then starts accumulating again within the same event, the new segment is retained separately and a full-event total remains unknown. Rolling windows crossing a previously closed event are excluded from a new event's fallback observations.

**Lifecycle and bounded context.** An event wraps up after a 12-hour lull when fresh NWS coverage for the next 18 hours contains less than 0.5″ in each canyon. It closes after a 24-hour lull with that dry forecast, or after 48 hours without new evidence (marked `no-new-evidence`, not a confirmed weather end). Near-term forecast snow bridges shorter lulls. Missing, failed, old and future-dated resort reports cannot create new observations. Repeated old positive values cannot refresh the accumulation clock, create another event or reopen a closed event. A delayed positive correction or first report from a previously missing resort can update a closed recap during its 36-hour editorial window. After that window, the closed event no longer holds the article in post-storm mode. A new accumulation event after closure gets its own identity.

**KV storage and overlap handling.** Optional `snapshot.stormTracking` retains per-resort processing cursors and three recent records. Each record also lives at `dailysnow-storm:v1:<id>` without expiry; only material changes are written. Initial collection reads at most five recent editions (within 72 hours), following neighbor links and the existing history index for legacy posts without links. It imports structured numbers and figures, never historical AI prose. Missing archives retry on subsequent collections. New posts add optional `stormRecap`, optional 48-hour/season baselines in their saved resort numbers, and a `storm-recap` figure. Older posts need no migration.

Snapshot merges reconcile storm records per resort, retain newer cursors and explicit corrections, preserve rolling observations against resets, coalesce near-simultaneous first discoveries, and reject closure based on an older accumulation clock. Daily Snow rebuilds its digest after collection's merge read so its facts and figure see the merged observations. As with existing source merging, KV still has a residual eventual-consistency/read–put race: this is conflict reconciliation, not a transaction or an exactly-once distributed lock. Serializing all writers would require a separate coordination primitive and is outside this change. An independently archived record is a durable archive, not an atomic commit with the snapshot.

**Prose and rendering.** The model receives Denver-formatted report/check times beside each retained amount; raw UTC event times are kept in storage but omitted from the model-facing projection. This was added after a live run misread 16:00Z as 4 PM and attached Snowbird's earlier 15″ to its newer report. The prompt makes the event record authoritative, distinguishes earlier rolling observations and counter segments, and forbids unsupported final-total framing. Validation rejects explicit single-amount resort/storm-total claims against that resort's exact retained amount, in addition to the existing general amount check. Complex multi-amount prose still depends on the prompt and needs editorial scrutiny; this is not a complete natural-language semantic validator. The deterministic figure labels the measurement, original report/check times, source corrections and unknown full totals. It is included even when the model omits its figure reference and survives the six-figure budget alongside the required plume. Later source changes do not alter a saved edition's facts or figures.

“The discussion” / “the forecast discussion” becomes “the NWS” in new validated output and displayed historical prose, including teaser summaries. Internal source names remain unchanged. The attribution footer now says “NWS forecasts.”

**Review and operations.** No production KV writes or post rewrites were performed. PR previews read existing production editions and run no collection cron, so they cannot generate the new recap. Local review uses real public production sources and archived posts, the actual collection/publication code, and a saved real Workers AI response; image panels are copied into local KV. The local snapshot is deliberately fixed, so source-delay banners after its collection window are expected. No new credentials, bindings, routes, migration or manual step is required on merge; the next production collection initializes memory, and the next edition uses it.

**Existing files touched and why:**
- `src/lib/types.ts`: additive snapshot/post fields, saved observation baselines, and the new figure variant.
- `src/lib/collect.ts`: collection-time tracking/archive integration, independent of AI, and merged inputs for publication.
- `src/lib/store.ts`: observation-aware reconciliation and returning the stored merged snapshot.
- `src/lib/dailysnow/digest.ts`: event context, Denver-time projection, recap figure candidate, and expiration of old storm phase influence.
- `src/lib/dailysnow/index.ts`: rebuild the digest after merging, freeze recap data, and preserve the recap within the figure budget.
- `src/lib/dailysnow/llm.ts`: storm continuity rules, NWS attribution, and focused validation.
- `src/components/dailysnow/DailySnow.tsx`: supplemental recap placement and clear NWS attribution in saved prose, summaries and footer.
- `src/components/dailysnow/figures.tsx`: dispatch the new figure to its renderer.
- `src/app/globals.css`: three scoped recap-table rules.
- `scripts/dailysnow-once.ts`: reconstruct the same storm context from the public archive for read-only prompt tuning.
- `test/dailysnow-ui.test.tsx`: qualified observations, source times/corrections, missing totals, supplemental rendering and historical wording.
- `README.md`: storage keys, bootstrap and lifecycle documentation.
- This file: decisions, validation evidence and limitations.

**New files:** `storm-types.ts` (persistent types), `storms.ts` (pure reducer/projection/merge/bootstrap), `storm-store.ts` (bounded KV integration), `storm-grounding.ts` (focused attribution checks), `wording.ts` (shared source wording), `StormRecap.tsx` (figure), and `test/storms.test.ts` (lifecycle, persistence, publication and overlap regression tests).

**Validation.** 280 tests across 21 files pass (31 new cases: 29 storm/persistence/publication/grounding cases and two UI cases). `npm run typecheck`, `npm run build`, `npm run smoke` (all nine static pages, API/KV and share-image checks), and `git diff --check` pass. Regression coverage includes 15″→12″ rolling-window shrinkage, zero resets, 15″→16″ updates, counter restarts, three-day storms, lulls, sunny-day expiry, separate nearby storms, late reports/corrections, old/failed/missing data, legacy archive bootstrap, forced rewrites, immutable post data, overlapping writers and both DST transitions. Figure-budget coverage preserves both the required recap and plume when the model fills all six slots.

Four live GLM 5.3 Flash generations against real production data/archives completed and passed schema/amount validation: 116.6 s (14,338 tokens), 65.1 s (12,854), 120.7 s (15,564), and 60.3 s (13,108). The first three exposed wording/time-attribution weaknesses and informed the final local-time projection. The final run retained 15″ at Alta and 9″ at Solitude, tied them to Monday's 9:00 AM and 8:42 AM reports, distinguished the resets, retained Snowbird's earlier 15″ over 48 hours, and used “the NWS.” It still inferred the tracked-since time as the storm onset and called Snowbird's retained observation its “last” reading; the deterministic figure is more precise, and general prose interpretation remains a known model limitation. Forecast-versus-observed comparisons also remain rough where source windows differ. No live fallback run, production cron/deploy or native-device Safari check was performed.

Browser checks used `http://localhost:8796/daily-snow` on `t3/daily-snow-storm-totals`, seeded through `runCollection` with real archived posts, public source records, copied plume panels and the final saved live model response. Inspected the actual recap at 390×844 and 1366×768 in light/dark appearance, and checked 320×740 for width. No horizontal page overflow, broken images or browser errors. Screenshots and captured third-party/model output remain outside the repository. The seeded server remains available for review because the PR preview cannot generate the new post before merge.

## Daily Snow archive navigation

Previous/next navigation appears only after the AI attribution footer on every screen size. The article starts with its heading and metadata. Each direction is a plain-text date control with a muted arrow, a 44px minimum touch target, accent text, an underline on hover and a keyboard focus outline. Full destination titles remain in accessible names and hover titles. Only available neighbors render, and no navigation row renders when both are absent. The desktop history rail shows recent posts; phones use the bottom date controls without a history list or disclosure.

Previous and next stay together for continuing after reading. Neighbor resolution and `?date=` navigation retain archive cache, prefetch and loading behavior; older posts fall back to the archive index. No storage, API, source, scheduling or model changes.

## 2026-11-03 — Official PR-Agent Action through OpenRouter

**Decision.** Use the official Marketplace Action directly, pinned to v0.49.0's
wrapper commit `efdde4afe14aa401a3889012c7f3e9ef3081a430`. Its Dockerfile still
uses upstream's rolling `github_action` image; the runtime is not digest-pinned.
PR-Agent owns inference, comments, inline findings, persistent state, coverage,
model attribution and errors. The only custom logic is a short workflow routing
step: an author label excludes that family; PR-number parity selects one of the
other two. Defaults are Opus 5.5, GPT-6.1 Sol and GLM 5.3. There is exactly one
reviewer per eligible event and no cross-model fallback.

The trusted-base `pull_request_target` workflow checks current PR state and manual
request permissions before selecting a model. No PR code is checked out or run.
Policy and AGENTS.md come from the default branch via API. Forks, drafts, bot
events and Dependabot are skipped; missing/conflicting author labels spend no
credits and produce an Actions notice. Exact `/review` is the only accepted
comment command. Same-head concurrency avoids an old head cancelling a new one.
PR-Agent's native behavior owns in-flight updates; there is no custom publisher,
Docker launcher, output validator or post-inference state manager.

**Limits and operations.** A dedicated `OPENROUTER_API_KEY` repository secret and
three author labels are installed. The owner controls the key's credit cap in
OpenRouter. Policy uses high reasoning for all three models, a 131,072-token
context budget, 32,768 completion tokens (reasoning plus final review), a 20-minute
call timeout, one transient retry, no chunking and a 45-minute job limit.
Findings are advisory; no automatic approval, merging, description
rewriting or code edits. Activation and actual bot publication require merging
the workflow/config, then triggering a labeled PR or `/review`.

**Initial live provider validation (before the high-reasoning follow-up below).** PR-Agent code and locked dependencies from the
published CLI image were run locally against PR #57 through OpenRouter (Docker
is unavailable here). Opus produced a valid review in 58 s (24,019 input / 4,206
output tokens), GPT in 79 s (15,121 / 2,126), and GLM with low reasoning in 32 s
(15,147 / 2,133). All reported full diff coverage. GLM's initial high-effort call
failed after 264 s: it exhausted all 8,192 completion tokens on reasoning, with
empty content and `finish_reason: length`. Lowering effort fixed it. These were
explicit provider-validation calls; normal operation selects one model.

**Validation.** All 285 application tests across 21 files and typecheck pass;
the Deploy workflow also passed build and preview on the preceding head. Final
workflow routing passes 16 scenarios, including every author/parity combination,
permission and eligibility skips, stale events and invalid model overrides.
actionlint 1.7.12 passes on both workflows; TOML/Action configuration assertions
and diff checks pass. The official Action's native runner was also exercised
locally with a real `pull_request_target` payload and GLM through OpenRouter:
it exited successfully in 43 s and emitted exactly one review to `GITHUB_OUTPUT`.
Publication was disabled for this local check; GitHub bot identity and actual
comment publication require merge.
No browser checks were needed for this CI-only change. Bot publication and the
trusted-base trigger cannot be exercised before this setup merges. Scratch
model responses, environments and validation harnesses are outside the repo.

**Existing files touched:** `AGENTS.md` adds the author-label rule; `README.md`
documents setup/operations; `.github/workflows/deploy.yml` updates only the bot's
Preview comment rather than its latest comment, preventing reviews from being
overwritten; these notes record decisions and evidence. New files are
`.github/workflows/review.yml` and `.pr_agent.toml`. A revert removes reviews and
restores preview publication; already-spent inference credits are not refunded.

### High-reasoning defaults follow-up

The owner prefers high reasoning for code review. All three models now receive
`high` through PR-Agent's global and explicit OpenRouter policy. Removed the
per-model low/medium workflow override. The completion cap is 32,768 tokens,
four times the original cap; it covers both internal reasoning and the visible
review. OpenRouter's catalog confirms that all three models support high and
these limits. The context budget is 131,072 tokens, with PR-Agent reserving
completion space. Calls have 1,200 seconds and jobs have 45 minutes to accommodate
one transient retry plus startup. Failure never lowers effort or changes models.

The earlier GLM result established that the 8,192-token cap was too small for its
high reasoning run; the new defaults address the budget rather than reducing
effort. Request-construction checks against PR-Agent confirm all three models
receive `reasoning.effort=high`, a 32,768-token completion cap and a 1,200-second
timeout, and reserve 32,768 tokens inside the 131,072-token context budget.
All 16 routing scenarios, actionlint on both workflows, policy assertions and
`git diff --check` pass. The native Action runner then completed one live GLM
high-effort review in 99 s with the enlarged budget (publication disabled).
The regenerated key was installed as the repository's `OPENROUTER_API_KEY` and
used successfully for that run. No application tests or browser checks were
rerun for this configuration-only follow-up.
The live review also prompted explicit `pull-requests: read` permission for the
routing job's PR API reads; the review job retains its scoped write permission.

**Files touched in this follow-up:** `.pr_agent.toml` sets reasoning and budgets;
`.github/workflows/review.yml` removes per-model effort selection and increases
the job timeout; `README.md` and these notes document the resulting behavior.

## 2026-11-03 — Data architecture audit after storm tracking

Audit baseline: `732d689` on `origin/main`, including storm observation memory
(#55), archive navigation, and the advisory code-review workflow (#57). This
section records findings and proposed follow-ups; it changes no application
behavior and does not claim the fixes below are implemented.

### Overall assessment and data flow

The architecture fits the dashboard: source adapters fetch and normalize data
during collection; one KV snapshot holds last-good source payloads and scheduling
state; Worker reads add freshness and public editorial status; a shared browser
poller supplies every page. Reads never collect upstream data or invoke AI.
Metric states preserve reported zero, not reported, and unavailable. Images are
binary KV objects referenced by JSON rather than embedded in report responses.

Storm tracking improves historical provenance: its pure reducer is separate from
KV integration, retains source/window/report/check times and counter resets,
never adds overlapping rolling observations, bounds snapshot context to three
events, and archives event records separately. Daily Snow rebuilds its digest
using merged source/storm records and freezes the recap with each edition. Those
improvements do not resolve the publication-ordering and forecast-window issues
below. Keeping KV is reasonable; a wholesale storage rewrite is not proposed.

### Correctness findings and proposed order

1. **AI publication ordering (`src/lib/store.ts`).** `newerState` compares attempt
   start times and lets incoming state win ties. A collector carrying a reservation
   can overwrite the completed result of that same attempt, even if its merge read
   sees the completed snapshot. A local probe merged a completed November 3 post
   with its reservation holding November 2; the result reverted to November 2.
   Prefer completed state for the same attempt and define monotonic publication
   ordering. The read/merge/put remains non-atomic; strict request reservations and
   multi-writer publication need serialization, not a KV advisory lock. Storm
   reconciliation does not change the AI-state comparison.
2. **Forecast-window totals (`src/lib/dailysnow/digest.ts`).** `snowNext` sums whole
   six-hour bars intersecting the requested interval. At November 3 13:00Z
   (6 AM Denver), the next-24-hour calculation accepts bars starting at 12:00Z,
   18:00Z, 00:00Z, 06:00Z and 12:00Z: 30 hours of coverage. Five synthetic
   one-inch bars produce five inches under the next-24-hour label. Define explicit
   calculation windows and coverage requirements; use suitably bounded input or
   expose the actual whole-bar window rather than imply an exact rolling total.
3. **Image revision identity (`src/lib/dailysnow/index.ts`,
   `src/worker/daily-snow-figure.ts`).** Forced same-day rewrites overwrite
   date/figure keys while the endpoint advertises one day of immutable caching.
   Cached stills can disagree with revised prose. Image writes also precede the
   replacement post, so a subsequent publication failure can change stills used
   by the previous post. Write revision-specific artifacts before publishing
   references to them. Frozen structured recap figures already avoid this issue.
4. **Full-response deadlines (`src/lib/http.ts`).** The abort timer is cleared
   after headers arrive, before text/JSON/binary body consumption. A stalled-body
   probe remained pending after 100 ms with a 10 ms configured timeout and an
   unaborted signal. Since collection awaits all selected sources, one stalled
   body can delay publishing the others. Keep deadlines through body consumption;
   enforce byte limits while streaming rather than after buffering. Text and JSON
   reads also need bounds.

### Contracts, efficiency and maintainability

- **Typed decoding:** `Snapshot.sources` and `ReportResponse.sources` erase each
  source's payload type, requiring assertions throughout consumers. Introduce a
  source-to-payload mapping and validated storage decoding. `readSnapshot` accepts
  `{ "schemaVersion": 1 }` without its required structure; archive and storm reads
  likewise cast parsed JSON. Define compatibility defaults/migrations and surface
  corrupt storage distinctly from an uninitialized dataset.
- **Public projection:** `ApiSource` extends the persisted `SourceRecord`, and
  `publicRecord` mostly spreads it. Every report includes operational diagnostics,
  AI-only ensemble/discussion payloads, camera discovery caches and the full latest
  article. Prefer an explicit client contract while preserving the shared request.
  Polling should have a deadline, prevent overlapping requests and suspend while
  hidden; short caching or conditional responses must account for freshness and
  publication transitions, not only snapshot changes.
- **Module dependencies:** `report.ts` imports Daily Snow activity/digest code that
  imports classification from `report.ts`; recommendation digests also import it.
  Move foundational classification, forecast calculations and shared policy out
  of public report construction to remove these cycles.
- **Artifact recovery:** plume panels expire after four days, but same-run reuse
  checks the upstream chart without checking stored panel existence. Persistent
  upstream run stalls can leave expired references; crop errors also suppress
  retries until the image URL changes. Add bounded retry/recovery behavior.
- **Archive operations:** no backup/restore procedure was found in the repository
  for permanent posts, figures or storm records. No expiry is retention, not
  recovery from overwrite/deletion. Storm archiving avoids unchanged writes but
  still reads up to three records each collection; this bounded cost is acceptable
  and lower priority than correctness. Multi-key archival is not an atomic commit.

### Endpoint coverage

| Endpoint | Storage and delivery | Audit assessment |
| --- | --- | --- |
| `GET /api/report` | One snapshot read, computed freshness/status, `no-store` | Good aggregation; public contract and polling can be tightened |
| `GET /api/daily-snow?date=…` | Post plus snapshot reads, five-minute HTTP caching | Whole snapshot is needed for recent archive/state metadata; decoding remains unchecked |
| `GET /api/daily-snow/figure/…` | One binary read, immutable caching | Revision identity must match the cache promise |
| `GET /api/plume/…` | One binary read, run-specific immutable URL | Good identity; expired panels need recovery |
| `GET /daily-snow/opengraph-image` | Explicit cache lookup; snapshot read/render on miss | Bounded caching is appropriate |
| `POST /api/admin/collect` | Disabled without token; authenticated collection | Shares collection/publication coordination risks |

The router also enforces allowed methods and handles HEAD for read routes. No new
route, binding, storage format, or production operation is introduced by this audit.

### Evidence and limits

After rebasing onto `964fed6`, 285 tests across 21 files and `npm run typecheck`
passed. Local probes reproduced equal-attempt AI rollback, overbroad forecast-bar
coverage, incomplete snapshot validation and the stalled-body timeout. The later
rebase to `732d689` changes review infrastructure/documentation, not these runtime
paths; they were checked again by content review. Documentation links and
`git diff --check` were reviewed for this documentation-only PR.

One earlier read-only production request returned HTTP 200, 70,205 bytes of decoded
report JSON and Brotli content encoding. This is a point-in-time payload observation,
not a throughput or latency benchmark. No production writes, paid model calls,
load tests, browser checks, build or smoke run were performed for this audit.

**Existing file touched:** `docs/IMPLEMENTATION_NOTES.md` records the audit,
reproduction evidence, storm-tracking reassessment and proposed follow-ups.

## 2026-11-03 — Snowfall legend restored; resort freshness in its own source line

Supersedes the footer layout in "Snowfall freshness in the table footer" above. Folding the resort freshness into the legend row made the legend do two jobs, and it took one-off overrides to work: `.snow-foot` stripped the source line's rule and padding, the legend was pushed right, and the report-time column was right-aligned to match it. The owner wanted the original legend back and a separate footer that looks like the Weather and Plumes source lines.

- **Legend:** `<p className="legend">` under the table again, with its original `.legend` rules (16px under the table, muted caption, left-aligned). The `.snow-foot*` rules are gone.
- **Report times:** left-aligned again, as before #41; the `.snow-table .report-time` right-align rule and the header's `report-time` class were removed.
- **Source line:** new `ResortsSourceLine` (`src/components/sections/ResortsSourceLine.tsx`) renders the stock `.source-line` with no overrides, one page gap below the legend: the worst resort's badge, then the resorts in each state, worst first, when not all are current; "Last successful check" (the oldest of the four, from `summarizeFreshness`); "Latest check failed: …" naming any resort whose latest check errored; and "Alta, Snowbird, Solitude and Brighton snow reports (resort websites)" as attribution on the right. Per-resort report times stay in the table, so the line carries no single source time.
- Unchanged from #41: no chips in rows, no notes under values, 24px row padding.

Validation: 287 tests across 21 files pass, and `npm run typecheck` and `npm run build` pass. On a local server seeded with a real collection (Chromium): at 1366px the legend sits 16px under the table. The source line starts one page gap below it with its own rule, its left edge at the page's (125px) and its right at the page edge (1241px). At 390px it wraps the attribution under the status. Neither width overflows horizontally. Not run: dark mode (no new colors), a live mixed-freshness state in the browser (covered by unit tests) and real-device Safari.

## 2026-11-03 — Data architecture audit, phase 1 correctness fixes

Implements the four ordered correctness findings in the audit above. Typed
storage decoding, public response projection/polling, dependency cleanup, plume
recovery, and archive backup/restore remain follow-ups.

- **AI publication:** merge attempt bookkeeping separately from last-good output.
  Completion beats reservation at the same attempt time, and a newer reservation
  or failure carrying stale output cannot revert a publication visible to the
  merge read. Recommendation attempts now record optional `lastFinishedAt`,
  including failures and rule-based no-pick updates; legacy successful states
  remain comparable by `generatedAt`. Daily Snow history merges by date and
  publication time, retaining the existing input history bound. Exact ties retain
  the stored value. KV read/merge/put and date-keyed archive writes remain
  non-atomic; strict reservations, request caps and multi-writer archive/snapshot
  consistency still require serialization, not an advisory KV lock.
- **Forecast windows:** retain optional, unrounded `hourlySnow` from the NWS
  adapter's existing uniform distribution of interval accumulations, bounded to
  seven days. Rolling totals integrate only the requested interval, including
  fractional boundary hours using that same allocation assumption. The digest
  states the estimate basis and exact UTC window start. Every intersecting hour
  must be present exactly once; absent, duplicate, non-finite or negative amounts
  yield null, while covered zero remains zero. Five synthetic one-inch six-hour
  bars no longer produce five inches under the next-24-hour label: hourly
  allocation yields four. Legacy six-hour-only payloads cannot establish full
  coverage and yield null until a successful NWS collection (normally within
  15 minutes). The forecast horizon may not cover a full seven days; that total
  is then unavailable. Partial future snow coverage can still establish posting
  activity without being presented as a complete total; the bar covering the
  posting time counts in full (hourly or legacy six-hour), as before, so a
  storm still falling keeps an otherwise off-season day eligible. Measured resort windows,
  existing NWS charts and ensemble calculations are unchanged.
- **Figure identity:** SHA-256 of each still determines the revision stored at
  `dailysnow-fig:v2:<date>:<figure>:<sha256>` and its `?v=<sha256>` URL. Images are
  written before their post references, so successful rewrites and failed
  replacement publications leave older referenced bytes untouched. Revision URLs
  keep immutable one-day caching; legacy v1 keys/unversioned URLs remain readable
  with five-minute revalidation. Previously cached immutable legacy responses may
  survive their original cache lifetime. No migration, backfill or production
  write was performed. Unreferenced revision artifacts can remain after failures
  or rewrites; recovery/garbage collection is separate. Once new posts reference
  v2 artifacts, a runtime rollback must retain the revision-aware figure reader
  or restore prior post/snapshot references; a wholesale revert breaks new images.
- **HTTP budgets:** the default 15-second deadline now spans headers and streamed
  body consumption for text, JSON and bytes. All body types default to an 8 MB
  decoded-byte bound, overridable per call; Daily Snow external stills retain
  their 3 MB limit. Limits are checked before buffering the rest of the response;
  rejected responses and probe bodies are cancelled. Deadline rejection does not
  depend on a cooperative producer. Diagnostics record one call with full elapsed
  time and the HTTP status when headers arrived, even if the body failed.

**Validation:** seven focused regression cases failed against the pre-change
application code (same-attempt reservation rollback for both AI features, the
forecast-window probe, rewrite image isolation, and three stalled-body readers).
After rebasing onto `c6e1d02` (preserving the snowfall legend/source-line
changes and both appended note sections), **310 tests across 23 files** (including a regression
for the in-progress forecast bar raised in AI review, which failed before its fix), `npm run typecheck`,
`npm run build`, `npm run smoke`, and `git diff --check` pass. Smoke exercised
nine static pages, navigation payloads, API methods, local KV, share PNGs/metadata
and HEAD in workerd, using temporary local state that the script removed. No
browser layout checks were run because no layout or styling changed. No live
upstream/model requests, paid inference or production operations were run.

**Existing files touched:**

- `src/lib/store.ts`: independent attempt/publication ordering and history merge.
- `src/lib/recommend/index.ts`: completion timestamps and ordered rule-based output.
- `src/lib/types.ts`: optional hourly forecast data and recommendation completion.
- `src/lib/sources/nws.ts`: retain the adapter's unrounded hourly allocation.
- `src/lib/dailysnow/digest.ts`: bounded totals, coverage and estimate provenance.
- `src/lib/dailysnow/index.ts`: content-addressed still writes and references.
- `src/lib/http.ts`: full-response deadlines, streaming limits and cancellation.
- `src/worker/daily-snow-figure.ts`: revision lookup, validation and cache policy.
- `src/worker/fetch.ts`: pass the figure revision query to the reader.
- `test/dailysnow.test.ts`: forecast/rewrite regressions and updated publication assertions.
- `test/sources.test.ts`: hourly allocation, zero and missing-value coverage.
- `test/worker.test.ts`: revision routes, legacy reads, immutable caching and HEAD.
- `README.md`: collection guarantees, budgets, forecast behavior and artifact storage.
- `docs/IMPLEMENTATION_NOTES.md`: this implementation record and rollout limits.

**New files:** `test/http.test.ts` and `test/publication-merge.test.ts` cover
response budgets/cancellation and AI publication interleavings respectively.
