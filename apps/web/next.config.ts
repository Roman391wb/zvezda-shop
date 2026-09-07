import type { NextConfig } from "next";
const backendInternalUrl = process.env.BACKEND_INTERNAL_URL || "http://api:8000";
const staticStorefront = process.env.STATIC_STOREFRONT === "true";

const nextConfig: NextConfig = {
  output: staticStorefront ? "export" : "standalone",
  images: { formats: ["image/avif", "image/webp"], unoptimized: staticStorefront },
  ...(!staticStorefront && {async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backendInternalUrl}/api/:path*` },
      { source: "/health", destination: `${backendInternalUrl}/health` },
      { source: "/media/:path*", destination: `${backendInternalUrl}/media/:path*` },
    ];
  }}),
};
export default nextConfig;
