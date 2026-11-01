import { formatInches, type ShareCardData } from "./shareCard";
import { GEIST_BOLD_TTF, GEIST_MEDIUM_TTF } from "./fonts";

// Satori (ImageResponse) renders a flexbox-only subset of CSS: every element
// with more than one child needs display:flex, and there is no stylesheet.

const C = {
  bg: "#0b0f14",
  panel: "rgba(18, 25, 34, 0.82)",
  line: "#243142",
  text: "#e8eef5",
  muted: "#8a9bb0",
  accent: "#7cc4ff",
  ok: "#4cc38a",
};

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export const SHARE_CARD_FONTS = [
  { name: "Geist", data: decode(GEIST_MEDIUM_TTF), weight: 500 as const, style: "normal" as const },
  { name: "Geist", data: decode(GEIST_BOLD_TTF), weight: 700 as const, style: "normal" as const },
];

/** Same snowflake as app/icon.svg, without the tile. */
export const SNOWFLAKE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><g fill="none" stroke="#7cc4ff" stroke-width="4" stroke-linecap="round"><path d="M32 10v44M13 21l38 22M13 43l38-22"/><path d="M26 14l6 5 6-5M26 50l6-5 6 5"/></g></svg>';

const svgUri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

/** Wasatch-ish ridgelines behind the cards. */
const RIDGES_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" preserveAspectRatio="none">' +
  '<path fill="#132131" d="M0 420 L120 350 L210 392 L330 290 L430 360 L540 270 L640 340 L760 250 L860 330 L980 280 L1090 350 L1200 300 L1200 630 L0 630 Z"/>' +
  '<path fill="#0f1a26" d="M0 500 L150 430 L260 470 L390 395 L520 465 L650 400 L780 470 L900 410 L1030 465 L1200 420 L1200 630 L0 630 Z"/>' +
  "</svg>";

function Resort({ r }: { r: ShareCardData["resorts"][number] }) {
  const fresh = r.snow24 !== null && r.snow24 > 0;
  const open = r.status !== null && /lifts$/.test(r.status) && !/closed/i.test(r.status);
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "26px 28px",
        background: C.panel,
        border: `2px solid ${fresh ? "rgba(124, 196, 255, 0.45)" : C.line}`,
        borderRadius: 22,
      }}
    >
      <div style={{ fontSize: 32, fontWeight: 700, color: C.text }}>{r.name}</div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6 }}>
        <div style={{ fontSize: 108, fontWeight: 700, lineHeight: 1, letterSpacing: -4, color: fresh ? C.accent : C.muted }}>
          {r.snow24 === null ? "—" : formatInches(r.snow24)}
        </div>
      </div>
      <div style={{ fontSize: 22, fontWeight: 500, color: C.muted, marginTop: 6 }}>new snow · 24 h</div>
      <div style={{ display: "flex", flex: 1 }} />
      <div style={{ fontSize: 22, fontWeight: 500, color: C.text, minHeight: 28 }}>{r.detail ?? ""}</div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 10, fontSize: 21, fontWeight: 500, color: open ? C.ok : C.muted }}>
        <div style={{ width: 12, height: 12, borderRadius: 6, marginRight: 10, background: open ? C.ok : "#4a5a6e" }} />
        {r.status ?? ""}
      </div>
    </div>
  );
}

export function ShareCard({ data }: { data: ShareCardData }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "44px 48px 40px",
        fontFamily: "Geist",
        color: C.text,
        backgroundColor: C.bg,
        backgroundImage: "linear-gradient(180deg, #0b0f14 0%, #0f1824 60%, #0b0f14 100%)",
        position: "relative",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={svgUri(RIDGES_SVG)} width={1200} height={630} alt="" style={{ position: "absolute", left: 0, top: 0 }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={svgUri(SNOWFLAKE_SVG)} width={52} height={52} alt="" />
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1, marginLeft: 16 }}>Cottonwoods Snow Report</div>
        </div>
        {data.updated && (
          <div style={{ display: "flex", fontSize: 20, fontWeight: 500, color: C.muted }}>{data.updated} MT</div>
        )}
      </div>

      <div style={{ display: "flex", gap: 20, flex: 1, marginTop: 30 }}>
        {data.resorts.map((r) => (
          <Resort key={r.name} r={r} />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          flexWrap: "wrap",
          marginTop: 24,
          fontSize: 26,
          fontWeight: 500,
          color: C.muted,
        }}
      >
        {data.storm ? (
          <>
            <span style={{ color: C.text, fontWeight: 700 }}>Next storm</span>
            <span style={{ color: C.accent, fontWeight: 700, fontSize: 34, margin: "0 12px" }}>{formatInches(data.storm.inches)}</span>
            <span>
              {data.storm.where} · {data.storm.when}
            </span>
          </>
        ) : (
          <span>Little & Big Cottonwood · snow, weather, plumes and canyon roads</span>
        )}
      </div>
    </div>
  );
}
