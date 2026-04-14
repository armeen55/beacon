import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "server-only": resolve(__dirname, "scripts/mock-server-only.cjs"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    /** Avoid dynamic-import timeouts when many heavy route modules load in parallel. */
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
