import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Kept in step with the same constant in vitest.global-setup.mts by hand:
 * importing it across files would need `allowImportingTsExtensions`, which
 * `next build` type-checks this repo without.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/lead_tracking_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // `server-only` throws unless it's resolved under React's react-server
      // condition, which vitest doesn't set. The guard is a build-time concern.
      "server-only": path.resolve(import.meta.dirname, "./src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./vitest.global-setup.mts"],
    env: {
      // A dedicated database, created and wiped by global setup.
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_SSL: "disable",
      GOOGLE_MAPS_API_KEY: "test-key-not-used-network-is-stubbed",
      // Keep the suite's output readable and out of the real log directory.
      // The logger's own tests point at a temp dir and assert on the files.
      LOG_DIR: path.resolve(import.meta.dirname, "./data/test-logs"),
      LOG_CONSOLE: "0",
    },
    // The runner and backup tests share one database, so their cases must not
    // interleave — one test's cleanup would be another's missing fixture.
    fileParallelism: false,
  },
});
