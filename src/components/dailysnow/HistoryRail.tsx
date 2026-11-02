
import type { ApiDailySnow, DailySnowPhase } from "@/lib/types";
import { PHASE_LABEL, postDate } from "./labels";

/** How many posts the rail shows: the live post plus the archive before it. */
const HISTORY_COUNT = 3;

type Entry = { date: string; title: string; phase?: DailySnowPhase; live: boolean };

/** The live post first, then the archived posts before it, newest first. */
function entriesFor(live: ApiDailySnow): Entry[] {
  return [
    { date: live.date, title: live.title, phase: live.phase, live: true },
    ...live.archive.filter((a) => a.date !== live.date).slice(0, HISTORY_COUNT - 1).map((a) => ({ ...a, live: false })),
  ];
}

/** One clickable past post. `active` marks the post on screen: it gets the
    accent bar and the panel fill; "Today" still names the live entry. */
function HistoryEntry({ entry, active, onPick }: { entry: Entry; active: boolean; onPick: (date: string | null) => void }) {
  return (
    <button
      type="button"
      className="dailysnow__history-entry"
      data-active={active || undefined}
      onClick={() => onPick(entry.live ? null : entry.date)}
    >
      <span className="dailysnow__history-entry-top">
        <span className="dailysnow__history-entry-date">{entry.live ? "Today" : postDate(entry.date)}</span>
        {entry.phase && <span className="dailysnow__history-entry-phase">{PHASE_LABEL[entry.phase]}</span>}
      </span>
      <span className="dailysnow__history-entry-title">{entry.title}</span>
    </button>
  );
}

/**
 * Recent posts in a left rail beside the article on wide screens. Phones render
 * nothing here: they navigate with the archive links below the post. Hidden
 * while the live post is the only one there is.
 */
export function HistoryRail({ live, viewed, onPick }: { live: ApiDailySnow | null; viewed: string | null; onPick: (date: string | null) => void }) {
  if (!live) return null;
  const entries = entriesFor(live);
  if (entries.length < 2) return null;
  return (
    <aside className="dailysnow__history" aria-label="Recent Daily Snow posts">
      <p className="dailysnow__history-heading">Past {HISTORY_COUNT} days</p>
      <div className="dailysnow__history-list">
        {entries.map((e) => (
          <HistoryEntry key={e.date} entry={e} active={viewed ? e.date === viewed : e.live} onPick={onPick} />
        ))}
      </div>
    </aside>
  );
}
