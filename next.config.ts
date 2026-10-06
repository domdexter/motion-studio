import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Node-only packages used by server code; never bundle them.
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/install-whisper-cpp",
    "chokidar",
    "pg",
    "@prisma/adapter-pg",
  ],
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
