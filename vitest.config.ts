import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    // Tests share one SQLite file per process pool; run files sequentially
    // so DB state from one file can't race with another.
    fileParallelism: false,
    env: {
      MUSE_DATA_DIR: "./data-test",
      VAULT_SECRET: "test-secret-for-vitest-only",
    },
  },
});
