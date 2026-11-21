import { defineConfig } from "vitest/config";
import path from "node:path";

// The local end-to-end suite (npm run test:e2e): src/**/*.e2e.ts against the LOCAL Supabase stack only,
// with fixtures for Callyzer, the recordings and Deepgram. e2e-guard.ts refuses to start unless
// SUPABASE_LOCAL_URL is 127.0.0.1 or localhost; e2e-env.ts builds the environment from the local values.
// No .env file is ever loaded (envDir: false). See src/lib/calls/calls.e2e.ts for how to run it.
export default defineConfig({
  envDir: false,
  test: {
    include: ["src/**/*.e2e.ts"],
    environment: "node",
    globalSetup: "src/test/e2e-guard.ts",
    setupFiles: ["src/test/e2e-env.ts"],
    // The files share one database: one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: path.resolve(__dirname, "src/test/empty.ts") },
      { find: /^next\/headers$/, replacement: path.resolve(__dirname, "src/test/next-headers.ts") },
      { find: "@", replacement: path.resolve(__dirname, "src") },
    ],
  },
});
