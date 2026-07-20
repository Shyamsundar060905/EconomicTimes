import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["deck.gl", "@deck.gl/core", "@deck.gl/layers", "@deck.gl/geo-layers"],
  // NEXT_PUBLIC_* vars are auto-exposed by Next.js from the environment — no need
  // to force defaults here (doing so overrode the empty-string no-backend signal).
  // Set NEXT_PUBLIC_API_URL / NEXT_PUBLIC_N8N_WEBHOOK_URL in .env.local or Vercel.
};

export default nextConfig;
