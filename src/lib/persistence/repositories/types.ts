import type { Result } from "@/domains/measurement/results/types";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import type { Opportunity } from "@/domains/decision/opportunities/types";
import type { ImportRun } from "@/lib/import/types";
import type { Finding } from "@/domains/evidence/scanning/types";
import type { ChangeContract } from "@/domains/measurement/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
} from "@/domains/evidence/pages/types";
import type { RobotsStateFile } from "@/domains/evidence/pages/robots-parser";
import type { ObservationRun } from "@/domains/evidence/observations/types";
import type { RecommendationResponse } from "@/domains/evidence/product/recommendation-response-store";
import type { DailyMetricSnapshot } from "@/domains/evidence/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/evidence/ai-visibility/tracked-entities";
import type { TrackedPrompt } from "@/domains/evidence/ai-visibility/tracked-prompts";

/**
 * Async read interface for route-critical and repository-routed stores.
 *
 * **Canonical runtime:** With `DATA_SOURCE=supabase`, Postgres is the read source
 * for tables that exist; file/json-store remains the durability + rollback path
 * via dual-write and `DATA_SOURCE=file`.
 *
 * App code: use `getRepository()` — not `readStore` / raw `readDotDataJson` —
 * except documented exceptions (see `docs/architecture.md`).
 */
/** Link-graph feed (2026-06-12 night shift): the lean snapshot
 *  projection (EGRESS-P0) deliberately omits `internal_links`, which
 *  starved the cross-page link triggers on hosted/cron (their
 *  emptiness guards silently emitted 0). This narrow row carries ONLY
 *  the link graph — fetched once per generation run, never by the
 *  web surfaces the egress pin protects. */
export type PageSnapshotLinkGraph = {
  page_id: string;
  url: string;
  fetched_at: string;
  tenant_id: string;
  internal_links: { href: string; anchor_text: string }[];
  word_count?: number;
  extraction_certainty?: PageSnapshot["extraction_certainty"];
};

export interface SeedDataRepository {
  // Phase 1B — seed-data entities
  getImportRuns(): Promise<ImportRun[]>;
  getResults(): Promise<Result[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getOpportunities(): Promise<Opportunity[]>;

  // Phase 1D — centralized store modules
  // (getEventDecisions / getCandidateLinks / getPageIssues removed
  // 2026-07-21, CORE 100K Lane O: zero prod and zero test callers.)
  getChangeContracts(): Promise<ChangeContract[]>;

  // Phase 1E — remaining route-critical stores
  getPages(): Promise<PageEntity[]>;
  getPageSnapshots(): Promise<PageSnapshot[]>;
  /** Scoped link-graph read — see PageSnapshotLinkGraph. */
  getPageSnapshotLinkGraphs(): Promise<PageSnapshotLinkGraph[]>;

  // Phase 7 — scan findings via repository
  getScanFindings(): Promise<Finding[]>;
  getObservationRuns(): Promise<ObservationRun[]>;

  /**
   * json-store-backed operator / pages domain state — no Postgres tables yet.
   * Both backends delegate to `readStore` so DATA_SOURCE=supabase keeps the same
   * in-process cached array references as file mode (mutation + writeStore paths).
   *
   * 2026-07-21 (CORE 100K Lane O): the dead columns of this block
   * (rollout/pattern/frontier/wave/asset/outcome/truth-label reads, the
   * legacy-global sitemap/diff/render/visibility reads, page summaries,
   * and the citation/answer-intel index reads) were deleted — zero prod
   * and zero test callers. The tenant-scoped sitemap pair on
   * `TenantRepository` below is LIVE and untouched.
   */

  // Phase 1a — operator loop stores
  getRecommendationResponses(): Promise<RecommendationResponse[]>;

  // Sprint 6A.1 Phase 12 (2026-04-24) — specific edits read path.
  // Fetched fresh per request on /recommendations (Sprint 1 pattern).

  // Phase 3.5E — hosted hero-surface data (visibility score / rankings /
  // competitor comparison / entity universe). File backend wraps existing
  // canonical-store consts; Supabase backend fetches from the corresponding
  // tables with explicit paging for the large ones.
  getDailyMetricSnapshots(): Promise<DailyMetricSnapshot[]>;
  getTrackedEntities(): Promise<TrackedEntity[]>;
  getTrackedPrompts(): Promise<TrackedPrompt[]>;

  // Sprint 7 Phase 7.5a (2026-04-25) — tenant-bound facade. Returns a
  // `TenantRepository` whose every method filters rows down to one tenant.
  // Phase 7.5b/c will convert call sites to `.forTenant(...).getX()`.
  // Phase 7.8+ will move these methods OFF this base so unscoped reads
  // become a compile error.
  forTenant(tenantId: string): TenantRepository;
}

/**
 * Sprint 7 Phase 7.5a — tenant-scoped read interface. Subset of
 * `SeedDataRepository` containing only methods that read from
 * tenant-scoped storage (Supabase tables with a `tenant_id` column or
 * `.data/*.json` files whose rows carry a `tenant_id` field).
 *
 * Methods from `SeedDataRepository` that read GLOBAL stores
 * (change-patterns, business-config, tenants registry, file-only
 * artifacts like the citation evidence index) intentionally stay OFF
 * this interface — global data crosses tenants by design.
 */
/**
 * E3 (operator audit, 2026-05-05) — optional date-window for the two
 * heaviest tenant reads. Callers that only need recent data (e.g.,
 * /today's enrichment rollup operates on the last 7-30 days) can pass
 * a `since` ISO date and avoid pulling the full ~14k-row history.
 *
 * Default behavior unchanged: omitting the option pulls all rows
 * for backwards compatibility. Scripts (verify-daily-poll, materialize,
 * citation-rebuild) that genuinely need full history don't have to
 * change anything.
 */
type WindowedReadOptions = {
  /** ISO date string (YYYY-MM-DD or full ISO timestamp). Filters the
   *  read at the database with `<column> >= since` so the rows never
   *  cross the wire. */
  since?: string;
  /**
   * Optional lean PostgREST projection (comma-separated columns) pushed
   * to the DB so only the requested columns cross the wire. Default `*`.
   * The Supabase backend honors it (via `queryAllPagedScoped`); the file
   * backend returns full in-memory rows (the projection is a wire-cost
   * optimization, not a contract — callers MUST only read columns they
   * requested). Used by /today's canonical `daily_metric_snapshots`
   * read, whose sole consumer (`deriveBrainFromTodayInputs`, typed
   * `{ date: string }[]`) needs only `date` for two counts, so pulling
   * the full ~497-byte JSONB-carrying rows was ~90% wasted egress.
   */
  columns?: string;
};


export interface TenantRepository {
  getPages(): Promise<PageEntity[]>;
  getPageSnapshots(): Promise<PageSnapshot[]>;
  /** Scoped link-graph read — see PageSnapshotLinkGraph. */
  getPageSnapshotLinkGraphs(): Promise<PageSnapshotLinkGraph[]>;
  /**
   * Phase A.3 (post-A.3.5) — tenant-scoped robots-state read. Supabase-
   * backend reads `public.robots_state` filtered by tenant_id. File-
   * backend reads via the tenant-routed `readDotDataJson("robots-state")`
   * path (SINGLETON classification already correct; the pre-A.3
   * flat-path file is retired by the robots-parser retrofit landing
   * in the same step). Soft-fails to null when the migration hasn't
   * applied yet OR when no scan has run for this tenant.
   */
  getRobotsState(): Promise<RobotsStateFile | null>;
  /**
   * Phase A.3 (post-A.3.5) — paired write. Dual-writes to Supabase +
   * tenant-routed disk. FAIL-LOUD on missing table.
   */
  setRobotsState(state: RobotsStateFile): Promise<void>;
  getRecommendationResponses(): Promise<RecommendationResponse[]>;
  /** Night-shift (2026-06-11) — tenant-scoped change contracts. */
  getChangeContracts(): Promise<ChangeContract[]>;
  // (Tenant-scoped getPageIssues / getEventDecisions / getCandidateLinks
  // and the citation/answer-intel index reads removed 2026-07-21,
  // CORE 100K Lane O: zero prod and zero test callers.)
  getOpportunities(): Promise<Opportunity[]>;
  getChangelogEntries(): Promise<ChangelogEntry[]>;
  getScanFindings(): Promise<Finding[]>;
  getObservationRuns(): Promise<ObservationRun[]>;
  getResults(): Promise<Result[]>;
  getImportRuns(): Promise<ImportRun[]>;
  /** E3 — accepts optional `{ since }` date window. Default: full history. */
  getDailyMetricSnapshots(
    options?: WindowedReadOptions,
  ): Promise<DailyMetricSnapshot[]>;
  /**
   * Customer-2 isolation fix (operator audit, 2026-05-06) —
   * tenant-scoped reads for `tracked_prompts` and `tracked_entities`.
   *
   * Both stores are TENANT_SCOPED in `store-classification.ts`, but
   * the canonical fresh-load path was still calling the unscoped
   * `repo.getTrackedPrompts()` / `repo.getTrackedEntities()`. With
   * customer-2 onboarding on the horizon, that would silently mix
   * Ritz's prompts + competitors into customer-2's /today
   * leaderboard. These tenant-scoped methods close the leak before
   * any second-tenant data lands.
   *
   * Filter shapes:
   *   • File backend: in-memory `tenant_id === tenantId` (rows on
   *     disk already carry both `tenant_id` and `account_id`).
   *   • Supabase backend: `.eq("account_id", tenantSlug)` because the
   *     `tracked_prompts` / `tracked_entities` tables use
   *     `account_id` (the slug) as their tenant-scoping column,
   *     not `tenant_id`. Slug is resolved from the `tenants`
   *     registry via `getTenant(tenantId)`.
   */
  getTrackedPrompts(): Promise<TrackedPrompt[]>;
  getTrackedEntities(): Promise<TrackedEntity[]>;
  // (getProfoundImportRuns removed 2026-07-21, CORE 100K Lane O: the
  // Section 5 repeat-citation loader that consumed it was deleted in an
  // earlier campaign, leaving the whole read path caller-less. The
  // `ProfoundImportRun` type and its phantom import-run plumbing were fully
  // deleted in Slice 2 with the retired provider architecture.)
}
