"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDenver } from "@/lib/time";
import { isSnowPlume } from "@/lib/dailysnow/plume";
import type { ApiDailySnow, DailySnowSectionId, ReportResponse } from "@/lib/types";
import { prefetchArchivedPost, useArchivedPost } from "./archive";
import { Figure } from "./figures";
import { HistoryRail } from "./HistoryRail";
import { PHASE_LABEL, postDate } from "./labels";

const SECTION_TITLE: Record<DailySnowSectionId, string> = { update: "Today", "short-term": "Next Few Days", extended: "Extended Forecast" };
/** Display names by Workers AI model id suffix (see recommend/llm.ts). */
const MODEL_NAME: Record<string, string> = { "glm-5.3-flash": "GLM 5.3 Flash", "gpt-oss-120b": "gpt-oss-120b" };
const modelName = (id: string) => MODEL_NAME[id.split("/").pop() ?? ""] ?? id;

function Eyebrow({ post, now, archived }: { post: ApiDailySnow; now: Date; archived: boolean }) {
  return (
    <div className="dailysnow__meta">
      <span className="eyebrow">
        Daily Snow<span className="badge badge--ai">AI</span> · {postDate(post.date)} · {PHASE_LABEL[post.phase]}
      </span>
      <span className="dailysnow__posted">
        Posted {formatDenver(post.generatedAt, now)}
        {archived ? " · Archive" : (post.outdated || post.failing) && (
          <span className="dailysnow__warn">{post.outdated ? " · Outdated" : ""}{post.failing ? " · Today's post failed" : ""}</span>
        )}
      </span>
    </div>
  );
}

function Article({ post }: { post: ApiDailySnow }) {
  const referenced = new Set(post.sections.flatMap((s) => s.paragraphs.map((p) => p.figure)));
  const supplemental = Object.values(post.figures).filter((f) => isSnowPlume(f.id) && !referenced.has(f.id));
  return (
    <div className="dailysnow__article">
      {post.sections.map((s) => (
        <section key={s.id} className="dailysnow__section">
          <h2>{SECTION_TITLE[s.id]}</h2>
          {s.paragraphs.map((p, i) => (
            <div key={i}>
              <p>{p.text}</p>
              {p.figure && post.figures[p.figure] && <Figure figure={post.figures[p.figure]} postedAt={post.generatedAt} />}
            </div>
          ))}
        </section>
      ))}
      {supplemental.map((f) => <Figure key={f.id} figure={f} postedAt={post.generatedAt} />)}
    </div>
  );
}

function Footer({ post }: { post: ApiDailySnow }) {
  return (
    <p className="dailysnow__footer">
      AI-generated from NWS forecasts and discussion, University of Utah plumes and resort reports · {modelName(post.model)}. Check official forecasts and avalanche conditions before heading out.
    </p>
  );
}

/** Previous/next post links. Uses ?date= so the static section page needs no extra routes. Each post
    links its neighbors, so these walk the whole archive; the recent-posts list covers older posts
    written before the links existed. */
function ArchiveNav({ post, onPick }: { post: ApiDailySnow; onPick: (date: string | null) => void }) {
  const i = post.archive.findIndex((a) => a.date === post.date);
  const older = post.older ?? (i >= 0 ? post.archive[i + 1] : post.archive.find((a) => a.date < post.date));
  const newer = post.newer ?? (i > 0 ? post.archive[i - 1] : null);
  const intent = (date: string) => ({ onPointerEnter: () => prefetchArchivedPost(date), onFocus: () => prefetchArchivedPost(date) });
  return (
    <nav className="dailysnow__nav" aria-label="Daily Snow archive">
      {older ? <button type="button" onClick={() => onPick(older.date)} {...intent(older.date)}>← {postDate(older.date)}: {older.title}</button> : <span />}
      {newer && <button type="button" onClick={() => onPick(newer.date)} {...intent(newer.date)}>{postDate(newer.date)}: {newer.title} →</button>}
    </nav>
  );
}

function readDateParam(): string | null {
  if (typeof window === "undefined") return null;
  const d = new URLSearchParams(window.location.search).get("date");
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/** Daily Snow page: the full post with figures and archive links. */
export function DailySnowPage({ report, now }: { report: ReportResponse; now: Date }) {
  // Read ?date= on the first render: this page only mounts in the browser, after the report
  // loads (SectionView renders a placeholder until then), so a deep link never shows the live post first.
  const [date, setDate] = useState<string | null>(readDateParam);
  const current = report.dailySnow ?? null;
  /** The archived post being picked, or null while the live post is wanted. */
  const viewed = date && date !== current?.date ? date : null;
  const archived = useArchivedPost(viewed);
  const wanted = viewed ? archived.post : current;
  // While a pick loads, keep the post already on screen instead of swapping in a placeholder.
  const [shown, setShown] = useState(wanted);
  if (wanted && wanted !== shown) setShown(wanted);
  const loading = viewed !== null && archived.loading;
  const post = wanted ?? (loading ? shown : null);

  const pick = (picked: string | null) => {
    const d = picked === current?.date ? null : picked; // the live post has no ?date=
    setDate(d);
    const url = new URL(window.location.href);
    if (d) url.searchParams.set("date", d);
    else url.searchParams.delete("date");
    window.history.replaceState(window.history.state, "", url);
    window.scrollTo?.(0, 0);
  };

  if (!post) {
    return (
      <section className="page page--dailysnow">
        <div className="dailysnow">
          <header className="dailysnow__header">
            <span className="eyebrow">Daily Snow<span className="badge badge--ai">AI</span></span>
            <h1 className="dailysnow__title">{viewed ? (archived.error ? "Post not available" : "Loading…") : "Waiting for the first post"}</h1>
          </header>
          <p className="muted">{archived.error ?? "An AI-written snow forecast is posted every morning at 6 AM."}</p>
          {date && <button type="button" className="dailysnow__back" onClick={() => pick(null)}>Back to the latest post</button>}
        </div>
      </section>
    );
  }
  return (
    <section className="page page--dailysnow">
      <div className="dailysnow-layout">
        <HistoryRail live={current} viewed={viewed} onPick={pick} onIntent={prefetchArchivedPost} />
        <article className="dailysnow" aria-label="Daily Snow" aria-busy={loading || undefined}>
          <header className="dailysnow__header">
            <Eyebrow post={post} now={now} archived={post.date !== current?.date} />
            <h1 className="dailysnow__title">{post.title}</h1>
            <p className="dailysnow__summary">{post.summary}</p>
          </header>
          <Article post={post} />
          <Footer post={post} />
          <ArchiveNav post={post} onPick={pick} />
        </article>
      </div>
    </section>
  );
}

/** Compact strip for the Snowfall page, above the resort pick. */
export function DailySnowTeaser({ post, now }: { post: ApiDailySnow | null | undefined; now: Date }) {
  if (!post) return null;
  return (
    <Link href="/daily-snow" className="dailysnow-teaser" aria-label={`Daily Snow: ${post.title}`}>
      <span className="eyebrow">
        Daily Snow<span className="badge badge--ai">AI</span> · {postDate(post.date)}{post.outdated ? " · Outdated" : ""}
      </span>
      <strong className="dailysnow-teaser__title">{post.title}</strong>
      <span className="dailysnow-teaser__summary">{post.summary}</span>
      <span className="dailysnow-teaser__more">Read →</span>
      <span className="dailysnow-teaser__time">Posted {formatDenver(post.generatedAt, now)}</span>
    </Link>
  );
}
