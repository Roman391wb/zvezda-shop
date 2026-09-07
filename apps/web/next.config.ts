import type { NextConfig } from "next";
const backendInternalUrl = process.env.BACKEND_INTERNAL_URL || "http://api:8000";
const staticStorefront = process.env.STATIC_STOREFRONT === "true";
const githubPages = process.env.GITHUB_PAGES === "true";
const [githubOwner,githubRepository] = (process.env.GITHUB_REPOSITORY || "/").split("/");
const githubBasePath = githubPages && githubRepository && githubRepository !== `${githubOwner}.github.io` ? `/${githubRepository}` : "";

const nextConfig: NextConfig = {
  output: staticStorefront ? "export" : "standalone",
  ...(staticStorefront && { trailingSlash: true }),
  ...(githubBasePath && { basePath: githubBasePath, assetPrefix: githubBasePath }),
  env: { NEXT_PUBLIC_BASE_PATH: githubBasePath },
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
