# Implementation notes

Findings from implementation on 2026-10-30, verified against the live sources and current docs. Where a finding refines the brief's (`IMPLEMENTATION_BRIEF.md`) preliminary reconnaissance, it is recorded here. The brief itself was revised once, for the phone/desktop-first change below.

## Scope changes after v1 (2026-11-01, requested by the owner)

These supersede the brief where they differ.

- **Static frontend + direct Worker** (2026-11-01): Next.js remains the authoring/build framework and exports `out/`; it no longer runs as a request-time server. OpenNext and its self-reference binding were removed. Workers Static Assets serves pages, JS, CSS, icons, and Next navigation payloads directly; `src/worker/` owns the report, plume, admin, Daily Snow archive/figure, and both live share-image endpoints with direct bindings. Cron, namespace, domain, source cadences, and snapshot schema are unchanged. The share image uses `@cf-wasm/og` with patched Satori/fflate versions and a precompiled HarfBuzz adapter for workerd. Local development builds the export and runs `wrangler dev --local`; frontend changes require a rebuild. CI runs a real workerd smoke test as well as unit tests and typechecking. Rebased onto `e237ef8` to retain Daily Snow, its preview metadata, resort browse-page redesign, and numerical ensemble guidance; validation passed 173 tests plus all nine static pages, both share PNGs, and per-section share metadata in workerd.

- **Phone/desktop-first navigation; the TV slideshow is a mode** (2026-11-01; the brief was revised to match). Each section is a static page (`/`, `/weather`, `/plumes`, `/traffic`, `/alta`, `/snowbird`, `/solitude`, `/brighton`) under a sticky navbar. The start dialog and the "autoplay on load" preference are gone, so a phone never lands in a rotating slideshow. **▶ Slideshow** in the navbar requests fullscreen from that click (browsers need a user gesture) and starts at the current section. Exit, Escape, or leaving fullscreen returns to the page of the slide that was showing. The TV bookmark is `?kiosk=1` (windowed until F or the Fullscreen control is pressed, as before). A saved `autoplay` value in older browser prefs is ignored. The report poller lives in the root layout's `AppShell`, so page changes don't refetch. On desktop each page fills the window below the navbar instead of scrolling as one long page, because the slide layouts (webcam and plume grids) size themselves to a fixed-height frame; below 900 px pages stack and scroll as before. Section pages share the site-wide live link-preview image; their titles are per section.

- **Park City, Deer Valley and Snowbasin removed** (adapters, fixtures, regional rows). The regional slide lists only the four Cottonwoods resorts. Old snapshot records of removed sources are dropped on the next write.
- **Plumes: two panels per station.** Only Accumulated Snow and Snow-to-Liquid Ratio are shown, for Alta-Collins and Silver Lake Brighton (four panels). They are cropped server-side. This replaces the brief's "show the original charts unmodified" for this product; the crop is pixel-for-pixel, apart from the UTC tick labels being cut off.
- **Plume time axis in Mountain Time.** Verified: the charts' x-axis is UTC. Tick labels read "00z 01-Nov", and the title reads "Initialized 0000 UTC 01 Nov 2026". The axis spans exactly init → init + 240 h (`F240` in the file name; first and last ticks sit on the frame edges). The UTC labels are cropped off, and the slide draws a Mountain Time axis: day names centered on each local day, dashed local-midnight lines, and a "now" line. Reason: 00Z is 5 PM MST (6 PM MDT) the *previous* day, so "00z 02-Nov" is the evening of Nov 1 locally, an easy misread. The plot's own gridlines stay at 00Z/12Z (5 AM/5 PM MST); the dashed lines are the local day boundaries.
- **Slide order:** regional, weather, plumes, canyon roads, then the four resorts.
- **Resort webcams** on each resort slide (below).
- **Per-source collection intervals** (2026-11-01): slow sources skip cron runs. NWS and travel times are collected every 15 min and plumes every 30 min; everything else every 5 min. Cost is unchanged (usage is a few percent of Workers Paid included limits); this saves about 80 upstream requests an hour, roughly 22% of the collector's requests, mostly to weather.utah.edu and api.weather.gov.

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

Discovered from each resort's own page on every run. Each resort is isolated: on failure, that resort keeps its previous cameras, and the failure is listed.

| Resort | Discovery | Cameras shown | Capture time |
| --- | --- | --- | --- |
| Alta | `window.Alta.weather.mountainCams` on `alta.com/weather` | Snow Stake (Collins), Albion Basin | Image `Last-Modified`. Albion Basin (prismcam) sends a Last-Modified about an hour in the future, which is rejected ("capture time not published"). Alta publishes no lift-line camera. |
| Snowbird | Webcam cards on `snowbird.com/the-mountain/webcams/view-all-webcams/` (name + `manage.hdrelay.com/snapshot/<id>` image) | Tram Bullpen (the tram lift line), Snowstake | Image `Last-Modified`. **No Gad Zoom camera is published** on Snowbird's site (cards: Snowstake, Peruvian Gulch, Mineral Basin, Little Cloud, Tram Bullpen; plus Hidden Peak 360 pages). hdrelay returns 500 to HEAD, so the probe falls back to a ranged GET. |
| Solitude | YouTube live embeds on the webcams page; titles from YouTube oEmbed | Moonbeam Lift Line, Apex Express and Sunrise Lift Lines | Live stream. The embedded player shows live/offline status. |
| Brighton | YouTube live embeds on `brightonresort.com/conditions` | Milly Express, Parking Lot | Live stream. |

Stream titles come from oEmbed, not page layout. On Solitude's page each caption follows its player, so reading the preceding caption mislabels every stream by one. Titles are cached in the payload, so an unchanged page costs no oEmbed calls. Live-stream thumbnails were rejected: they carry no capture time, and an offline stream serves its custom promo still. Images that become unreachable are dropped. Images older than 3 h are labelled "not updating".

### Travel-time freshness (resolved: not shown as live)

`LATEST_LOCAL_DATETIME` is 2025-03-04 (a Tuesday) on every segment, and `DAY_OF_WEEK` is "Tuesday". Meanwhile `EditDate` advances every five minutes, and some `Current_Travel_Time__min_` values drift between samples (for example, Alta → P&R 13 → 15 min). Because the measurement-time field is frozen, the values cannot be verified as current measurements. The UI shows them struck through under "Not live … cannot be verified as current".

The field's time zone is undocumented. It is read as Denver wall time stored as UTC (Esri "local" convention), and any resulting time in the future is rejected. If UDOT resumes updating this field in season, values within 30 minutes become "Current" automatically. Verify that interpretation against the UDOT dashboard during the first storm.

### UDOT developer API

The documentation (2026-10-30) confirms a developer key is required (`key` query parameter, registered account) and throttling at 10 calls per 60 s. One `event` call per five-minute run is well within that. No key was available, so the integration is implemented but unverified against live responses. The roads feed reports "UDOT Traffic API events: not configured" until a key is set.

## Release status against the brief's v1 requirements

- Real snowfall for all four primary resorts: **working** (Alta, Snowbird, Solitude, Brighton all collect and validate from the Worker runtime under local workerd).
- Latest Utah plumes: **working** (dynamic run discovery plus image check).
- Degradable: NWS, roads, UDOT webcams and resort webcams work. Travel times are collected but flagged not live. UDOT API events need a key.
- Deployed 2026-11-01 to https://cottonwoods-snow-report.huang.mx (see README → Production). First production cron (18:10 UTC): all 10 sources collected successfully from Cloudflare's network, with no resort CDN blocking. That run cropped a new plume run and used 1.5 s CPU (3.1 s wall time). The first tick after the cron trigger was created (18:00) did not fire; schedules took a few minutes to become active.

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

- **Structure:** a 2–5 word title, a 2–3 sentence Summary, then "Update" or "Short Term Forecast", and "Extended Forecast" only when there is something to say. The schema enforces that order; roads and resort choice are left to the resort pick.
- **Storm-cycle phase:** posts read differently before, during and after a storm and in quiet spells. The phase is computed in code (`phaseOf`: ≥4″ in the next 12 h, or ≥2″ next 12 h with ≥2″ reported in 24 h = storm; ≥4″ reported in 48 h/storm or ≥2″ in 24 h = post-storm; ≥3″ in 72 h = pre-storm; else quiet) and the prompt tells the model what each phase covers.
- **Forecast verification** ("we got exactly 5.9″"): each post stores its forecast totals; the next five posts' prompts include them so a recap can compare forecast with reported totals.
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
