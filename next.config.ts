import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The game is a single full-viewport canvas: nothing may scroll or letterbox it.
  poweredByHeader: false,
  // three.js ships untranspiled ESM; Next handles it, but keeping the package
  // server-external avoids duplicate module instances during RSC bundling.
  serverExternalPackages: ["@neondatabase/serverless"],
  experimental: {
    // html2canvas is a large browser-only library; keep it out of the server graph.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
