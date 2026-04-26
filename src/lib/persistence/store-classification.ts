/**
 * Sprint 7 Phase 7.8b-0 (2026-04-25) — single source of truth for which
 * `.data/*.json` stores are per-tenant, per-tenant singleton, or global.
 *
 * Two consumers:
 *   - Runtime persistence layer (Phase 7.8b-1 / 7.8b-2):
 *       `src/lib/persistence/dotdata-json.ts`
 *       `src/lib/persistence/json-store.ts`
 *     Routes reads/writes to the correct subdirectory based on the
 *     classification.
 *
 *   - Migration CLI (Phase 7.8a):
 *       `scripts/migrate-flat-to-tenant-data.ts`
 *     Re-exports these Sets and uses them to plan the flat → per-tenant
 *     move.
 *
 * Keeping a single source prevents drift — a store accidentally
 * promoted to global at the migration layer but still tenant-routed at
 * runtime would silently leak across tenants. The shared classification
 * makes that class of bug structurally impossible.
 *
 * Classification rules (verified by Phase 7.8a.1 audit):
 *
 *   - per-tenant array store    → `.data/tenants/{slug}/{name}.json`
 *                                  filtered to ritz-tenant rows in the
 *                                  flat → tenant migration; written
 *                                  per-tenant in 7.8b runtime.
 *
 *   - per-tenant singleton      → `.data/tenants/{slug}/{name}.json`
 *                                  copied verbatim (single object, not
 *                                  an array of rows).
 *
 *   - global                    → `.data/global/{name}.json`
 *                                  cross-tenant: registry, singleton
 *                                  config, operator-shared learning.
 *
 *   - unknown                   → not migrated; runtime falls through
 *                                  to flat (7.8b read-only fallback)
 *                                  or returns null/empty.
 */

export const TENANT_SCOPED_STORES = new Set<string>([
  // Inherited from scripts/backfill-tenant-id.ts (38 stores).
  "imported-results",
  "imported-changes",
  "imported-opportunities",
  "imported-competitors",
  "import-runs",
  "event-decisions",
  "candidate-links",
  "pages",
  "page-snapshots",
  "page-snapshots-prev",
  "page-guardrails",
  "page-issues",
  "scan-findings",
  "observation-runs",
  "scan-runs",
  "daily-metric-snapshots",
  "experiments",
  "change-outcomes",
  "change-contracts",
  "truth-labels",
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "local-reviews",
  "page-visibility",
  "recommendation-responses",
  "action-states",
  "brief-states",
  "rollout-executions",
  "pattern-evidence",
  "frontier-attack-packages",
  "tracked-missing-pages",
  "asset-responses",
  "outcome-store",
  "competitor-page-evidence",
  "source-pattern-evidence",
  "render-checks",
  "page-snapshot-diffs",
  // Phase 7.8a.1 (2026-04-25) — classified from the live dry-run.
  // 9 stores added; rationale recorded in docs/VERIFICATION_LOG.md.
  "change-events", // per-tenant Phase 0 truth-layer events
  "classified-events", // per-tenant taxonomy classification of historical changes
  "data-quality-flags", // per-tenant data-quality flags for ingestion windows
  "event-attributions", // per-tenant attribution verdicts on change-events
  "natural-control-results", // per-tenant natural-control attribution per event
  "page-element-inventory", // Sprint 6A.1 P6; rows already carry tenant_id
  "recommended-edits", // Sprint 6A.1 P11; rows already carry tenant_id
  "site-movement-events", // per-tenant Phase 0 movement events
  "url-change-outcomes", // Tier A; rows already carry tenant_id
  // Phase 7.8d-1 (2026-04-26) — flat-fallback removal exposed runtime
  // calls to these stores. Classified now (no migration since flat
  // files weren't on disk for any of them).
  "outcome-events", // canonical-store array of per-tenant event detections
  "rollout-waves", // operator-managed pattern rollouts; single-operator scoped
  "candidate-causes", // canonical-store per-tenant cause-candidate array
  "outcome-observations", // per-tenant outcome-watch row array
  "visibility-observation-runs", // per-tenant visibility import runs (disk-backed)
]);

export const SINGLETON_STORES = new Set<string>([
  "answer-intelligence-index",
  "citation-evidence-index",
  // Phase 7.8a.1 (2026-04-25) — per-tenant singletons added from
  // the live dry-run. Each is a single object scoped to one tenant
  // (or trivially scoped because the operator runs one site today).
  "change-outcomes-summary", // aggregate of change-outcomes
  "natural-control-summary", // aggregate of natural-control-results
  "robots-state", // per-tenant parsed robots.txt for the tenant's domain
  "site-citation-timeline", // per-tenant timeline; root object carries tenant_id
  "taxonomy-distribution-report", // aggregate of classified-events
  "url-daily-citations", // per-tenant daily citation series (single-entry)
  "url-watcher-state", // per-tenant watcher throttle/phase state
  // Phase 7.8d-1 (2026-04-26) — single object loaded by `loadLocalOperatorImport`.
  "local-operator-surface", // operator-edited local-listings notes (optional)
]);

export const GLOBAL_STORES = new Set<string>([
  "tenants",
  "change-patterns",
  "triage-rules",
  "confidence-calibration",
  "business-config",
  "competitor-universe",
  "competitor-monitoring",
  "co-mention-matrix",
  "exit-gates",
  "milestone-state",
  "scan-state",
  "last-scan-result",
  "sitemap-reconciliation",
  "prompt-library",
  "answer-texts",
  "cost-ledger",
  // Phase 7.8a.1 (2026-04-25) — globals added from the live dry-run.
  // Each is operator-shared / cross-tenant by design.
  "adjudicator-cache", // LLM dedup cache, no tenant_id; operator-shared
  "adjudicator-history", // LLM call audit log; operator-shared
  "llm-budget", // operator-paid monthly LLM spend cap
  "shared-brain", // explicit cross-tenant pattern aggregate
  "shared-brain-summary", // aggregate of shared-brain
  "url-change-patterns", // global learning aggregate (mirror of change-patterns)
  // Phase 7.8d-1 (2026-04-26) — explicit cross-tenant pattern store.
  // Self-documented as global in src/domains/global-patterns/store.ts.
  "global-patterns",
]);

/**
 * Scope of a `.data` store. Used by both the migration script (Phase
 * 7.8a) and the runtime persistence layer (Phase 7.8b).
 *
 *   - `per-tenant`: array of rows, each carrying `tenant_id` (or
 *     stamped at the helper boundary). Lives in
 *     `.data/tenants/{slug}/{name}.json`.
 *   - `singleton`:  single object scoped to one tenant. Same path
 *     as per-tenant; the helper does NOT array-filter.
 *   - `global`:     cross-tenant data. Lives in
 *     `.data/global/{name}.json`.
 *   - `unknown`:    not in any of the three Sets. Phase 7.8b runtime
 *     falls back to flat `.data/{name}.json` (read-only, logged).
 *     Phase 7.8a migration leaves these alone.
 */
export type StoreScope = "per-tenant" | "singleton" | "global" | "unknown";

/**
 * Pure / no I/O. Single classification dispatch shared by every
 * caller. Returns `unknown` for any store name not in the three Sets
 * — that's the signal for "operator hasn't classified yet" and triggers
 * the safe fallback path in runtime helpers.
 */
export function classifyStore(name: string): StoreScope {
  if (TENANT_SCOPED_STORES.has(name)) return "per-tenant";
  if (SINGLETON_STORES.has(name)) return "singleton";
  if (GLOBAL_STORES.has(name)) return "global";
  return "unknown";
}
