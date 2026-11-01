import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

// Exposes Cloudflare bindings (local KV via Miniflare) to `next dev` through getCloudflareContext().
// Opt in to paid remote AI locally; routine builds/typegen need no Cloudflare credentials.
initOpenNextCloudflareForDev({ remoteBindings: process.env.SNOW_AI_REMOTE === "1" });
