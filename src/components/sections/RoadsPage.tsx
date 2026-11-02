"use client";

import { useState } from "react";
import type { ApiSource, ReportResponse, ResortReport, RoadNotice, RoadsPayload, TravelTimesPayload, WebcamsPayload } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";
import { SourceLine } from "../ui";

function Notices({ notices, canyon }: { notices: RoadNotice[]; canyon: "LCC" | "BCC" }) {
  const list = notices.filter((n) => n.canyon === canyon || n.canyon === "both");
  if (!list.length) return <p className="muted">No notices from available feeds.</p>;
  const order = { critical: 0, warning: 1, info: 2 };
  return (
    <ul className="notices">
      {[...list].sort((a, b) => order[a.severity] - order[b.severity]).map((n, i) => (
        <li key={i} className={`notice notice--${n.severity}`}>
          <strong>{n.title}</strong> {n.text}
          <span className="notice__meta">{n.source}{n.updatedAt ? ` · ${formatDenver(n.updatedAt)}` : ""}</span>
        </li>
      ))}
    </ul>
  );
}

function TravelTimes({ source, canyon, now }: { source: ApiSource; canyon: "LCC" | "BCC"; now: Date }) {
  const p = source.payload as TravelTimesPayload | null;
  if (!p) return <p className="muted">Travel times unavailable.</p>;
  const current = source.freshness === "current";
  const segs = p.segments.filter((s) => s.canyon === canyon);
  return (
    <div className={`travel ${current ? "" : "travel--stale"}`}>
      {!current && (
        <p className="travel__warning">
          Not live — UDOT’s latest measurement is from {p.newestMeasurementAt ? formatDenver(p.newestMeasurementAt, now) : "an unknown time"}
          {p.layerEditedAt ? ` (layer rewritten ${formatAge(p.layerEditedAt, now)}, but its measurement time and weekday fields are unchanged)` : ""}. Values cannot be verified as current.
        </p>
      )}
      <table className="travel-table">
        <thead>
          <tr>
            <th>Fixed segment</th>
            <th>Now</th>
            <th>Free flow</th>
            <th>mi</th>
          </tr>
        </thead>
        <tbody>
          {segs.map((s) => (
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
        <strong>{cam.title}</strong> — {cam.description}
        <span className="cam__time"> · image requested {formatDenver(new Date(bust).toISOString())}; UDOT does not publish capture time</span>
      </figcaption>
    </figure>
  );
}

export function RoadsPage({ report, now, loadedAt }: { report: ReportResponse; now: Date; loadedAt: number | null }) {
  const roads = report.sources.roads;
  const travel = report.sources.traveltimes;
  const cams = report.sources.webcams;
  const rp = roads.payload as RoadsPayload | null;
  const camP = cams.payload as WebcamsPayload | null;
  const notices = rp?.notices ?? [];
  // Resort-published road/parking information complements UDOT feeds.
  const parking = (["alta", "snowbird", "solitude", "brighton"] as const).flatMap((id) => {
    const r = report.sources[id].payload as ResortReport | null;
    const resort = report.sources[id].label;
    // Some feeds already name the resort ("Alta parking"); don't print "Alta Alta parking".
    return (r?.parking ?? []).map((p) => ({ ...p, name: p.name.toLowerCase().startsWith(resort.toLowerCase()) ? p.name : `${resort} ${p.name}` }));
  });
  const resortRoad = (["alta", "snowbird", "solitude", "brighton"] as const).flatMap((id) => {
    const r = report.sources[id].payload as ResortReport | null;
    return (r?.notices ?? [])
      .filter((n) => /road/i.test(n.title))
      .map((n) => ({ ...n, canyon: id === "alta" || id === "snowbird" ? "LCC" : "BCC", source: report.sources[id].label }) as RoadNotice);
  });
  const all = [...notices, ...resortRoad];
  // Refresh camera images with each report poll (once a minute).
  const bust = Math.floor((loadedAt ?? now.getTime()) / 60_000) * 60_000;

  return (
    <section className="page page--roads">
      <header className="page__header">
        <h1>Canyon roads</h1>
        <p className="page__sub">Road notices, UDOT travel times and highway cameras for Little and Big Cottonwood Canyons.</p>
      </header>
      <div className="roads">
        {(["LCC", "BCC"] as const).map((c) => (
          <section key={c} className="canyon" aria-label={c === "LCC" ? "Little Cottonwood Canyon" : "Big Cottonwood Canyon"}>
            <div className="canyon__info">
              <h2>{c === "LCC" ? "Little Cottonwood · SR-210" : "Big Cottonwood · SR-190"}</h2>
              <Notices notices={all} canyon={c} />
              <TravelTimes source={travel} canyon={c} now={now} />
            </div>
            <div className="canyon__cam">
              {camP ? (
                camP.cameras.filter((cam) => cam.canyon === c).map((cam) => <Cam key={cam.id} cam={cam} bust={bust} />)
              ) : (
                <div className="cam__missing">Webcams unavailable ({cams.freshnessNote})</div>
              )}
            </div>
          </section>
        ))}
      </div>
      {parking.length > 0 && (
        <section className="parking" aria-labelledby="parking-heading">
          <h2 id="parking-heading">Parking</h2>
          <ul>
            {parking.map((p, i) => (
              <li key={i}><span>{p.name}</span> <strong>{p.status}</strong></li>
            ))}
          </ul>
        </section>
      )}
      {rp && rp.partialFailures.length > 0 && <p className="page__note">Feeds not included this check: {rp.partialFailures.join(" | ")}</p>}
      <div className="source-lines">
        <SourceLine source={roads} now={now} reportLabel="Road notices" />
        <SourceLine source={travel} now={now} reportLabel="Travel times measured" />
      </div>
    </section>
  );
}
