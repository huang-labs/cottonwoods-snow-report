import type { ApiSource, Lift, NamedTerrain, ResortCam, ResortCamsPayload, ResortReport, SnowfallSet } from "@/lib/types";
import { formatAge, formatDenver } from "@/lib/time";
import { MetricValue, SourceLine, StatusDot, Unavailable } from "../ui";

const SNOW_ORDER: Array<keyof SnowfallSet> = ["overnight", "h12", "h24", "h48", "h72", "d7", "storm", "season"];

const STATUS_ORDER = { open: 0, hold: 1, scheduled: 2, unknown: 3, closed: 4 } as const;

function byStatus<T extends { status: Lift["status"] }>(items: T[]) {
  return [...items].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

function TerrainList({ terrain }: { terrain: NamedTerrain[] }) {
  const open = terrain.filter((t) => t.status === "open" || t.status === "hold" || t.status === "scheduled");
  const closed = terrain.filter((t) => !open.includes(t));
  return (
    <div className="terrain">
      {open.length === 0 && <p className="muted">No named terrain reported open.</p>}
      <ul className="chips">
        {byStatus(open).map((t) => (
          <li key={`${t.kind}-${t.name}`} className={`chip chip--${t.status}`}>
            <StatusDot status={t.status} /> {t.name} <span className="chip__raw">{t.rawStatus}</span>
          </li>
        ))}
      </ul>
      {closed.length > 0 && (
        <p className="closed-list">
          <span className="muted">Closed ({closed.length}): </span>
          {closed.map((t) => t.name).join(" · ")}
        </p>
      )}
    </div>
  );
}

const CAM_STALE_MS = 3 * 3_600_000;

/** Same image URL each poll would be served from browser cache; bust it once a minute. */
function withBust(url: string, bust: number) {
  const u = new URL(url);
  u.searchParams.set("_", String(bust));
  return u.toString();
}

function Cam({ cam, now, bust }: { cam: ResortCam; now: Date; bust: number }) {
  if (cam.kind === "youtube") {
    return (
      <figure className="rcam">
        <div className="rcam__frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${cam.videoId}?autoplay=1&mute=1&controls=0&playsinline=1&rel=0`}
            title={`${cam.title} live camera`}
            allow="autoplay; encrypted-media"
            loading="lazy"
          />
        </div>
        <figcaption>
          <strong>{cam.title}</strong> <span className="muted small">· live stream (player shows live/offline status)</span>
        </figcaption>
      </figure>
    );
  }
  const age = cam.capturedAt ? now.getTime() - new Date(cam.capturedAt).getTime() : null;
  return (
    <figure className="rcam">
      <div className="rcam__frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={withBust(cam.imageUrl, bust)} alt={`${cam.title} webcam`} />
      </div>
      <figcaption>
        <strong>{cam.title}</strong>{" "}
        {cam.capturedAt === null ? (
          <span className="muted small">· capture time not published</span>
        ) : age !== null && age > CAM_STALE_MS ? (
          <span className="small source-line__error">· not updating — last image {formatDenver(cam.capturedAt, now)}</span>
        ) : (
          <span className="muted small">· image {formatAge(cam.capturedAt, now)}</span>
        )}
      </figcaption>
    </figure>
  );
}

function Cams({ resortId, cams, now, loadedAt }: { resortId: string; cams: ApiSource | undefined; now: Date; loadedAt: number | null }) {
  const p = cams?.payload as ResortCamsPayload | null | undefined;
  const mine = p?.cameras.filter((c) => c.resort === resortId) ?? [];
  const bust = Math.floor((loadedAt ?? now.getTime()) / 60_000) * 60_000;
  return (
    <div className="panel panel--cams">
      <h2>Webcams</h2>
      {mine.length ? (
        mine.map((c) => <Cam key={c.title} cam={c} now={now} bust={bust} />)
      ) : (
        <p className="muted">No {resortId === "alta" ? "Alta" : "resort"} webcam available right now{p?.failures.some((f) => f.startsWith(resortId)) ? " (camera page check failed)" : ""}.</p>
      )}
    </div>
  );
}

export function ResortSlide({
  source,
  now,
  cams,
  loadedAt = null,
}: {
  source: ApiSource;
  now: Date;
  cams?: ApiSource;
  loadedAt?: number | null;
}) {
  const r = source.payload as ResortReport | null;
  if (!r) {
    return (
      <section className="slide slide--resort">
        <header className="slide__header">
          <h1>{source.label}</h1>
        </header>
        <Unavailable source={source} what={`${source.label} report`} />
        <SourceLine source={source} now={now} />
      </section>
    );
  }
  const shown = SNOW_ORDER.filter((k) => r.snowfall[k].state !== "unavailable");
  const missing = SNOW_ORDER.filter((k) => r.snowfall[k].state === "unavailable").map((k) => r.snowfall[k].label);

  return (
    <section className="slide slide--resort">
      <header className="slide__header slide__header--row">
        <h1>{r.resort}</h1>
        <div className="slide__meta">
          {r.operatingStatus && <span className="pill">{r.operatingStatus}</span>}
          <span>
            {r.reportTimeLabel}: <strong>{formatDenver(r.reportTime, now)}</strong>
          </span>
        </div>
      </header>

      <div className="resort-grid">
        <div className="panel panel--snow">
          <h2>Snowfall</h2>
          <div className="snow-cells">
            {shown.map((k) => (
              <div key={k} className={`snow-cell ${k === "overnight" || k === "h24" ? "snow-cell--hero" : ""}`}>
                <MetricValue m={r.snowfall[k]} size={k === "overnight" || k === "h24" ? "xl" : "lg"} />
                <div className="snow-cell__label">{r.snowfall[k].label}</div>
                {r.snowfall[k].note && <div className="snow-cell__note">{r.snowfall[k].note}</div>}
              </div>
            ))}
            <div className="snow-cell">
              <MetricValue m={r.base} size="lg" />
              <div className="snow-cell__label">{r.base.label}</div>
              {r.base.note && <div className="snow-cell__note">{r.base.note}</div>}
            </div>
          </div>
          {missing.length > 0 && <p className="muted small">Not provided by {r.resort}: {missing.join(", ")}</p>}

          <h2>Weather observations</h2>
          {r.observations.length === 0 ? (
            <p className="muted">No temperature/wind observations in {r.resort}’s feed — see Mountain weather slide.</p>
          ) : (
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Temp</th>
                  <th>Wind</th>
                  <th>Gust / high</th>
                  <th>Observed</th>
                </tr>
              </thead>
              <tbody>
                {r.observations.map((o) => (
                  <tr key={o.location}>
                    <th scope="row">{o.location}</th>
                    <td><MetricValue m={o.temperature} size="md" /></td>
                    <td>
                      <MetricValue m={o.wind} size="md" /> {o.direction && <span className="muted">{o.direction}</span>}
                    </td>
                    <td><MetricValue m={o.gust} size="md" /></td>
                    <td className="small">{formatDenver(o.observedAt, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel panel--ops">
          <h2>
            Lifts{" "}
            {r.liftsOpen !== null && r.liftsTotal !== null && (
              <span className="muted">
                {r.liftsOpen}/{r.liftsTotal} open
              </span>
            )}
          </h2>
          {r.lifts ? (
            <ul className="lift-list">
              {byStatus(r.lifts).map((l) => (
                <li key={l.name} className={`lift lift--${l.status}`}>
                  <StatusDot status={l.status} />
                  <span className="lift__name">{l.name}</span>
                  <span className="lift__status">{l.rawStatus}</span>
                  {l.note && <span className="lift__note">{l.note}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Individual lift status unavailable{r.missingSections?.includes("lifts") ? " (lift feed failed)" : ""}.</p>
          )}

          <h2>Named terrain</h2>
          {r.terrain ? <TerrainList terrain={r.terrain} /> : <p className="muted">Named terrain status not provided by this source.</p>}

          {(r.notices.length > 0 || r.parking.length > 0) && <h2>Notices &amp; parking</h2>}
          <ul className="notices">
            {r.notices.map((n, i) => (
              <li key={i} className={`notice notice--${n.severity}`}>
                <strong>{n.title}:</strong> {n.text}
              </li>
            ))}
            {r.parking.map((p) => (
              <li key={p.name} className="notice notice--info">
                <strong>{p.name}:</strong> {p.status}
                {p.note ? ` — ${p.note}` : ""}
              </li>
            ))}
          </ul>
          {r.narrative && <p className="narrative">{r.narrative.length > 420 ? `${r.narrative.slice(0, 420)}…` : r.narrative}</p>}
          {r.missingSections && <p className="muted small">Sections unavailable this check: {r.missingSections.join(", ")}</p>}
        </div>

        <Cams resortId={source.id} cams={cams} now={now} loadedAt={loadedAt} />
      </div>
      <SourceLine source={source} now={now} reportLabel="Report time" />
    </section>
  );
}
