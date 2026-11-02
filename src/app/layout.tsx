import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { SITE_TITLE as title, SITE_DESCRIPTION as description, siteOpenGraph, metadataBase } from "@/lib/metadata";
import "./globals.css";

// Static HTML points to the live share image rendered by the Worker.
export const metadata: Metadata = {
  metadataBase,
  title: { default: title, template: `%s · ${title}` },
  description,
  robots: { index: false, follow: false },
  openGraph: {
    ...siteOpenGraph,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Live snowfall at Alta, Snowbird, Solitude and Brighton" }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/opengraph-image"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0f14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
