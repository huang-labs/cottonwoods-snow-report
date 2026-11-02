import type { Metadata, Viewport } from "next";
import { AppShell } from "@/components/AppShell";
import { SITE_TITLE as title, SITE_DESCRIPTION as description, siteOpenGraph } from "@/lib/metadata";
import "./globals.css";

// The share image comes from app/opengraph-image.tsx (live numbers); Next adds it to openGraph.
export const metadata: Metadata = {
  metadataBase: new URL("https://cottonwoods-snow-report.huang.mx"),
  title: { default: title, template: `%s · ${title}` },
  description,
  robots: { index: false, follow: false },
  openGraph: siteOpenGraph,
  twitter: { card: "summary_large_image", title, description },
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
