import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits `.next/standalone` — a self-contained server plus only the
  // node_modules it actually traced. It is what keeps the Docker image small
  // enough to rebuild comfortably on a small VPS.
  output: "standalone",
};

export default nextConfig;
