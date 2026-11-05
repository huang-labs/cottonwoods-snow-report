# Freshness and data semantics

[← README](../README.md)

Source freshness, publication status and the meaning of missing values. Code paths in this guide are relative to the repository root.

Collection recency, upstream report age and publication availability are separate. Source thresholds are intentionally different: a daily resort report and a travel measurement do not expire at the same age. `src/lib/report.ts` classifies sources; `src/lib/freshness.ts` owns their public labels, tones and explanations. API state names remain compatible (`stale` displays as “Updates delayed”, `time-unknown` as “Time unknown”).

| Badge | Treatment | Meaning |
| --- | --- | --- |
| Current | Green | Collected on schedule, and the upstream report time is within the source's window: resorts 26 h, NWS 12 h, NWS discussion/ensemble 18 h, plumes 30 h, travel times 30 min |
| Old report | Amber | Fetched recently, but the upstream report exceeds that source's window |
| Time unknown | Neutral | A recent collection succeeded, but the source publishes no time or its report time could not be established |
| Updates delayed | Amber | No successful fetch for more than 22 min, extended by a slower source's interval: NWS/travel times 32 min; plumes, ensemble and NWS discussion 47 min. The last good payload remains visible. This does not identify whether the source or collector is responsible. |
| Unavailable | Red | No usable collected payload is available |

Source badges live in page footers and resort-page headers. The Resorts page (`/`) shows no resort badges or resort footer; each timeline shows the resort's report time, and its footer is the NWS forecast's source line. The global required-feed banner groups unavailable and delayed feeds separately. A confirmed failed latest check is shown separately from freshness; recently collected data can remain Current while a subsequent check has failed. Source footers retain the source report time (America/Denver), last successful check and attribution. Measurement windows keep each source's own label; **0″**, **not reported** and **—** mean reported zero, an empty reported field and a measurement the source does not provide, respectively. On the Snowfall timeline a past day also distinguishes “no new morning report” (the resort was checked but hadn't published since the evening before) and “not recorded” (no morning check stored for that day); its screen-reader description names which.

Editorial content uses the same badge shape and semantic tones, with wording appropriate to its purpose:

| Surface | Rule and behavior |
| --- | --- |
| Resort pick | “Recommendation needs updating” (amber) when the target date changes (tomorrow after 2 PM Denver) or generation exceeds 12 h. “Updates failing” (red) after three consecutive failures. Retain the prose but remove the resort header's AI-pick badge for either state. |
| Latest Daily Snow | Always show edition date and posting time. Yesterday's edition is normal before 6 AM Denver; publication is pending during the 6–10 AM window. Show “Latest edition delayed” (amber), identically in teaser and article, when an expected edition is missing after retries/request budget are exhausted or the window closes. An in-flight final attempt can finish after 10 AM. An edition older than yesterday remains delayed overnight. |
| Quiet-day Daily Snow | No delay warning when usable resort/forecast inputs establish that no edition is expected under the existing season/snow activity gate. Missing or delayed inputs cannot establish an intentional pause. |
| Archived Daily Snow | Date and “Archive”, without a publication warning. The history rail calls the latest stored edition “Latest” with its date, never assumes it is today's. |

The API adds optional `dailySnow.publicationStatus` (`current`, `scheduled`, `pending`, `delayed`, `paused`) on the latest edition in `/api/report`; archive responses omit it. The existing `outdated` and `failing` fields remain for compatibility. Publication status is computed on reads using the schedule and shared activity rules; reads never collect sources or invoke AI. No additional KV keys or migrations are required.

Context-specific qualifications stay beside the information they qualify: camera stills older than 3 h have an amber “not updating” caption; unknown capture times and stream-player status remain explicit. UDOT camera request time is not capture time. Noncurrent travel measurements retain an amber “Not live” explanation and muted values. Resort road notices older than 24 h are omitted. Dashboard polling errors, or more than 3 min since the last successful response, produce a global connection banner. Ensemble AI inputs retain their stricter eligibility checks. These rules are independent of badge presentation.
