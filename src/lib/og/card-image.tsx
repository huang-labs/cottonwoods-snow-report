import { formatInches, type ShareCardData } from "./shareCard";
import { GEIST_BOLD_TTF, GEIST_MEDIUM_TTF } from "./fonts";
import { SHARE_COLORS as C, SHARE_FRAME, ShareBrand, ShareFooter } from "./style";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export const SHARE_CARD_FONTS = [
  { name: "Geist", data: decode(GEIST_MEDIUM_TTF), weight: 500 as const, style: "normal" as const },
  { name: "Geist", data: decode(GEIST_BOLD_TTF), weight: 700 as const, style: "normal" as const },
];

/** Homepage preview: measured snowfall stays distinct from the NWS forecast. */
export function ShareCard({ data }: { data: ShareCardData }) {
  return (
    <div style={{ ...SHARE_FRAME }}>
      <ShareBrand />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 28, color: C.muted, fontSize: 22 }}>
        <span>RESORT-REPORTED · PAST 24 HOURS</span>
        <span>{data.updated ? `${data.updated} MT` : "Awaiting current reports"}</span>
      </div>
      <div style={{ display: "flex", flex: 1, marginTop: 32, borderTop: `1px solid ${C.line}` }}>
        {data.resorts.map((r, i) => (
          <div key={r.name} style={{ display: "flex", flexDirection: "column", width: "25%", paddingTop: 30, paddingLeft: i ? 24 : 0, borderLeft: i ? `1px solid ${C.line}` : "0px solid transparent" }}>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{r.name}</div>
            <div style={{ display: "flex", alignItems: "flex-start", marginTop: 20, color: r.snow24 !== null && r.snow24 > 0 ? C.accent : C.muted }}>
              <span style={{ fontSize: 94, lineHeight: 1, letterSpacing: -4, fontWeight: 700 }}>{r.snow24 === null ? "—" : formatInches(r.snow24).slice(0, -1)}</span>
              {r.snow24 !== null && <span style={{ fontSize: 46, lineHeight: 1.15, marginLeft: 4 }}>″</span>}
            </div>
            <div style={{ marginTop: 18, fontSize: 21, color: C.muted }}>{r.snow24 === null ? "Not reported" : "new snow"}</div>
          </div>
        ))}
      </div>
      <ShareFooter>
        {data.storm ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <span style={{ fontWeight: 700, color: C.text }}>Next storm</span>
              <span style={{ fontWeight: 700, color: C.accent }}>{formatInches(data.storm.inches)}</span>
              <span>{data.storm.where} · NWS forecast</span>
            </div>
            <span style={{ fontSize: 20 }}>{data.storm.when}</span>
          </div>
        ) : <span>Little &amp; Big Cottonwood Canyons · Snowfall, forecasts &amp; canyon roads</span>}
      </ShareFooter>
    </div>
  );
}
