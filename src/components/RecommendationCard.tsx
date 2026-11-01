import type { ApiRecommendation } from "@/lib/types";
import { formatAge } from "@/lib/time";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
const names = { alta: "Alta", snowbird: "Snowbird", solitude: "Solitude", brighton: "Brighton" };

export function RecommendationCard({ recommendation: r, now }: { recommendation: ApiRecommendation | null | undefined; now: Date }) {
  if (!r) return <aside className="recommendation"><h2>AI ski recommendation</h2><p className="muted">Waiting for the first recommendation.</p></aside>;
  const day = r.targetDate === dateFmt.format(now) ? "Today's" : "Tomorrow's";
  return (
    <aside className={`recommendation${r.outdated || r.failing ? " recommendation--outdated" : ""}`} aria-label="Ski recommendation">
      <div className="recommendation__heading">
        <span className="recommendation__eyebrow">AI ski recommendation · {r.outdated ? `Resort pick for ${r.targetDate}` : `${day} resort pick`} · {r.mode === "storm" ? "Powder priority" : "Easy day"}</span>
        <span className="muted small">Updated {formatAge(r.generatedAt, now)}{r.outdated ? " · Outdated" : ""}{r.failing ? " · Updates failing" : ""}</span>
      </div>
      <h2>{r.headline}</h2>
      <p className="recommendation__plan">{r.plan}</p>
      <ul className="recommendation__reasons">{r.reasons.map((reason, i) => <li key={i}>{reason}</li>)}</ul>
      {!!r.caveats.length && <p className="recommendation__caveats">{r.caveats.join(" · ")}</p>}
      <div className="muted small">{r.runnerUp && <>Backup: {names[r.runnerUp]} · </>}{r.model ? "AI-generated · " : ""}Verify road access, terrain and parking before leaving.</div>
    </aside>
  );
}
