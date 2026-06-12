/**
 * run-scheduled-generation — P0 wall 1 (2026-06-10): the queue refills
 * while you sleep.
 *
 * Nightly per-tenant recommendation generation: trigger candidates →
 * safety gates → score → dedupe/cooldowns → promote into the
 * recommendation queue (`recommended_edits`, status "recommended").
 * Invoked per tenant by .github/workflows/nightly-generation.yml
 * (matrix from scripts/list-active-tenants.ts — same fleet as scan/poll),
 * AFTER the 04:00 UTC scan (fresh snapshots) and BEFORE the 07:00 UTC
 * poll. Promotion is DETERMINISTIC — no LLM, no paid API calls.
 *
 * Safety:
 *   • Writes are queue-only. NOTHING here publishes — pushes still
 *     require the operator's explicit approve click. (Master-goal
 *     invariant untouched.)
 *   • Honors the SAME env gate as the operator surface:
 *     BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true" → live write;
 *     anything else → dry-run REPORT mode (computes + logs what would
 *     land, writes nothing). The workflow sets it explicitly so the
 *     mode is visible in the job env, never implicit.
 *   • BEACON_GENERATION_DISABLED kill switch (same contract as
 *     BEACON_SCAN_DISABLED): truthy → exit 0 no-op, loudly.
 *   • Idempotent re-runs: rec ids are deterministic; the local persist
 *     upserts by id and the Supabase dual-write upserts on
 *     (tenant_id, rec_id, action_type, target_element_key).
 *   • Per-run caps live in the promotion engine itself (max 5 rows per
 *     page, 10 per trigger family, 13-gate safety ladder + cooldowns).
 *
 * Exit codes: 0 = completed (including dry-run + kill-switch no-op);
 * 1 = generation threw or env was invalid (workflow alerts on failure).
 */

export type GenerationMode = {
  dryRun: boolean;
  reason:
    | "live_write_enabled"
    | "live_write_disabled_report_only";
};

/**
 * Pure mode resolution (exported for tests). STRICT match mirrors
 * isPromotionLiveWriteEnabled(): only the exact string "true" enables
 * live writes; everything else (unset, "1", "True", "yes") is a
 * dry-run report. Deliberately the same semantics as the operator
 * surface so an env value means ONE thing everywhere.
 */
export function resolveGenerationMode(env: NodeJS.ProcessEnv): GenerationMode {
  if (env.BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true") {
    return { dryRun: false, reason: "live_write_enabled" };
  }
  return { dryRun: true, reason: "live_write_disabled_report_only" };
}

/** Kill-switch parse — same truthy set as BEACON_SCAN_DISABLED. */
export function isGenerationDisabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.BEACON_GENERATION_DISABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

async function main() {
  const startedAt = Date.now();
  const env = process.env;

  if (isGenerationDisabled(env)) {
    console.warn(
      "[scheduled-generation] BEACON_GENERATION_DISABLED is set — exiting 0 without generating",
    );
    process.exit(0);
  }

  const tenantId = env.BEACON_TENANT_ID?.trim();
  const tenantSlug = env.BEACON_TENANT_SLUG?.trim();
  if (!tenantId) {
    console.error("[scheduled-generation] BEACON_TENANT_ID is required");
    process.exit(1);
  }
  if (!tenantSlug) {
    console.error(
      "[scheduled-generation] BEACON_TENANT_SLUG is required for tenant-routed queue writes",
    );
    process.exit(1);
  }

  const mode = resolveGenerationMode(env);
  console.log("[scheduled-generation] starting promoteEligibleCandidates", {
    tenantId,
    tenantSlug,
    mode: mode.reason,
    dryRun: mode.dryRun,
    DATA_SOURCE: env.DATA_SOURCE ?? "(unset)",
    DUAL_WRITE: env.DUAL_WRITE ?? "(unset)",
  });

  // North-star onboarding (2026-06-11): hydrate a self-served tenant's
  // per-tenant business_config row into the config cache before the
  // generation engines resolve config (sync chain still wins for the
  // env-blob tenants; placeholder logged honestly).
  {
    const { hydrateBusinessConfigFromSupabase } = await import(
      "../src/lib/business-config"
    );
    const hydrated = await hydrateBusinessConfigFromSupabase(tenantId);
    console.log(
      `[scheduled-generation] business-config: ${hydrated ? `resolved (${hydrated.domain || "no domain"})` : "PLACEHOLDER — no env/file/db config for this tenant"}`,
    );
  }

  // Insight Graph slice 1 (2026-06-12): sync the tenant's GSC Search
  // Analytics rows BEFORE promotion so the gsc_low_ctr predicate sees
  // fresh 28-day signals. Failure-soft by contract: no GSC connection,
  // quota, or table issues log one line and never block generation.
  try {
    const { syncGscSearchAnalyticsForTenant } = await import(
      "../src/lib/connectors/gsc/sync-search-analytics"
    );
    const gsc = await syncGscSearchAnalyticsForTenant({ tenantId });
    console.log(
      gsc.synced
        ? `[scheduled-generation] GSC-SA synced tenant=${tenantId} property=${gsc.property} days=${gsc.days} rows=${gsc.rows_upserted}`
        : `[scheduled-generation] GSC-SA skipped tenant=${tenantId} reason=${gsc.reason}`,
    );
  } catch (err) {
    console.warn(
      `::warning::[scheduled-generation] GSC-SA sync failed (generation continues): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Insight Graph slice 2 (2026-06-12): SEMrush organic-keyword sync
  // (one 150-line domain_organic call = 1,500 units, inside the
  // nightly budget; instant skip when no key). Failure-soft.
  try {
    const { syncSemrushOrganicKeywordsForTenant } = await import(
      "../src/lib/connectors/semrush/sync-organic-keywords"
    );
    const sem = await syncSemrushOrganicKeywordsForTenant({ tenantId });
    console.log(
      sem.synced
        ? `[scheduled-generation] SEMRUSH synced tenant=${tenantId} domain=${sem.domain} rows=${sem.rows_upserted}`
        : `[scheduled-generation] SEMRUSH skipped tenant=${tenantId} reason=${sem.reason}`,
    );
  } catch (err) {
    console.warn(
      `::warning::[scheduled-generation] SEMrush sync failed (generation continues): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Lazy import — env must be set before tenant context resolves.
  const { promoteEligibleCandidates } = await import(
    "../src/domains/recommendation-intelligence/promotion-writer"
  );

  try {
    const result = await promoteEligibleCandidates({
      tenantId,
      dryRun: mode.dryRun,
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[scheduled-generation] DONE tenant=${tenantId} dryRun=${result.dryRun} ` +
        `candidates=${result.candidate_count} eligible=${result.eligible_count} ` +
        `promoted=${result.promoted_count} skipped=${result.skipped_count} ` +
        `elapsedMs=${elapsedMs}`,
    );
    if (result.sync_warning) {
      // Dual-write degraded — the local write landed but Supabase didn't.
      // Loud (workflow log + ::warning) but not fatal: the runner's local
      // FS is ephemeral, so a sync warning in CI means the night's rows
      // did NOT persist — surface it as a job failure instead.
      console.error(
        `::error::[scheduled-generation] Supabase sync failed — promoted rows did not persist durably: ${result.sync_warning}`,
      );
      process.exit(1);
    }
    if (mode.dryRun && result.eligible_count > 0) {
      console.log(
        `[scheduled-generation] REPORT-ONLY: ${result.eligible_count} eligible row(s) NOT written ` +
          `(set BEACON_PROMOTION_LIVE_WRITE_ENABLED=true to refill the queue nightly)`,
      );
    }
    // Watchdog heartbeat (2026-06-11): one observation_runs row per
    // completed generation so the 11:00 UTC nightly watchdog can detect
    // a missed run and re-dispatch this workflow. Best-effort — a
    // heartbeat failure must never fail the night's generation.
    try {
      const { syncObservationRuns } = await import("../src/lib/persistence/dual-write");
      const nowIso = new Date().toISOString();
      await syncObservationRuns(
        [
          {
            run_id: `gen-${Date.now()}`,
            tenant_id: tenantId,
            run_type: "generation",
            source: "run-scheduled-generation.ts",
            status: "completed",
            started_at: new Date(startedAt).toISOString(),
            completed_at: nowIso,
            scope_label: `Nightly generation · candidates=${result.candidate_count} promoted=${result.promoted_count} dryRun=${result.dryRun}`,
            parser_version: undefined,
            baseline_run_id: null,
            pages_scanned: 0,
            pages_changed: 0,
            pages_with_errors: 0,
            guardrail_alerts: 0,
            critical_count: 0,
            regression_count: 0,
            improvement_count: 0,
          },
        ],
        tenantId,
      );
    } catch (err) {
      console.warn(
        `[scheduled-generation] heartbeat write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Queue hygiene (#114/#49, 2026-06-11): expire stale auto-promoted
    // cards (TTL + per-tenant cap) AFTER tonight's promotion, live mode
    // only. A sweep failure is loud but not fatal — the night's
    // promotion already landed; the sweep retries tomorrow.
    if (!mode.dryRun) {
      try {
        const { sweepQueueForTenant } = await import(
          "../src/domains/recommendations/queue-sweeper"
        );
        const sweep = await sweepQueueForTenant(tenantId);
        console.log(
          `[scheduled-generation] SWEEP tenant=${tenantId} expiredTtl=${sweep.expiredTtl} ` +
            `expiredOverflow=${sweep.expiredOverflow} pendingAfter=${sweep.pendingAfter}` +
            (sweep.sync_warning ? ` sync_warning=${sweep.sync_warning.slice(0, 120)}` : ""),
        );
      } catch (err) {
        console.error(
          `::warning::[scheduled-generation] queue sweep failed (promotion already landed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Wix url-map nightly re-sync (#111, 2026-06-11): new CMS items
    // appear daily on a content site; a stale map silently shrinks the
    // pushable set. No-ops cleanly when the tenant has no Wix connector
    // or no collection mappings. Best-effort.
    if (!mode.dryRun) {
      try {
        const { getTenant } = await import("../src/domains/tenants/store");
        const tenant = await getTenant(tenantId);
        if (tenant?.publish_target === "wix_cms") {
          const { getConnectorToken } = await import("../src/lib/connector-store");
          const token = await getConnectorToken("wix", tenantId);
          if (token) {
            const { syncWixUrlMap } = await import("../src/lib/connectors/wix/url-map");
            const sync = await syncWixUrlMap({
              siteBaseUrl: `https://${(tenant.domain || "").replace(/^https?:\/\//, "")}`,
            });
            console.log(
              `[scheduled-generation] URL-MAP tenant=${tenantId} ok=${sync.ok} collections=${sync.collections} itemsMapped=${sync.itemsMapped}` +
                (sync.errors.length > 0 ? ` errors=${sync.errors.length}` : "") +
                ` probe=${sync.probe.ok}/${sync.probe.checked}`,
            );
            if (sync.probe.failures.length > 0) {
              console.warn(
                `::warning::[scheduled-generation] url-map probe failures (mapping may be wrong): ${sync.probe.failures.join("; ").slice(0, 300)}`,
              );
            }
          } else {
            console.log(`[scheduled-generation] URL-MAP tenant=${tenantId} skipped=no_wix_connector`);
          }
        }
      } catch (err) {
        console.warn(
          `::warning::[scheduled-generation] wix url-map re-sync failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Competitor auto-seed (#24, 2026-06-11): persist newly discovered
    // direct rivals into the tenant's universe (≤8/night, idempotent).
    // Best-effort — discovery data may simply not exist yet.
    if (!mode.dryRun) {
      try {
        const { autoSeedCompetitorsForTenant } = await import(
          "../src/domains/competitors/auto-seed"
        );
        const seeded = await autoSeedCompetitorsForTenant(tenantId);
        console.log(
          `[scheduled-generation] AUTO-SEED tenant=${tenantId} ` +
            ("skipped" in seeded
              ? `skipped=${seeded.skipped}`
              : `seeded=${seeded.seeded} domains=${seeded.domains.join(",")}`),
        );
      } catch (err) {
        console.warn(
          `::warning::[scheduled-generation] competitor auto-seed failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // Causal Proof Engine (2026-06-11 day shift): attribute each shipped
    // edit against comparable untreated URLs (diff-in-diff) and persist
    // the customer-facing outcome rows that light up the "Proof" drilldown
    // on /changes/[id]. Runs AFTER promotion, live mode only (the rows are
    // derived analytics, but a dry-run/CI run has an ephemeral FS so the
    // persist wouldn't land durably without dual-write — match the other
    // persisting steps). 100% deterministic, NO paid API. Best-effort: the
    // engine reads existing changelog + citation history, so a failure here
    // never affects tonight's promotion — it simply recomputes tomorrow.
    if (!mode.dryRun) {
      try {
        const { buildAndPersistTenantProof } = await import(
          "../src/domains/attribution/proof-engine"
        );
        const proof = await buildAndPersistTenantProof(tenantId);
        console.log(
          `[scheduled-generation] PROOF tenant=${tenantId} ` +
            `classified=${proof.events_classified} computed=${proof.computed} ` +
            `weak=${proof.weak} watching=${proof.watching} persisted=${proof.persisted} ` +
            `skipped_ineligible=${proof.skipped_ineligible} ` +
            `by_status=${JSON.stringify(proof.by_status)}`,
        );
      } catch (err) {
        console.warn(
          `::warning::[scheduled-generation] proof engine failed (promotion already landed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(
      `::error::[scheduled-generation] generation failed for ${tenantId}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
    );
    process.exit(1);
  }
}

// CLI guard (same pattern as list-active-tenants.ts) so tests can import
// the pure helpers without running a generation.
const invokedAsCli =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === "string" &&
  /(?:^|\/)run-scheduled-generation\.[cm]?[jt]s$/.test(process.argv[1]);

if (invokedAsCli) {
  main().catch((err) => {
    console.error(
      `::error::[scheduled-generation] crashed: ${err instanceof Error ? err.stack : String(err)}`,
    );
    process.exit(1);
  });
}
