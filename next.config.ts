import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module, so Next.js should load it directly instead of bundling it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
