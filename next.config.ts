import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["pino", "pino-pretty", "pg", "bullmq", "ioredis"],
  async rewrites() {
    return [
      {
        source: "/v1/events",
        destination: "/api/v1/events",
      },
      {
        source: "/v1/events/batch",
        destination: "/api/v1/events/batch",
      },
    ];
  },
};

export default nextConfig;
