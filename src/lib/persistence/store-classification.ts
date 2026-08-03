/**
 * store-classification - THE one answer to "who does this store belong to".
 *
 * Every store is per-tenant (rows belong to one account), a per-tenant singleton (one object per
 * account), or global (cross-account by design: public market-data caches, the account registry,
 * fleet-level ledgers whose rows carry tenant_id and whose writers have no ambient request context).
 * One source prevents drift: a store treated as global in one place and tenant-routed in another is
 * exactly how an account reads another account's rows.
 *
 * The runtime chokepoints (json-store, dotdata-json) THROW on an unclassified store, so an unregistered
 * name surfaces as an error, never as a silent cross-account read.
 */

export const TENANT_SCOPED_STORES = new Set<string>([
  "imported-results",
  "imported-changes",
  "imported-opportunities",
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
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "local-reviews",
  "page-visibility",
  "recommendation-responses",
  "pattern-evidence",
  "asset-responses",
  "outcome-store",
  "competitor-page-audit",
  "competitor-overlap", // the settled "is this domain actually a business competing with you" verdicts, keyed by domain + the evidence they were decided on
  "research-serp-patterns",
  "citation-intelligence-snapshot",
  "worklist-surface",
  // The one persisted customer-visible release shared by Today and Changes, under a single release id
  // so what is on screen never mixes build generations.
  "customer-surface",
  "results-surface",
  "demand-graph-snapshot",
  "wix-url-map",
  "wix-collection-config",
  "proof-gsc-ledger",
  "render-checks",
  "page-snapshot-diffs",
  "page-element-inventory",
  "recommended-edits",
  "url-change-outcomes",
  "outcome-events",
  "rollout-waves",
  "candidate-causes",
  "outcome-observations",
  "visibility-observation-runs",
  "answer-snapshots",
  "sitemap-reconciliation",
  "wikidata-entity-cache",
  "indexnow-receipts",
  // Historical only: the writer is gone, but rows still exist and are read by observation id.
  "answer-texts",
  // Per account, never shared: one account must never be served text generated for another.
  "llm-call-cache",
  "llm-budget", // per-account file cap backstop (the durable Supabase ledger is authoritative)
]);

export const SINGLETON_STORES = new Set<string>([
  "citation-evidence-index",
  "robots-state",
  "url-daily-citations",
  "url-watcher-state",
  "autopilot-state",
  "indexnow-config",
]);

export const GLOBAL_STORES = new Set<string>([
  "tenants",
  "change-patterns",
  "triage-rules",
  "confidence-calibration",
  "business-config",
  "competitor-universe",
  "scan-state",
  "cost-ledger",
  "adjudicator-cache",
  // PUBLIC MARKET DATA, keyed by query and location and carrying no account secret. Global on purpose:
  // shared reuse is what makes the cache TTLs actually prevent re-spending on the same lookup.
  "dataforseo-labs-cache",
  "keyword-gap-results",
  "ai-engine-answers",
  "ai-engine-gap-summary",
  "pipeline-violations",
  // FLEET LEDGERS. Rows carry tenant_id in-row; the writers run with no ambient request context, so
  // per-tenant path routing would misfile them.
  "cron-runs",
  "refresh-runs",
  "site-uptime-probes",
  "crawl-frontier",
  "publish-outbox",
  "backup-verify-receipts",
  // Release-level, not account-level: these certify an immutable application SHA.
  "blind-holdout-receipts",
  "blind-holdout-case-events",
  "trend-query-spikes",
  "seasonal-windows",
  "seasonal-peak-calendar",
  "seasonal-family-profiles",
  "wiki-gap-article-cache",
  "wiki-gap-results",
  "refresh-queue",
  "forecast-calibration",
  "winner-memory",
  "aa-calibration",
  "algorithm-weather-shocks",
  "external-event-ledger",
  "pooled-verdicts",
  "team-scoreboard",
  "adjudicator-history",
  "llm-history-specific-edits",
  "strategy-mix-history",
  "forensic-investigations",
  "page-factory-batches",
  "clone-brief-results",
  "shadow-portfolio-candidates",
  "publish-health",
  "app-errors",
  "opportunity-hypotheses",
  "claim-graph",
  "fact-propagation-plans",
  "gsc-weekly-dimensions",
  "gsc-fresh-tail",
  "gsc-discover-probe",
]);

/** Who a store belongs to. `unknown` = registered nowhere, which the runtime chokepoints throw on. */
export type StoreScope = "per-tenant" | "singleton" | "global" | "unknown";

/**
 * PURE, no I/O. Returns `unknown` rather than throwing on purpose: the fail-loud guarantee lives at the
 * runtime read/write chokepoints, where an unclassified store could actually leak, and callers here
 * legitimately ask the question about a name that may not be registered.
 */
export function classifyStore(name: string): StoreScope {
  if (TENANT_SCOPED_STORES.has(name)) return "per-tenant";
  if (SINGLETON_STORES.has(name)) return "singleton";
  if (GLOBAL_STORES.has(name)) return "global";
  return "unknown";
}
