import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    // Enables React's <ViewTransition> component so the welcome orb can
    // morph into the feed mini-orb when onboarding navigates to /feed.
    viewTransition: true,
  },
};

export default nextConfig;
