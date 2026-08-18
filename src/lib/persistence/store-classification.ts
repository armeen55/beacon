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
  "pages",
  "page-snapshots",
  "scan-findings",
  "observation-runs",
  "scan-runs",
  "daily-metric-snapshots",
  "change-contracts",
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "recommendation-responses",
  "competitor-overlap", // the settled "is this domain actually a business competing with you" verdicts, keyed by domain + the evidence they were decided on
  // The one persisted customer-visible release shared by Today and Changes, under a single release id
  // so what is on screen never mixes build generations.
  "customer-surface",
  "results-surface",
  "proof-gsc-ledger",
  "recommended-edits",
  // Per account, never shared: one account must never be served text generated for another.
  "llm-call-cache",
  "llm-budget", // per-account file cap backstop (the durable Supabase ledger is authoritative)
  // Searches this account shares words with and owns no page FOR, banked until the coverage walk takes them.
  "coverage-needs",
]);

export const SINGLETON_STORES = new Set<string>([
  "robots-state",
]);

export const GLOBAL_STORES = new Set<string>([
  "tenants",
  // FLEET LEDGERS. Rows carry tenant_id in-row; the writers run with no ambient request context, so
  // per-tenant path routing would misfile them.
  "refresh-runs",
  "crawl-frontier",
  "app-errors",
  "winner-memory",
  "gsc-fresh-tail",
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
