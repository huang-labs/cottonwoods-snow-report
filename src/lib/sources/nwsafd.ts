import type { AfdPayload } from "../types";
import { assertValid, HOUR, MINUTE, type SourceDefinition } from "./types";

/**
 * NWS Salt Lake City Area Forecast Discussion: the forecasters' own reasoning
 * (pattern, timing, confidence). Used only as input to the Daily Snow post.
 */
export const AFD_LIST_URL = "https://api.weather.gov/products/types/AFD/locations/SLC";
const productUrl = (id: string) => `https://api.weather.gov/products/${id}`;

/** Sections worth passing on; aviation, fire weather, hydrology and staff lines are dropped. */
const KEEP = /^(KEY MESSAGES|SYNOPSIS|DISCUSSION|SHORT TERM|LONG TERM|.*WATCHES\/WARNINGS\/ADVISORIES)/;
const MAX_SECTION_CHARS = 4000;

interface ProductList {
  "@graph"?: Array<{ id: string; issuanceTime: string }>;
}
interface Product {
  id: string;
  issuingOffice?: string;
  issuanceTime: string;
  productText: string;
}

/**
 * Split product text into `.NAME...` sections ending at `&&` or `$$`. Updated
 * products repeat unchanged sections with their original time:
 * `.DISCUSSION, Issued 1037 PM MST Sun Nov 1 2026...`.
 */
export function parseAfd(text: string): AfdPayload["sections"] {
  const sections: AfdPayload["sections"] = [];
  const re = /^\.([A-Z][A-Z0-9 /&()-]*?)(?:,\s*Issued\s+([^\n]*?))?\.\.\.([\s\S]*?)(?=^&&|^\$\$|^\.[A-Z][A-Z0-9 /&()-]*?(?:,[^\n]*?)?\.\.\.)/gm;
  for (const m of text.replaceAll("\r", "").matchAll(re)) {
    const name = m[1].trim().replace(/^SLC /, "");
    const issued = m[2]?.trim();
    if (!KEEP.test(name)) continue;
    // Unwrap the 70-column lines; keep bullets and paragraph breaks.
    const body = m[3]
      .split(/\n\s*\n/)
      .map((para) => para.replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n")
      .replace(/ (- )/g, "\n$1")
      .trim();
    if (!body) continue;
    const clipped = body.length > MAX_SECTION_CHARS ? `${body.slice(0, MAX_SECTION_CHARS - 1)}…` : body;
    sections.push(issued ? { name, text: clipped, issued } : { name, text: clipped });
  }
  return sections;
}

export const nwsAfdSource: SourceDefinition<AfdPayload> = {
  id: "nwsafd",
  // Issued about four times a day, plus updates.
  intervalMs: 30 * MINUTE,
  label: "NWS forecast discussion",
  category: "weather",
  required: false,
  attribution: "National Weather Service Salt Lake City — Area Forecast Discussion",
  sourceUrl: "https://forecast.weather.gov/product.php?site=SLC&issuedby=SLC&product=AFD",
  reportMaxAgeMs: 18 * HOUR,
  async collect(ctx) {
    const headers = { Accept: "application/ld+json" };
    const list = await ctx.fetchJson<ProductList>(AFD_LIST_URL, { headers });
    const latest = list["@graph"]?.[0];
    assertValid(latest?.id, "AFD list is empty");
    const prev = ctx.previous as AfdPayload | null;
    if (prev?.productId === latest.id) return { payload: prev, sourceUpdatedAt: prev.issuedAt };
    const product = await ctx.fetchJson<Product>(productUrl(latest.id), { headers });
    assertValid(typeof product.productText === "string", "AFD product has no text");
    const sections = parseAfd(product.productText);
    assertValid(sections.some((s) => /DISCUSSION|SHORT TERM|LONG TERM|KEY MESSAGES|SYNOPSIS/.test(s.name)), "AFD has no discussion section");
    const issuedAt = new Date(product.issuanceTime).toISOString();
    return {
      payload: { productId: product.id, office: product.issuingOffice ?? "KSLC", issuedAt, sections },
      sourceUpdatedAt: issuedAt,
    };
  },
};
