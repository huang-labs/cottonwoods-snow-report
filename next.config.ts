import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // OpenNext can render static pages again inside the Worker. Inline the public
  // deployment URL so it survives without a matching runtime environment var.
  env: { SITE_URL: process.env.SITE_URL || "https://cottonwoods-snow-report.huang.mx" },
};

export default nextConfig;

// Exposes Cloudflare bindings (local KV via Miniflare) to `next dev` through getCloudflareContext().
// Opt in to paid remote AI locally; routine builds/typegen need no Cloudflare credentials.
initOpenNextCloudflareForDev({ remoteBindings: process.env.SNOW_AI_REMOTE === "1" });
