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
    /**
     * Hydrates a small synthetic `.data/` fixture in CI when the operator's
     * curated `.data/` is absent. Local dev with a real `.data/` is detected
     * by the presence of `.data/global/tenants.json` and is left untouched.
     * See tests/setup/global-fixture-hydrate.ts for the full guard logic.
     */
    globalSetup: ["tests/setup/global-fixture-hydrate.ts"],
    env: {
      // Quota/waste guard (2026-06-17): `npm test` is HERMETIC by default — it
      // must never touch a hosted Supabase (the dev/prod boundary failure that
      // burned prod egress). Force file mode + blank Supabase creds so every
      // live-DB integration test self-skips (they gate on creds presence) and
      // any stray getSupabaseAdmin() call throws instead of hitting prod. Opt
      // in with BEACON_LIVE_DB_TESTS=1 for the rare real integration run.
      ...(process.env.BEACON_LIVE_DB_TESTS === "1"
        ? {}
        : {
            DATA_SOURCE: "file",
            DUAL_WRITE: "false",
            NEXT_PUBLIC_SUPABASE_URL: "",
            SUPABASE_SERVICE_ROLE_KEY: "",
          }),
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
      // 2026-06-10 hermetic-test fix. The operator's `.env.local` now
      // carries runtime activation flags (BEACON_LLM_PROVIDER=openai,
      // BEACON_CROSS_TENANT_BRAIN=1) for local dev. Tests pin the SAFE
      // DEFAULTS ("deterministic", brain off); without these lines any
      // env-loading picks up the operator flags and 16 gate tests flip.
      // Tests that exercise the enabled paths stub the env themselves.
      BEACON_LLM_PROVIDER: "deterministic",
      BEACON_CROSS_TENANT_BRAIN: "",
    },
  },
});
