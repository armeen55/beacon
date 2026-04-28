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
    env: {
      BEACON_TENANT_ID: "tenant-ritz-founder",
      // 2026-04-28 CI fix. `currentTenantSlug` resolution chain
      // (src/lib/tenant-context.ts:78–100) tries the tenant registry
      // first, then falls back to BEACON_TENANT_SLUG when the registry
      // doesn't resolve. The registry lives in
      // `.data/global/tenants.json` which is gitignored — present
      // locally, NOT in the GH Actions runner. Without this env line,
      // CI test runs threw `currentTenantSlug: tenant tenant-ritz-founder
      // not found in store`. The slug is not sensitive (already in
      // committed test fixtures + docs); hardcoding here matches the
      // existing BEACON_TENANT_ID pattern. Reproduced + verified by
      // hiding .data/global/tenants.json + unsetting the env var.
      BEACON_TENANT_SLUG: "ritz-builders",
    },
  },
});
