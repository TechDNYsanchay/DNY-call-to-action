import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The routine's guide is read from disk at request time; make sure Vercel bundles the agent/ folder.
  outputFileTracingIncludes: { "/api/agent/[action]": ["./agent/**"] },
  // Tailwind v4 is compiled by Turbopack through this loader (no PostCSS config in this project).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
