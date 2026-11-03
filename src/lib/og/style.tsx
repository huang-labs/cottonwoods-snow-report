import type { CSSProperties, ReactNode } from "react";

/** Explicit light palette: link crawlers have no reliable appearance preference. */
export const SHARE_COLORS = {
  bg: "#f8fafc", panel: "#edf3f9", line: "#dbe3ec",
  text: "#172b42", muted: "#586b7d", accent: "#1266a3",
};

/** Spread into a fresh object per render: Satori mutates style objects. */
export const SHARE_FRAME: CSSProperties = {
  width: "100%", height: "100%", display: "flex", flexDirection: "column",
  padding: "48px 56px", fontFamily: "Geist", fontWeight: 500,
  background: SHARE_COLORS.bg, color: SHARE_COLORS.text,
};

export function ShareBrand({ large = false }: { large?: boolean }) {
  return (
    <div style={{ display: "flex", flexShrink: 0, flexDirection: large ? "column" : "row", fontSize: large ? 88 : 36, lineHeight: 1.08, letterSpacing: large ? -3 : -1, fontWeight: 700 }}>
      <span>Cottonwoods</span>
      <span style={{ color: SHARE_COLORS.accent, marginLeft: large ? 0 : 10 }}>Snow Report</span>
    </div>
  );
}

export function ShareFooter({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexShrink: 0, borderTop: `1px solid ${SHARE_COLORS.line}`, paddingTop: 22, color: SHARE_COLORS.muted, fontSize: 22 }}>{children}</div>;
}
