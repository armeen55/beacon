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
    /** Four isolated workers cut the hermetic full gate from ~239s to ~77s.
     * Route/store tests stay isolated by Vitest worker process; paid/live creds
     * remain blank below, so parallelism cannot fan out external calls. */
    fileParallelism: true,
    maxWorkers: 4,
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
      // 2026-06-30 hermetic-test fix (Move 7). `npm run test` must give the
      // SAME result whether or not the operator sourced `.env.local` first.
      // vitest does NOT auto-load `.env.local`, but if a shell sourced it the
      // ambient DATAFORSEO_* / GOOGLE_* / auth creds leak into process.env and
      // flip ~5 "off-by-default"/auth tests (serp-provider returns a live SERP,
      // the Google OAuth callback takes a configured path, tenant-switch
      // short-circuits to "/" under BEACON_AUTH_DISABLED). Blanking them here
      // (vitest `env` overrides process.env at setup) pins the CI-clean baseline
      // regardless of the shell. UNCONDITIONAL — kept blank even under
      // BEACON_LIVE_DB_TESTS=1 so a live-DB integration run still can NEVER fire
      // a paid DataForSEO/OpenAI call or hit a real OAuth exchange. Tests that
      // exercise these paths pass the env explicitly (function args) or
      // `vi.stubEnv(...)`, which overrides these blanks for that test only.
      // Paid / SERP credentials:
      DATAFORSEO_AUTH_B64: "",
      DATAFORSEO_LOGIN: "",
      DATAFORSEO_PASSWORD: "",
      DATAFORSEO_DRY_RUN: "",
      DATAFORSEO_MONTHLY_CAP_USD: "",
      BEACON_SERP_PROVIDER: "",
      OPENAI_API_KEY: "",
      PERPLEXITY_API_KEY: "",
      // Google OAuth / connector credentials:
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      BEACON_OAUTH_STATE_SECRET: "",
      // Supabase management + anon creds (data-plane URL/service-role already
      // blanked above under the live-DB guard):
      SUPABASE_MGMT_TOKEN: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      // Auth / operator flags that alter redirect + gating behavior:
      BEACON_AUTH_DISABLED: "",
      BEACON_OPERATOR_MODE: "",
      // Misc local-dev flags that must not leak into deterministic tests:
      BEACON_LLM_WHY: "",
      NEXT_PUBLIC_APP_URL: "",
    },
  },
});
