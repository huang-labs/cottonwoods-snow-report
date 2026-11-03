import type { ApiSource } from "@/lib/types";
import { formatAge } from "@/lib/time";
import { FRESHNESS_TEXT, FreshnessBadge } from "../ui";
import { summarizeFreshness } from "./freshness-summary";

/**
 * The Snowfall page's source line: the same footer the other pages end with
 * (`SourceLine`), speaking for several resorts at once. The badge shows the worst
 * resort's state; when not every resort is current, the resorts in each state are
 * named, worst first. The last successful check is the oldest of the resorts'.
 * Report times differ by resort, so they stay in the table's own column.
 */
export function ResortsSourceLine({ sources, now }: { sources: ApiSource[]; now: Date }) {
  const { worst, groups, oldestCheck } = summarizeFreshness(sources);
  const failing = sources.filter((s) => s.status === "error").map((s) => s.label);
  return (
    <div className="source-line">
      <FreshnessBadge freshness={worst} />
      {worst !== "current" &&
        groups.map(({ freshness, labels }, i) => (
          <span key={freshness}>
            {i > 0 && `${FRESHNESS_TEXT[freshness]}: `}
            <strong>{labels.join(", ")}</strong>
          </span>
        ))}
      <span>
        Last successful check: <strong>{formatAge(oldestCheck, now)}</strong>
      </span>
      {failing.length > 0 && <span className="source-line__error">Latest check failed: {failing.join(", ")}</span>}
      <span className="source-line__attr">{resortList(sources)} snow reports (resort websites)</span>
    </div>
  );
}

/** "Alta, Snowbird, Solitude and Brighton", as the site's other attributions read. */
function resortList(sources: ApiSource[]) {
  const labels = sources.map((s) => s.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : (labels[0] ?? "Resort");
}
