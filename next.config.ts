import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the tracing root to this project so the presence of an unrelated
  // lockfile higher up the tree (e.g. in the home directory) doesn't confuse
  // Next.js file tracing during App Hosting builds.
  outputFileTracingRoot: path.join(__dirname),
  eslint: {
    // Lint is run separately; don't fail production builds on lint warnings.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
