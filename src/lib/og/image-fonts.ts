import { GEIST_BOLD_TTF, GEIST_MEDIUM_TTF } from "./fonts";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

export const SHARE_CARD_FONTS = [
  { name: "Geist", data: decode(GEIST_MEDIUM_TTF), weight: 500 as const, style: "normal" as const },
  { name: "Geist", data: decode(GEIST_BOLD_TTF), weight: 700 as const, style: "normal" as const },
];
