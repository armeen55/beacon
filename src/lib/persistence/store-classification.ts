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
  // T-CompPageBlueprints (2026-05-08) — per-tenant store of HTML
  // snapshots of TOP-N competitor pages, captured manually by
  // `scripts/scan-competitor-pages.ts`. Used by the LLM packet
  // builder to populate `competitorPageBlueprints[].h1/topH2s/
  // faqQuestions/metaDescription` (replacing the prior hardcoded
  // null/[] producer). Lifecycle is decoupled from
  // `competitor-page-evidence` (citation-derived, frequent) so
  // structural fetches stay rare and bounded.
  "competitor-page-snapshots",
  // 2026-06-09 §competitor-intel — structural changes detected when a
  // fresh competitor-page fetch differs from the stored snapshot
  // (FAQ added, new sections, retitle, meta added). Written by
  // refresh-intel.ts at fetch time (the snapshot store keeps
  // latest-per-URL, so the diff only exists at that moment); read by
  // move detection ("steal this move").
  "competitor-structural-changes",
  // De-vert/isolation (2026-06-15): competitor-monitoring holds a tenant's
  // OWN competitor sitemap snapshots + recentChanges (which feed Today's
  // competitor alerts). It was GLOBAL — so every tenant read the founder's
  // builder competitors (Iranopedia's dashboard showed "De Mattei
  // Construction"), and concurrent crawls clobbered one shared file.
  // Now per-tenant: each tenant gets its own snapshots; an un-crawled tenant
  // gets EMPTY_STATE (no cross-tenant bleed).
  "competitor-monitoring",
  // 2026-06-09 §competitor-intel — durable history of sitemap-level
  // competitor page changes (added/updated). The per-tenant
  // competitor-monitoring state REPLACES recentChanges on every crawl
  // (Today's alerts read it); move detection needs a rolling window,
  // so each refresh appends here too.
  "competitor-sitemap-changes",
  // 2026-06-10 §push — publish layer stores (tenant-scoped):
  //   push-ledger: per-day push counts + outcomes (Invariant-3 caps math)
  //   wix-url-map: canonical page URL → Wix CMS (collection, item)
  //   wix-collection-config: operator-entered dynamic-page mappings
  "push-ledger",
  // Night-shift #82 (2026-06-11): pre-push field snapshots — the
  // revert safety net (one row per field write, capped 1000).
  "push-snapshots",
  "wix-url-map",
  "wix-collection-config",
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
  // Phase 7.8e-4b follow-up (2026-04-26) — production build prerender of
  // `/settings/health` (which re-exports `/diagnostics`) failed on Vercel
  // because these two stores were referenced by runtime code paths but
  // missing from every classification Set. Pre-7.8d-1 the flat-fallback
  // hid the misconfiguration; post-7.8d-1 it throws fail-loud. Both rows
  // are conceptually per-tenant (answer-snapshots references per-tenant
  // prompt_ids; frontier-opportunities is computed per-tenant from a
  // tenant's pages and citations). Single-operator Ritz today, so any
  // classification routes correctly; per-tenant matches future scaling.
  "answer-snapshots",
  "frontier-opportunities",
  // Phase A.3 (post-A.3.5, 2026-05-15) — sitemap-reconciliation moved
  // from GLOBAL → TENANT_SCOPED. Previously a single
  // `.data/global/sitemap-reconciliation.json` shared across tenants;
  // now per-tenant. Paired with the Supabase mirror
  // (`public.sitemap_reconciliation`) and the loader's repository
  // read path. Retires the cross-tenant hazard the A.3.3b loader's
  // tenant-domain filter defended against — that filter remains as
  // defense-in-depth.
  "sitemap-reconciliation",
]);

export const SINGLETON_STORES = new Set<string>([
  "answer-intelligence-index",
  "citation-evidence-index",
  // Audit #5 (2026-06-10): co-mention matrix is DERIVED per-tenant
  // competitive data, not operator config. Moved GLOBAL → per-tenant
  // singleton so tenant B never reads tenant A's market. Not
  // Supabase-backed; the /competitors page recomputes on a per-tenant
  // miss, so the move is lossless (one recompute from the tenant's own
  // citations).
  "co-mention-matrix",
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
  "exit-gates",
  "milestone-state",
  "scan-state",
  "last-scan-result",
  // NOTE: "sitemap-reconciliation" was moved to TENANT_SCOPED_STORES
  // as part of Phase A.3 (post-A.3.5, 2026-05-15). See the entry
  // above + the migration in `migrations/<date>_phase_a3_sitemap_reconciliation_mirror.sql`.
  "prompt-library",
  "answer-texts",
  "cost-ledger",
  // Phase 7.8a.1 (2026-04-25) — globals added from the live dry-run.
  // Each is operator-shared / cross-tenant by design.
  "adjudicator-cache", // LLM dedup cache, no tenant_id; operator-shared
  "adjudicator-history", // LLM call audit log; operator-shared
  "llm-budget", // operator-paid monthly LLM spend cap
  "llm-history-specific-edits", // Sprint 6A.2c (2026-04-26) — Specific
  // Edit LLM call audit log; operator-shared budget pot, same shape as
  // adjudicator-history but for the SpecificEditProvider pipeline
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
