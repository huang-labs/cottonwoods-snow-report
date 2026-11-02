import type { ApiRecommendation } from "@/lib/types";
import { formatAge } from "@/lib/time";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
const names = { alta: "Alta", snowbird: "Snowbird", solitude: "Solitude", brighton: "Brighton" };

export function RecommendationCard({ recommendation: r, now }: { recommendation: ApiRecommendation | null | undefined; now: Date }) {
  if (!r?.pick) return null;
  const day = r.targetDate === dateFmt.format(now) ? "Today's" : "Tomorrow's";
  return (
    <aside className={`recommendation${r.outdated || r.failing ? " recommendation--outdated" : ""}`} aria-label="Recommendation">
      <div className="recommendation__heading">
        <span className="recommendation__eyebrow">Recommendation<span className="badge badge--ai">AI</span> · {r.outdated ? `Resort pick for ${r.targetDate}` : `${day} resort pick`} · {r.mode === "storm" ? "Powder priority" : "Easy day"}</span>
        <span className="muted small">Updated {formatAge(r.generatedAt, now)}{r.outdated ? " · Outdated" : ""}{r.failing ? " · Updates failing" : ""}</span>
      </div>
      <h2>{r.headline}</h2>
      <p className="recommendation__plan">{r.plan}</p>
      {r.summary && <p className="recommendation__summary">{r.summary}</p>}
      {!!r.caveats.length && <p className="recommendation__caveats">{r.caveats.join(" · ")}</p>}
      <div className="muted small">{r.runnerUp && <>Backup: {names[r.runnerUp]} · </>}{r.model ? "AI-generated · " : ""}Verify road access, terrain and parking before leaving.</div>
    </aside>
  );
}
