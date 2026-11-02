"use client";

import { useState } from "react";
import type { ApiSource, ReportResponse, ResortReport, RoadNotice, RoadsPayload, TravelSegment, TravelTimesPayload, WebcamsPayload } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";
import { NoticeList, SourceLine } from "../ui";

type Canyon = "LCC" | "BCC";
const RESORTS = ["alta", "snowbird", "solitude", "brighton"] as const;
const CANYONS: Array<{ id: Canyon; name: string; route: string }> = [
  { id: "LCC", name: "Little Cottonwood", route: "SR-210 · Alta and Snowbird" },
  { id: "BCC", name: "Big Cottonwood", route: "SR-190 · Solitude and Brighton" },
];
/** A resort's road notice older than this is history, not status. */
const RESORT_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The routes most people check: every downhill segment, and uphill from the first
 * listed origin to each resort (not to the park-and-ride lots). The rest stay one
 * click away.
 */
function isMainRoute(s: TravelSegment, segs: TravelSegment[]) {
  if (s.direction !== "Up") return true;
  const origin = segs.find((x) => x.direction === "Up")?.from;
  return s.from === origin && !/park/i.test(s.to);
}

function TravelTimes({ source, canyon, now }: { source: ApiSource; canyon: Canyon; now: Date }) {
  const [all, setAll] = useState(false);
  const p = source.payload as TravelTimesPayload | null;
  if (!p) return <p className="muted">Travel times unavailable.</p>;
  const current = source.freshness === "current";
  const segs = p.segments.filter((s) => s.canyon === canyon);
  const main = segs.filter((s) => isMainRoute(s, segs));
  const shown = all || main.length === 0 ? segs : main;
  return (
    <div className={`travel ${current ? "" : "travel--stale"}`}>
      <h3>Travel times</h3>
      {!current && (
        <p className="travel__warning">
          Not live — UDOT’s latest measurement is from {p.newestMeasurementAt ? formatDenver(p.newestMeasurementAt, now) : "an unknown time"}.
        </p>
      )}
      <table className="travel-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Now</th>
            <th>Free flow</th>
            <th>mi</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.name}>
              <th scope="row">
                {s.from} → {s.to} <span className="travel__dir">{s.direction === "Up" ? "uphill" : "downhill"}</span>
              </th>
              <td className="travel__now">{s.currentMin === null ? "—" : `${s.currentMin} min`}</td>
              <td>{s.freeFlowMin === null ? "—" : `${s.freeFlowMin} min`}</td>
              <td>{s.distanceMi ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {main.length > 0 && main.length < segs.length && (
        <button type="button" className="travel__toggle" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show main routes" : `Show all ${segs.length} segments`}
        </button>
      )}
    </div>
  );
}

function Cam({ cam, bust }: { cam: WebcamsPayload["cameras"][number]; bust: number }) {
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const failed = failedAt === bust;
  return (
    <figure className="cam">
      {cam.available && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${cam.imageUrl}?t=${bust}`} alt={cam.description} onError={() => setFailedAt(bust)} />
      ) : (
        <div className="cam__missing">Camera image unavailable</div>
      )}
      <figcaption>
        <strong>{cam.title}</strong> <span className="cam__time">· requested {formatDenver(new Date(bust).toISOString())}</span>
      </figcaption>
    </figure>
  );
}

export function RoadsPage({ report, now, loadedAt }: { report: ReportResponse; now: Date; loadedAt: number | null }) {
  const roads = report.sources.roads;
  const travel = report.sources.traveltimes;
  const cams = report.sources.webcams;
  const rp = roads.payload as RoadsPayload | null;
  const tp = travel.payload as TravelTimesPayload | null;
  const camP = cams.payload as WebcamsPayload | null;
  // Resort-published road status complements the UDOT feeds while it's recent.
  const resortRoad = RESORTS.flatMap((id) => {
    const r = report.sources[id].payload as ResortReport | null;
    return (r?.notices ?? [])
      .filter((n) => /road/i.test(n.title))
      .filter((n) => !n.updatedAt || now.getTime() - Date.parse(n.updatedAt) < RESORT_NOTICE_MAX_AGE_MS)
      .map((n) => ({ ...n, canyon: id === "alta" || id === "snowbird" ? "LCC" : "BCC", source: report.sources[id].label }) as RoadNotice);
  });
  const notices = [...(rp?.notices ?? []), ...resortRoad];
  // Parking by resort. Drop a repeated resort name ("Alta parking" under Alta).
  const parking = RESORTS.map((id) => {
    const label = report.sources[id].label;
    const r = report.sources[id].payload as ResortReport | null;
    const lots = (r?.parking ?? []).map((p) => {
      const name = p.name.toLowerCase().startsWith(label.toLowerCase()) ? p.name.slice(label.length).trim() : p.name;
      return { ...p, name: name ? name[0].toUpperCase() + name.slice(1) : "Parking" };
    });
    return { id, label, lots };
  }).filter((g) => g.lots.length > 0);
  // Refresh camera images with each report poll (once a minute).
  const bust = Math.floor((loadedAt ?? now.getTime()) / 60_000) * 60_000;

  return (
    <section className="page page--roads">
      <header className="page__header">
        <h1>Canyon roads</h1>
        <p className="page__sub">Road status, UDOT travel times and highway cameras for Little and Big Cottonwood Canyons.</p>
      </header>
      <div className="roads">
        {CANYONS.map((c) => {
          const list = notices.filter((n) => n.canyon === c.id || n.canyon === "both");
          return (
            <section key={c.id} className="canyon" aria-labelledby={`canyon-${c.id}`}>
              <header>
                <h2 id={`canyon-${c.id}`}>{c.name}</h2>
                <p className="canyon__route">{c.route}</p>
              </header>
              {camP ? (
                camP.cameras.filter((cam) => cam.canyon === c.id).map((cam) => <Cam key={cam.id} cam={cam} bust={bust} />)
              ) : (
                <div className="cam__missing">Webcams unavailable ({cams.freshnessNote})</div>
              )}
              <div className="canyon__status">
                <p className="eyebrow">Road status</p>
                {list.length ? <NoticeList notices={list} now={now} /> : <p className="muted">No notices from the available feeds.</p>}
              </div>
              <TravelTimes source={travel} canyon={c.id} now={now} />
            </section>
          );
        })}
      </div>
      {parking.length > 0 && (
        <section className="parking" aria-labelledby="parking-heading">
          <h2 id="parking-heading">Parking</h2>
          <div className="parking__grid">
            {parking.map((g) => (
              <div key={g.id} className="parking__resort">
                <h3>{g.label}</h3>
                <dl>
                  {g.lots.map((p, i) => (
                    <div key={i}>
                      <dt>{p.name}</dt>
                      <dd>{p.status}</dd>
                      {p.note && <dd className="parking__note">{p.note.trim()}</dd>}
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="page__notes">
        <p className="page__note">
          Camera images refresh each minute. UDOT doesn’t publish capture times, so the time shown is when the image was requested.
        </p>
        {tp && travel.freshness !== "current" && tp.layerEditedAt && (
          <p className="page__note">
            UDOT rewrote the travel-time layer {formatAge(tp.layerEditedAt, now)}, but its measurement time and weekday fields are unchanged, so the values can’t be verified as current.
          </p>
        )}
        {rp && rp.partialFailures.length > 0 && <p className="page__note">Feeds not included this check: {rp.partialFailures.join(" | ")}</p>}
      </div>
      <div className="source-lines">
        <SourceLine source={roads} now={now} reportLabel="Road notices" />
        <SourceLine source={travel} now={now} reportLabel="Travel times measured" />
      </div>
    </section>
  );
}
