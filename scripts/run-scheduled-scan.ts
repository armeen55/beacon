/**
 * Recommendation Lifecycle OS — Phase 5 (2026-04-28).
 *
 * Scheduled-scan entry point invoked by `.github/workflows/daily-scan.yml`.
 *
 * Why this exists (read before refactoring):
 *
 * `runWebsiteScan` spawns a CLI subprocess (`scripts/scan-owned-pages.ts`)
 * that writes to `.data/tenants/{slug}/...`. On Vercel's serverless
 * lambda the FS is read-only and tsx is a devDependency that may not
 * be available — so the canonical scheduled mechanism is GitHub
 * Actions, where the runner has full FS write + tsx + npm install
 * access. This script is what the GH job runs.
 *
 * The runner's local `.data` writes are ephemeral (job FS is wiped
 * after exit). All persistent state lives in Supabase via the
 * dual-write helpers — verified by Steps 1–5 of the safety gate.
 *
 * Auth is implicit: the GH workflow file holds the only invocation
 * path; secrets (Supabase URL + service key + tenant id/slug) live
 * in repo secrets and are exported into the job env.
 *
 * Kill switch: `BEACON_SCAN_DISABLED=1` env exits 0 with a
 * structured warn line so the GH step doesn't surface as a failure.
 *
 * Fail-loud: missing `BEACON_TENANT_ID` or `BEACON_TENANT_SLUG`
 * exits 1. The CLI subprocess inside `runWebsiteScan` ALSO
 * fail-louds on missing slug (post-Phase-5 tenant routing) — this
 * outer guard catches the missing config one level higher with a
 * clearer error.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvLocal();

// Re-imported INSIDE main() so the env loader runs first; avoids
// `runWebsiteScan` resolving a stale tenant from a partially-loaded
// process env.
async function main() {
  const startedAt = Date.now();
  const env = process.env;

  // ── Kill switch — check first, before any imports run ──
  const killRaw = env.BEACON_SCAN_DISABLED?.trim().toLowerCase();
  if (killRaw === "1" || killRaw === "true" || killRaw === "yes" || killRaw === "on") {
    console.warn(
      "[scheduled-scan] BEACON_SCAN_DISABLED is set — exiting 0 without invoking runWebsiteScan",
    );
    process.exit(0);
  }

  // ── Required env (fail-loud) ──
  const tenantId = env.BEACON_TENANT_ID?.trim();
  const tenantSlug = env.BEACON_TENANT_SLUG?.trim();
  if (!tenantId) {
    console.error(
      "[scheduled-scan] BEACON_TENANT_ID is required (set as GH Actions secret)",
    );
    process.exit(1);
  }
  if (!tenantSlug) {
    console.error(
      "[scheduled-scan] BEACON_TENANT_SLUG is required for tenant-routed scan outputs (set as GH Actions secret)",
    );
    process.exit(1);
  }

  console.log("[scheduled-scan] starting runWebsiteScan({ trigger: 'cron' })");
  console.log("[scheduled-scan] env (operational):", {
    // Phase 6D (2026-04-28) — log the source label so the GH Actions log
    // makes it explicit which hosted scan path is firing. Local invocations
    // (without the var set) will show "(unset)" and fall back to the CLI's
    // historical "scan-owned-pages.ts" literal in observation_runs.source.
    BEACON_SCAN_SOURCE_LABEL: env.BEACON_SCAN_SOURCE_LABEL ?? "(unset)",
    BEACON_LIFECYCLE_ENABLED: env.BEACON_LIFECYCLE_ENABLED ?? "(unset)",
    BEACON_LIFECYCLE_VERDICT_ENABLED: env.BEACON_LIFECYCLE_VERDICT_ENABLED ?? "(unset)",
    DATA_SOURCE: env.DATA_SOURCE ?? "(unset)",
    DUAL_WRITE: env.DUAL_WRITE ?? "(unset)",
    BEACON_TENANT_ID: tenantId,
    BEACON_TENANT_SLUG: tenantSlug,
    BEACON_SITE_DOMAIN: env.BEACON_SITE_DOMAIN ?? "(unset — falls back to .data/business-config)",
  });

  // North-star onboarding (2026-06-11): a self-served tenant has no env
  // blob and no .data on this runner — its config lives in the
  // per-tenant business_config row written at launch. Hydrate it into
  // the config cache BEFORE the scan engines resolve config (hydrate
  // runs the sync chain first, so the operator env blob still wins for
  // the hand-configured tenants).
  {
    const { hydrateBusinessConfigFromSupabase } = await import(
      "../src/lib/business-config"
    );
    const hydrated = await hydrateBusinessConfigFromSupabase(tenantId);
    console.log(
      `[scheduled-scan] business-config: ${hydrated ? `resolved (${hydrated.domain || "no domain"})` : "PLACEHOLDER — no env/file/db config for this tenant"}`,
    );
  }

  // Lazy import — env must be set before orchestrate-scan resolves
  // tenant context at module load.
  const { runWebsiteScan } = await import(
    "../src/domains/scanning/orchestrate-scan"
  );

  let result;
  try {
    result = await runWebsiteScan({ trigger: "cron" });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[scheduled-scan] FATAL after ${elapsedMs}ms: ${msg}`,
    );
    process.exit(2);
  }

  const elapsedMs = Date.now() - startedAt;
  // Phase 6D (2026-04-28) — surface the durable lifecycle summary that
  // orchestrate-scan persisted into the last-scan-result payload. Means
  // "did the runner run? what did it do?" is answerable from the GH
  // Actions log alone, in addition to the durable file under
  // .data/global/last-scan-result.json.
  console.log(
    `[scheduled-scan] completed (${elapsedMs}ms):`,
    JSON.stringify(
      {
        ok: result.ok,
        phase: result.phase,
        pagesScanned: result.payload?.pagesScanned ?? 0,
        findingsAdded: result.findingsAdded,
        source: result.payload?.source ?? null,
        tenantId: result.payload?.tenantId ?? null,
        trigger: result.payload?.trigger ?? null,
        lifecycle: result.payload?.lifecycle ?? null,
        error: result.error ?? null,
      },
      null,
      2,
    ),
  );

  if (!result.ok) {
    console.error(
      `[scheduled-scan] result.ok=false — exiting 1 so GH surfaces the failure`,
    );
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[scheduled-scan] uncaught error:", err);
  process.exit(2);
});
