
import { useId, useRef, useState } from "react";
import type { ApiDailySnow, DailySnowPhase } from "@/lib/types";
import { PHASE_LABEL, postDate } from "./labels";

/** How many posts the list shows: the live post plus the archive before it. */
const HISTORY_COUNT = 3;

type Entry = { date: string; title: string; phase?: DailySnowPhase; live: boolean };
/** Picks a post by date; null = the live post. */
type Pick = (date: string | null) => void;

/** The live post first, then the archived posts before it, newest first. */
function entriesFor(live: ApiDailySnow): Entry[] {
  return [
    { date: live.date, title: live.title, phase: live.phase, live: true },
    ...live.archive.filter((a) => a.date !== live.date).slice(0, HISTORY_COUNT - 1).map((a) => ({ ...a, live: false })),
  ];
}

/** One clickable past post. `active` marks the post on screen: it gets the
    accent bar and the panel fill; "Today" still names the live entry. */
function RecentPost({ entry, active, onPick, onIntent }: { entry: Entry; active: boolean; onPick: Pick; onIntent?: Pick }) {
  const date = entry.live ? null : entry.date;
  return (
    <button
      type="button"
      className="dailysnow__history-entry"
      data-active={active || undefined}
      aria-current={active || undefined}
      onClick={() => onPick(date)}
      onPointerEnter={() => onIntent?.(date)}
      onFocus={() => onIntent?.(date)}
    >
      <span className="dailysnow__history-entry-top">
        <span className="dailysnow__history-entry-date">{entry.live ? `Latest · ${postDate(entry.date)}` : postDate(entry.date)}</span>
        {entry.phase && <span className="dailysnow__history-entry-phase">{PHASE_LABEL[entry.phase]}</span>}
      </span>
      <span className="dailysnow__history-entry-title">{entry.title}</span>
    </button>
  );
}

/**
 * A collapsed disclosure above the article on phones; a visible sticky left
 * rail on wide screens. Both layouts share at most three date/title entries.
 * Hidden while the live post is the only one there is.
 */
export function RecentPosts({ live, viewed, onPick, onIntent }: { live: ApiDailySnow | null; viewed: string | null; onPick: Pick; onIntent?: Pick }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  function pick(date: string | null) {
    setExpanded(false);
    if (toggle.current?.getClientRects().length) toggle.current.focus();
    onPick(date);
  }
  if (!live) return null;
  const entries = entriesFor(live);
  if (entries.length < 2) return null;
  return (
    <aside className="dailysnow__history" aria-label="Recent Daily Snow posts" data-expanded={expanded || undefined}>
      <p className="dailysnow__history-heading">Recent posts</p>
      <button
        ref={toggle}
        type="button"
        className="dailysnow__history-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded(!expanded)}
      >
        <span>Recent posts</span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={listId} className="dailysnow__history-list">
        {entries.map((e) => (
          <RecentPost key={e.date} entry={e} active={viewed ? e.date === viewed : e.live} onPick={pick} onIntent={onIntent} />
        ))}
      </div>
    </aside>
  );
}
