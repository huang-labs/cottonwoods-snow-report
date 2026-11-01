import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;

// Exposes Cloudflare bindings (local KV via Miniflare) to `next dev` through getCloudflareContext().
initOpenNextCloudflareForDev();
