import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["deck.gl", "@deck.gl/core", "@deck.gl/layers", "@deck.gl/geo-layers"],
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    NEXT_PUBLIC_MAPTILER_KEY: process.env.NEXT_PUBLIC_MAPTILER_KEY || "",
  },
};

export default nextConfig;
