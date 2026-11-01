# Implementation notes

Findings from implementation on 2026-10-30, verified against the live sources and current docs. The brief (`IMPLEMENTATION_BRIEF.md`) is unchanged. Where a finding refines its preliminary reconnaissance, it is recorded here.

## Scope changes after v1 (2026-11-01, requested by the owner)

These supersede the brief where they differ; the brief itself is unchanged.

- **Park City, Deer Valley and Snowbasin removed** (adapters, fixtures, regional rows). The regional slide lists only the four Cottonwoods resorts. Old snapshot records of removed sources are dropped on the next write.
- **Plumes: two panels per station.** Only Accumulated Snow and Snow-to-Liquid Ratio are shown, for Alta-Collins and Silver Lake Brighton (four panels). They are cropped server-side. This replaces the brief's "show the original charts unmodified" for this product; the crop is pixel-for-pixel, apart from the UTC tick labels being cut off.
- **Plume time axis in Mountain Time.** Verified: the charts' x-axis is UTC. Tick labels read "00z 01-Nov", and the title reads "Initialized 0000 UTC 01 Nov 2026". The axis spans exactly init → init + 240 h (`F240` in the file name; first and last ticks sit on the frame edges). The UTC labels are cropped off, and the slide draws a Mountain Time axis: day names centered on each local day, dashed local-midnight lines, and a "now" line. Reason: 00Z is 5 PM MST (6 PM MDT) the *previous* day, so "00z 02-Nov" is the evening of Nov 1 locally, an easy misread. The plot's own gridlines stay at 00Z/12Z (5 AM/5 PM MST); the dashed lines are the local day boundaries.
- **Slide order:** regional, weather, plumes, canyon roads, then the four resorts.
- **Resort webcams** on each resort slide (below).

## Platform versions (verified 2026-10-30)

- `next@16.4.3` (latest), `react@19.3.1`, `@opennextjs/cloudflare@1.20.15` (peer range `next >=15.5.28 <16 || >=16.4.1`; the adapter changelog adds Next 16.4 support and Turbopack builds), `wrangler@4.156.0`, TypeScript 7.0.2.
- Custom Worker entry follows the current OpenNext docs: `worker.ts` imports `./.open-next/worker.js`, exports `fetch: handler.fetch` plus `scheduled`, and `wrangler.jsonc` `main` points at `worker.ts`.
- Next 16 route-segment config: `dynamic = "force-dynamic"` remains valid because Cache Components is not enabled.
- `npm audit` reports advisories in `glob`/`minimatch`, pulled in by the adapter's build-time CLI. They are not part of the deployed Worker.

## Storage decision

The brief asks to store "the latest successful normalized data per source in KV". Each source has its own record (payload, `sourceUpdatedAt`, `lastSuccessfulFetchAt`, `lastAttemptAt`, status, error, consecutive failures, upstream diagnostics). All records live inside **one** KV value (`snapshot:v1`), for three reasons:

- One write per run (288/day) fits KV's free-tier write limit (1,000/day). Per-source keys would need about 3,500 writes/day.
- The API serves a mutually consistent snapshot with a single read.
- Only the single cron writes, so read-modify-write has no concurrent writers.

## Sources: final integrations

| Source | Endpoint used | Format | Report time used | Notes |
| --- | --- | --- | --- | --- |
| Alta | `https://www.alta.com/lift-terrain-status` | `window.Alta = {…}` JSON embedded in HTML | `conditions.dated_at` (Denver local) | Gives 12 h / 24 h / storm / base / YTD, base/mid/top temps, one wind value with no stated site (shown as such), per-lift status and notes, terrain areas, access gates, road/parking alerts. No overnight or 48 h field, so those show as n/a. |
| Snowbird | `https://api.snowbird.com/api/v1/dor/drupal/snow-reports`, `…/dor/drupal/lifts`, `…/terrains`, `…/dor/sensors`, `…/dor/drupal/parking` | JSON (the snowbird.com Gatsby site loads these client-side; the page HTML has no data) | Report `updated` epoch (publish time); the report's own `date` label is shown too | `overnight_amount` comes from the latest Primary report. 24/48/72 h and 7-day totals are Snowbird's `computed` rolling values relative to fetch time, labelled as such. No storm total. Sensor times are "MM DD HHMM" without a year, interpreted as Denver local. Lifts, terrain, sensors, and parking degrade independently (`missingSections`). |
| Solitude | `https://v4.mtnfeed.com/resorts/solitude.json` (public widget config: resort id 65 + public bearer token), then `https://mtnpowder.com/feed/v3.json` | JSON (Mountain Powder feed behind the site's conditions widget) | `SnowReport.LastUpdate` | Uses the preferred (mid) reporting location: since-lifts-closed / 24 / 48 / 72 h / 7-day, storm total, base, season. Named terrain is listed trail by trail within named areas (Honeycomb Canyon, Evergreen Peak, …), never inferred from counts. The token is read each run and redacted from diagnostics; the API never exposes it. |
| Brighton | `https://www.brightonresort.com/api/reportpal?resortName=br&useReportPal=true` | JSON (same-origin endpoint behind the "Loading…" fields) | `updated` | Overnight / 12 / 24 / 48 / 72 h / 7-day / season / base, per-lift status, comments. No temperature or wind in this feed (the site uses NOAA), so those point to the weather slide. No storm total. |
| Utah plumes | `https://weather.utah.edu/index.php?t=ensgefsds&d=PL&r=CLN` and `r=PKCU1` | HTML: "Current selection … NNNNNNNNNN initialization." plus the SciAnimator `images_vis` list | Model run (UTC) from the run code | Without a `runcode` parameter the page serves the latest run. The chart PNG is checked with HEAD (status, content type, Last-Modified) before acceptance. Original charts are shown unmodified (82-member GEFS + ECMWF ENS, full 10-day range, percentiles). Station codes verified against the station menu: CLN = Alta-Collins, PKCU1 = Silver Lake Brighton. |
| NWS | `https://api.weather.gov/gridpoints/SLC/108,167` (Alta) and `/110,168` (Brighton), plus `/forecast` text | JSON | Grid `updateTime` | Snowfall, QPF, snow level, temperature, wind, gust, and PoP, resampled hourly into Denver 6 AM/6 PM day/night blocks (DST-safe; verified across the 2026-11-01 change), 6-hour snow bars, and the next ≥1″ storm episode. |
| Roads | UDOT Cottonwood Canyons site (`/road-information/`: header alerts and mouth-of-canyon sign blocks); UDOT overhead-sign messages relayed by `api.snowbird.com/api/v1/dor/traffic` (statewide, filtered to SR-190/209/210 and Wasatch Blvd); UDOT pass conditions relayed by `brightonresort.com/api/reportpal-roads`; Snowbird `dor/drupal/roads` ("Highway SR-210" row only; other rows are CMS test entries); optional UDOT Traffic API `event` (needs `UDOT_API_KEY`) | Mixed | Per notice when the source supplies one | Severity: closure/avalanche/interlodge wording counts as critical, which shows in the persistent banner. Seasonal gate notices (for example, the Guardsman Pass closure) show on the roads slide but don't trigger the banner. Resort road/parking statuses (Alta road status, parking at all four resorts) are shown too. |
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
- Production fetch behavior from Cloudflare's network (as opposed to local workerd) is **unverified until deployment**. In particular, resort CDNs may treat Cloudflare egress differently. Check `wrangler tail` after the first cron.
