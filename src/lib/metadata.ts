import type { Metadata } from "next";
import { sectionHref, type SectionDef } from "./sections";

export const SITE_TITLE = "Cottonwoods Snow Report";
// Set at build time for PR previews; production keeps its custom domain.
export const metadataBase = new URL(process.env.SITE_URL || "https://cottonwoods-snow-report.huang.mx");
export const SITE_DESCRIPTION = "Live snowfall, forecast, plumes and canyon roads for Alta, Snowbird, Solitude and Brighton.";
export const DAILY_SNOW_DESCRIPTION = "A daily snow forecast for Little and Big Cottonwood Canyons, with storm updates, snowfall outlooks and mountain weather.";

export const siteOpenGraph = {
  type: "website" as const,
  url: "/",
  siteName: SITE_TITLE,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  locale: "en_US",
};

/** Social titles must include the same suffix as the root document title template. */
export function sectionMetadata(section: SectionDef): Metadata {
  const title = `${section.title} · ${SITE_TITLE}`;
  const description = section.id === "daily-snow" ? DAILY_SNOW_DESCRIPTION : SITE_DESCRIPTION;
  // Nested openGraph objects replace the parent's object, including its image.
  const images = [{
    url: section.id === "daily-snow" ? "/daily-snow/opengraph-image" : "/share-brand-v1.png",
    width: 1200,
    height: 630,
    alt: section.id === "daily-snow"
      ? "Daily Snow — the latest Cottonwoods snow forecast"
      : "Cottonwoods Snow Report — Little & Big Cottonwood Canyons",
  }];
  return {
    title: section.title,
    description,
    openGraph: { ...siteOpenGraph, title, description, url: sectionHref(section.id), images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
