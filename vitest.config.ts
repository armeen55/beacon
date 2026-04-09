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
    include: ["tests/**/*.test.ts"],
  },
});
