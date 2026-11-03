import type { ApiDailySnow } from "@/lib/types";
import { prefetchArchivedPost } from "./archive";
import { postDate } from "./labels";

/** Each post links its neighbors so navigation reaches beyond the recent-posts
 * rail. The index is a fallback for posts written before neighbor links existed. */
export function ArchiveNav({ post, onPick, position }: {
  post: ApiDailySnow;
  onPick: (date: string | null) => void;
  position: "top" | "bottom";
}) {
  const i = post.archive.findIndex((a) => a.date === post.date);
  const older = post.older ?? (i >= 0 ? post.archive[i + 1] : post.archive.find((a) => a.date < post.date));
  const newer = post.newer ?? (i > 0 ? post.archive[i - 1] : null);
  if (!older && !newer) return null;
  const intent = (date: string) => ({
    onPointerEnter: () => prefetchArchivedPost(date),
    onFocus: () => prefetchArchivedPost(date),
  });
  return (
    <nav className={`dailysnow__nav dailysnow__nav--${position}`} aria-label={position === "top" ? "Daily Snow archive" : "Daily Snow archive (end of article)"}>
      {older && (
        <button
          type="button"
          className="dailysnow__nav-previous"
          aria-label={`Previous post: ${postDate(older.date)}: ${older.title}`}
          title={older.title}
          onClick={() => onPick(older.date)}
          {...intent(older.date)}
        >
          <span aria-hidden="true">←</span> {postDate(older.date)}
        </button>
      )}
      {newer && (
        <button
          type="button"
          className="dailysnow__nav-next"
          aria-label={`Next post: ${postDate(newer.date)}: ${newer.title}`}
          title={newer.title}
          onClick={() => onPick(newer.date)}
          {...intent(newer.date)}
        >
          {postDate(newer.date)} <span aria-hidden="true">→</span>
        </button>
      )}
    </nav>
  );
}
