import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "Cottonwoods Snow Report";
const description = "Live snowfall, forecast, plumes and canyon roads for Alta, Snowbird, Solitude and Brighton.";

// The share image comes from app/opengraph-image.tsx (live numbers); Next adds it to openGraph.
export const metadata: Metadata = {
  metadataBase: new URL("https://cottonwoods-snow-report.huang.mx"),
  title,
  description,
  robots: { index: false, follow: false },
  openGraph: { type: "website", url: "/", siteName: title, title, description, locale: "en_US" },
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
      <body>{children}</body>
    </html>
  );
}
