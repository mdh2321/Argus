import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/briefings",
        destination: "/library",
        permanent: true,
      },
      {
        source: "/briefings/:id",
        destination: "/library/briefings/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
