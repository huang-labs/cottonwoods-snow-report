import { clipText } from "../clip";
import { DAILY_SNOW_DESCRIPTION, SITE_TITLE } from "../metadata";
import type { DailySnowPost } from "../types";

type PreviewPost = Pick<DailySnowPost, "date" | "title" | "summary">;

/** Bounded copy keeps even unusually long generated posts inside the share card. */
export function DailySnowShareCard({ post }: { post: PreviewPost | null }) {
  const date = post ? new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "long", day: "numeric", year: "numeric",
  }).format(new Date(`${post.date}T12:00:00Z`)) : "A fresh forecast every morning";
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "44px 56px", fontFamily: "Geist", color: "#e8eef5", background: "linear-gradient(135deg, #0b0f14, #182e44)", borderTop: "8px solid #7cc4ff" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#7cc4ff", fontSize: 28, fontWeight: 700 }}>
        <span>DAILY SNOW</span>
        <span style={{ fontSize: 22, color: "#8a9bb0", fontWeight: 500 }}>{date}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
        <div style={{ fontSize: 58, lineHeight: 1.12, letterSpacing: -1, fontWeight: 700 }}>{clipText(post?.title ?? "Your Cottonwoods snow forecast", 115)}</div>
        <div style={{ marginTop: 24, fontSize: 28, lineHeight: 1.35, color: "#b8c9dc" }}>{clipText(post?.summary ?? DAILY_SNOW_DESCRIPTION, 220)}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #34485e", paddingTop: 22, fontSize: 22, color: "#8a9bb0" }}>
        <span>{SITE_TITLE}</span>
        <span>Little &amp; Big Cottonwood · AI forecast</span>
      </div>
    </div>
  );
}
