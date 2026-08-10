import path from "node:path";
import { defineConfig } from "vitest/config";

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
    globalSetup: ["./vitest.global-setup.ts"],
    env: {
      DATABASE_PATH: path.resolve(import.meta.dirname, "./data/test-runner.db"),
      GOOGLE_MAPS_API_KEY: "test-key-not-used-network-is-stubbed",
    },
    // The runner test shares one SQLite file, so its cases must not interleave.
    fileParallelism: false,
  },
});
