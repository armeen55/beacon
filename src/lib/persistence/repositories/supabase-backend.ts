/**
 * `DATA_SOURCE=supabase` implementation of `SeedDataRepository`.
 * Route-critical tables read from Postgres; supplementary + json-store-only domains
 * still hit disk (`readDotDataJson` / `readStore`) until migrated — same behavior as
 * pre-cutover direct-file access, centralized here.
 */
import { readDotDataJson } from "../dotdata-json";
import { readStore } from "../json-store";
import { getSupabaseAdmin } from "../supabase";
import type { SeedDataRepository } from "./types";
import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Competitor } from "@/domains/competitors/types";
import type { ImportRun } from "@/lib/import/types";
import type { EventDecision, CandidateLink } from "@/domains/attribution/types";
import type {
  PersistedIssue,
  RolloutExecution,
  PatternEvidenceRecord,
} from "@/domains/pages/issues";
import type { RolloutWave } from "@/domains/pages/wave-planner";
import type { FrontierOpportunity } from "@/domains/pages/frontier-planner";
import type {
  FrontierAttackPackage,
  TrackedMissingPage,
} from "@/domains/pages/frontier-compiler";
import type { AssetResponse } from "@/domains/pages/asset-response";
import type { OutcomeObservation } from "@/domains/pages/outcome-watch";
import type {
  CompetitorPageEvidence,
  SourcePatternEvidence,
} from "@/domains/pages/competitor-evidence";
import type { CompetitorPageSnapshot } from "@/domains/pages/competitor-page-snapshots";
import type { PersistedActionState } from "@/domains/actions/types";
import type { PersistedBriefState } from "@/domains/brief-generation/types";
import type { TruthLabel } from "@/domains/attribution/types";
import type { ChangeContract } from "@/domains/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
  PageSnapshotDiff,
  CitationEvidenceIndex,
  SitemapReconciliation,
} from "@/domains/pages/types";
import type { AnswerIntelligenceIndex } from "@/domains/answer-intelligence/types";
import type { RenderCheckResult } from "@/domains/pages/render-check";
import type { VisibilityObservationRun } from "@/domains/observations/visibility-types";
import type { GuardrailAlert } from "@/domains/pages/guardrails";
import type { ObservationRun } from "@/domains/observations/types";
import type { ConfiguredCompetitorEntry } from "@/domains/competitors/universe-types";
import type { Finding } from "@/domains/scanning/types";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import { mapRowToEntity } from "./key-mapper";

/**
 * E2 (operator audit, 2026-05-05) — egress observability.
 *
 * Wrap every Supabase read with a tiny logger that, when
 * `BEACON_SUPABASE_EGRESS_DEBUG=1`, emits a structured trace per call
 * with table, row count, approximate JSON byte size, duration, and
 * tenant scope. The flag is OFF by default so production logs aren't
 * spammed. Operator runs `BEACON_SUPABASE_EGRESS_DEBUG=1 npm run dev`
 * (or sets the var on Vercel preview) when investigating egress.
 *
 * Approximate JSON byte size = `JSON.stringify(data ?? []).length`.
 * It's not exact wire bytes (PostgREST adds modest framing overhead)
 * but is close enough to spot the heavy offenders.
 *
 * Pure observability. No behavior change.
 */
function logEgress(opts: {
  table: string;
  rows: number;
  data: unknown;
  durationMs: number;
  tenantId?: string | null;
  filter?: string | null;
}): void {
  if (process.env.BEACON_SUPABASE_EGRESS_DEBUG !== "1") return;
  let approxBytes = 0;
  try {
    approxBytes = JSON.stringify(opts.data ?? []).length;
  } catch {
    approxBytes = -1;
  }
  // Simple console line — keeps the logger dependency-free and avoids
  // triggering the structured-logger code path during cold-start tests.
  // eslint-disable-next-line no-console
  console.log(
    `[supabase-egress] table=${opts.table} rows=${opts.rows} bytes≈${approxBytes} ms=${opts.durationMs}${opts.tenantId ? ` tenant=${opts.tenantId}` : ""}${opts.filter ? ` filter=${opts.filter}` : ""}`,
  );
}

async function query<T>(table: string): Promise<T[]> {
  const t0 = Date.now();
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  const rows = (data ?? []) as T[];
  logEgress({ table, rows: rows.length, data: rows, durationMs: Date.now() - t0 });
  return rows;
}

/**
 * Phase 3.5E (2026-04-22) — pages through a table in 1000-row batches. Use
 * this for tables that can exceed PostgREST's default `max-rows` limit
 * (prompt_answer_observations at 11,996 and daily_metric_snapshots at
 * 24,085 both do). One-shot per cold start; results held in-memory by the
 * canonical-store seed layer.
 */
async function queryAllPaged<T>(table: string): Promise<T[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`Supabase query failed on ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  logEgress({ table: `${table}[paged]`, rows: out.length, data: out, durationMs: Date.now() - t0 });
  return out;
}

async function queryMapped<T>(table: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*");
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []).map((row) =>
    mapRowToEntity<T>(row as Record<string, unknown>),
  );
}

// Sprint 7 Phase 7.5b Commit 1C (2026-04-25) — tenant-scoped helpers.
// Push the `tenant_id = ?` filter down to Postgres so the widened indexes
// from Phase 7.5a (`ux_re_tenant_rec_action_element`,
// `ux_pei_tenant_snapshot_element_key`) and the Phase 7.5b/1B PK on
// `recommendation_responses (tenant_id, rec_id)` actually get used. Also
// avoids fetching another tenant's rows just to filter them out in JS.
async function selectScoped<T>(table: string, tenantId: string): Promise<T[]> {
  const t0 = Date.now();
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId);
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  const rows = (data ?? []) as T[];
  logEgress({ table, rows: rows.length, data: rows, durationMs: Date.now() - t0, tenantId });
  return rows;
}

/**
 * E3 (operator audit, 2026-05-05) — windowed paginated reads.
 *
 * Adds an OPTIONAL date-window filter (`since` ISO string) and column
 * projection (`columns`) so callers that only need recent rows or a
 * subset of columns can avoid pulling the entire table.
 *
 * Default behavior unchanged: `since` undefined + `columns` undefined →
 * `select("*")` over all rows for the tenant. Existing scripts /
 * migration helpers keep their full-history reads.
 *
 * `since` filters on `observed_at` (observations) or `for_date`
 * (snapshots) — the column name varies by table, so the caller passes
 * the column name explicitly to avoid coupling.
 */
async function queryAllPagedScoped<T>(
  table: string,
  tenantId: string,
  options?: {
    since?: string;
    sinceColumn?: string;
    columns?: string;
  },
): Promise<T[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  const t0 = Date.now();
  const columns = options?.columns ?? "*";
  for (;;) {
    let query = sb
      .from(table)
      .select(columns)
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE - 1);
    if (options?.since && options?.sinceColumn) {
      query = query.gte(options.sinceColumn, options.since);
    }
    const { data, error } = await query;
    if (error)
      throw new Error(`Supabase query failed on ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  const filterDesc =
    options?.since && options?.sinceColumn
      ? `${options.sinceColumn}>=${options.since}`
      : null;
  logEgress({
    table: `${table}[scoped-paged]`,
    rows: out.length,
    data: out,
    durationMs: Date.now() - t0,
    tenantId,
    filter: filterDesc,
  });
  return out;
}

export const supabaseBackend: SeedDataRepository = {
  // Phase 1B
  getImportRuns: () => query<ImportRun>("import_runs"),
  // results: 1719 rows as of 2026-04-24 — past PostgREST's 1000-row cap.
  getResults: () => queryAllPaged<Result>("results"),
  getChangelogEntries: () => query<ChangelogEntry>("changelog_entries"),
  getOpportunities: () => query<Opportunity>("opportunities"),
  getCompetitors: () => query<Competitor>("competitors"),

  // Phase 1D
  getEventDecisions: () => query<EventDecision>("attribution_decisions"),
  getCandidateLinks: () => query<CandidateLink>("candidate_links"),
  getPageIssues: () => queryMapped<PersistedIssue>("page_issues"),
  getChangeContracts: () => queryMapped<ChangeContract>("change_contracts"),

  // Phase 1E
  // pages: 5929 rows as of 2026-04-24 — past PostgREST's 1000-row cap. Without
  // pagination, buildPageInventory saw only ~3 owned rows on hosted and the
  // resolver fell through to create_new_page for every blocker cluster.
  getPages: () => queryAllPaged<PageEntity>("pages"),
  getPageSnapshots: async () => {
    // Supabase accumulates snapshot history (35 rows per scan).
    // Routes expect only the latest snapshot per page.
    // Order by fetched_at DESC and deduplicate by page_id in application code
    // (PostgREST does not support DISTINCT ON).
    const { data, error } = await getSupabaseAdmin()
      .from("page_snapshots")
      .select("*")
      .order("fetched_at", { ascending: false });
    if (error)
      throw new Error(
        `Supabase query failed on page_snapshots: ${error.message}`,
      );
    const seen = new Set<string>();
    const latest: PageSnapshot[] = [];
    for (const row of (data ?? []) as PageSnapshot[]) {
      if (!seen.has(row.page_id)) {
        seen.add(row.page_id);
        latest.push(row);
      }
    }
    return latest;
  },
  getGuardrailAlerts: () => query<GuardrailAlert>("guardrail_alerts"),

  getCitationEvidenceIndex: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("citation_evidence_index")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on citation_evidence_index: ${error.message}`,
      );
    if (!data) return null;
    return {
      built_at: data.built_at,
      total_citations_processed: data.total_citations_processed,
      by_page_and_topic: data.by_page_and_topic,
      by_topic: data.by_topic,
      page_to_topics: data.page_to_topics,
    } as CitationEvidenceIndex;
  },

  // Phase 3.5E (2026-04-22) — the `answer_intelligence_index` Supabase table
  // exists and is dual-written on import. Read the `data` jsonb column. Stale
  // previously-disk-only comment removed; file backend still reads disk for
  // DATA_SOURCE=file.
  getAnswerIntelligenceIndex: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("answer_intelligence_index")
      .select("*")
      .eq("id", "current")
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on answer_intelligence_index: ${error.message}`,
      );
    if (!data) return null;
    // Row shape: { id, built_at, data: AnswerIntelligenceIndex }
    return (data.data as AnswerIntelligenceIndex) ?? null;
  },

  getObservationRuns: () => query<ObservationRun>("observation_runs"),
  getCompetitorConfigEntries: () =>
    query<ConfiguredCompetitorEntry>("competitor_config"),

  // Supplementary dotdata — no tables yet; read same files as file mode
  getPageSnapshotDiffs: async () =>
    (await readDotDataJson<PageSnapshotDiff[]>("page-snapshot-diffs")) ?? [],

  getRenderChecks: async () =>
    (await readDotDataJson<RenderCheckResult[]>("render-checks")) ?? [],

  getSitemapReconciliation: async () =>
    await readDotDataJson<SitemapReconciliation>("sitemap-reconciliation"),

  getVisibilityObservationRunsExplicit: async () =>
    (await readDotDataJson<VisibilityObservationRun[]>(
      "visibility-observation-runs",
    )) ?? [],

  getRolloutExecutions: async () =>
    readStore<RolloutExecution>("rollout-executions"),
  getPatternEvidence: async () =>
    readStore<PatternEvidenceRecord>("pattern-evidence"),
  getRolloutWaves: async () => readStore<RolloutWave>("rollout-waves"),
  getFrontierOpportunities: async () =>
    readStore<FrontierOpportunity>("frontier-opportunities"),
  getFrontierAttackPackages: async () =>
    readStore<FrontierAttackPackage>("frontier-attack-packages"),
  getTrackedMissingPages: async () =>
    readStore<TrackedMissingPage>("tracked-missing-pages"),
  getAssetResponses: async () =>
    readStore<AssetResponse>("asset-responses"),
  getOutcomeObservations: async () =>
    readStore<OutcomeObservation>("outcome-observations"),
  getCompetitorPageSnapshots: async () =>
    readStore<CompetitorPageSnapshot>("competitor-page-snapshots"),
  getCompetitorPageEvidence: async () =>
    readStore<CompetitorPageEvidence>("competitor-page-evidence"),
  getSourcePatternEvidence: async () =>
    readStore<SourcePatternEvidence>("source-pattern-evidence"),
  getActionStates: async () =>
    readStore<PersistedActionState>("action-states"),
  getBriefStates: async () =>
    readStore<PersistedBriefState>("brief-states", []),
  getTruthLabels: async () => readStore<TruthLabel>("truth-labels"),

  // Phase 7 — scan findings via repository
  getScanFindings: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("scan_findings")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on scan_findings: ${error.message}`,
      );
    return (data ?? []).map((row) =>
      mapRowToEntity<Finding>(row as Record<string, unknown>),
    );
  },
  getPendingScanFindings: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("scan_findings")
      .select("*")
      .eq("status", "pending")
      .order("priority_score", { ascending: false });
    if (error)
      throw new Error(
        `Supabase query failed on scan_findings: ${error.message}`,
      );
    return (data ?? []).map((row) =>
      mapRowToEntity<Finding>(row as Record<string, unknown>),
    );
  },

  // Phase 1a — operator loop stores
  getRecommendationResponses: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("recommendation_responses")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on recommendation_responses: ${error.message}`,
      );
    return (data ?? []).map((row) => ({
      recId: row.rec_id,
      status: row.status,
      respondedAt: row.responded_at,
      deferUntil: row.defer_until,
      targetPageUrl: row.target_page_url ?? null,
      patternId: row.pattern_id ?? null,
    })) as RecommendationResponse[];
  },
  getUrlChangeOutcomes: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("url_change_outcomes")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on url_change_outcomes: ${error.message}`,
      );
    return (data ?? []) as UrlChangeOutcome[];
  },

  // Sprint 6A.1 Phase 12 — specific edits read path. Rows are already
  // snake_cased to match the migration; no key mapping needed.
  getRecommendedEdits: async () => {
    const { data, error } = await getSupabaseAdmin()
      .from("recommended_edits")
      .select("*");
    if (error)
      throw new Error(
        `Supabase query failed on recommended_edits: ${error.message}`,
      );
    return (data ?? []) as unknown as RecommendedEditRow[];
  },

  // Sprint 6A.1 Phase 14 — page_element_inventory read path.
  // Phase 15 (2026-04-25): a single scan produces ~4300 rows for 35
  // pages. PostgREST's default `max-rows` is 1000, so a non-paged
  // query silently truncates. Use queryAllPaged like the other
  // big tables.
  getPageElementInventory: async () =>
    queryAllPaged<PageElementInventoryRow>("page_element_inventory"),

  // Phase 3.5E — hero-surface data. Paged reads for the two large tables
  // (prompt_answer_observations 11,996 rows, daily_metric_snapshots 24,085
  // rows) to defeat PostgREST's default 1000-row cap.
  getPromptAnswerObservations: async () =>
    queryAllPaged<PromptAnswerObservation>("prompt_answer_observations"),
  getDailyMetricSnapshots: async () =>
    queryAllPaged<DailyMetricSnapshot>("daily_metric_snapshots"),
  getTrackedEntities: async () =>
    query<TrackedEntity>("tracked_entities"),
  getTrackedPrompts: async () =>
    query<TrackedPrompt>("tracked_prompts"),

  // Sprint 7 Phase 7.5b Commit 1C (2026-04-25) — tenant-bound facade with
  // push-down filters. Each method appends `.eq("tenant_id", tenantId)`
  // (via selectScoped / queryAllPagedScoped) so Postgres can pick the
  // tenant-prefixed indexes and we never fetch cross-tenant rows just to
  // filter them out in JS. `buildTenantRepo` (in-memory filter) remains
  // the file-backend pattern.
  forTenant(tenantId: string) {
    return {
      // Plain selects (15 rows or fewer in single-tenant production today).
      getImportRuns: () => selectScoped<ImportRun>("import_runs", tenantId),
      getChangelogEntries: () =>
        selectScoped<ChangelogEntry>("changelog_entries", tenantId),
      getGuardrailAlerts: () =>
        selectScoped<GuardrailAlert>("guardrail_alerts", tenantId),
      getObservationRuns: () =>
        selectScoped<ObservationRun>("observation_runs", tenantId),
      getUrlChangeOutcomes: () =>
        selectScoped<UrlChangeOutcome>("url_change_outcomes", tenantId),
      getRecommendedEdits: async () =>
        (await selectScoped(
          "recommended_edits",
          tenantId,
        )) as unknown as RecommendedEditRow[],

      // Paged reads — defeats PostgREST's default 1000-row cap and keeps
      // the tenant filter in every page request.
      getResults: () => queryAllPagedScoped<Result>("results", tenantId),
      getPages: () => queryAllPagedScoped<PageEntity>("pages", tenantId),
      getPageElementInventory: () =>
        queryAllPagedScoped<PageElementInventoryRow>(
          "page_element_inventory",
          tenantId,
        ),
      // E3 (operator audit, 2026-05-05) — accept optional `{ since }`
      // window. Without it, behavior is unchanged (full history).
      // /today + /prompts pass a 60-90-day window to avoid pulling
      // the entire 14k-row observation table on every render.
      getPromptAnswerObservations: (options) =>
        queryAllPagedScoped<PromptAnswerObservation>(
          "prompt_answer_observations",
          tenantId,
          options?.since
            ? { since: options.since, sinceColumn: "observed_at" }
            : undefined,
        ),
      getDailyMetricSnapshots: (options) =>
        queryAllPagedScoped<DailyMetricSnapshot>(
          "daily_metric_snapshots",
          tenantId,
          options?.since
            ? { since: options.since, sinceColumn: "date" }
            : undefined,
        ),

      // page_snapshots: tenant-scoped + dedupe-by-page_id (latest first).
      //
      // E3 (operator audit, 2026-05-05) — bounded read.
      //
      // EGRESS-P0 (2026-05-07) — Supabase egress incident. Cap dropped
      // 5000 → 500 (a single tenant with 50 pages needs at most 50 deduped
      // rows; 500 is a 10x safety margin without leaking egress). Switched
      // from `select("*")` to an explicit projection that omits the heavy
      // payload fields (`body_paragraph_sample`, `card_texts`,
      // `internal_links`, `schema_entity_names`, `schema_validation_warnings`)
      // — these fields can be 5-15KB per row, dominating wire cost. The
      // dropped fields are NOT consumed by /today / /recommendations /
      // /changes default surfaces; if a future consumer needs them, fetch
      // via a separate scoped helper.
      getPageSnapshots: async () => {
        const t0 = Date.now();
        const { data, error } = await getSupabaseAdmin()
          .from("page_snapshots")
          .select(
            "id, page_id, observation_run_id, url, canonical_url, fetched_at, http_status, title, meta_description, h1, h2_list, h3_count, faqs, schema_types, location_terms, service_terms, internal_link_count, external_link_count, word_count, robots_meta, has_canonical_mismatch, content_hash, headings_hash, faq_hash, schema_hash, extraction_certainty, faq_schema_block_count, structural_warnings, table_count, h3_list, tenant_id",
          )
          .eq("tenant_id", tenantId)
          .order("fetched_at", { ascending: false })
          .limit(500);
        if (error)
          throw new Error(
            `Supabase query failed on page_snapshots: ${error.message}`,
          );
        const seen = new Set<string>();
        const latest: PageSnapshot[] = [];
        for (const row of (data ?? []) as PageSnapshot[]) {
          if (!seen.has(row.page_id)) {
            seen.add(row.page_id);
            latest.push(row);
          }
        }
        logEgress({
          table: "page_snapshots[capped+dedup+projected]",
          rows: latest.length,
          data: data ?? [],
          durationMs: Date.now() - t0,
          tenantId,
          filter: "limit=500 dedup_by=page_id projected_columns",
        });
        return latest;
      },

      // scan_findings: tenant-scoped + camelCase mapping.
      getScanFindings: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("scan_findings")
          .select("*")
          .eq("tenant_id", tenantId);
        if (error)
          throw new Error(
            `Supabase query failed on scan_findings: ${error.message}`,
          );
        return (data ?? []).map((row) =>
          mapRowToEntity<Finding>(row as Record<string, unknown>),
        );
      },
      getPendingScanFindings: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("scan_findings")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("status", "pending")
          .order("priority_score", { ascending: false });
        if (error)
          throw new Error(
            `Supabase query failed on scan_findings: ${error.message}`,
          );
        return (data ?? []).map((row) =>
          mapRowToEntity<Finding>(row as Record<string, unknown>),
        );
      },

      // recommendation_responses: tenant-scoped + custom row → camelCase shape.
      getRecommendationResponses: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("recommendation_responses")
          .select("*")
          .eq("tenant_id", tenantId);
        if (error)
          throw new Error(
            `Supabase query failed on recommendation_responses: ${error.message}`,
          );
        return (data ?? []).map((row) => ({
          recId: row.rec_id,
          status: row.status,
          respondedAt: row.responded_at,
          deferUntil: row.defer_until,
          targetPageUrl: row.target_page_url ?? null,
          patternId: row.pattern_id ?? null,
        })) as RecommendationResponse[];
      },

      // Phase 1 Stage C (2026-05-09): tenant-scoped reads for
      // `tracked_prompts` and `tracked_entities` now filter by
      // `tenant_id` (the canonical scoping column).
      //
      // History: pre-2026-05-09 these tables had no `tenant_id` column;
      // the 2026-05-06 customer-#2-isolation fix worked around this by
      // resolving the tenant slug and filtering by `account_id`. The
      // 2026-05-09 migration adds `tenant_id` additively, backfilled
      // single-tenant to `tenant-ritz-founder`. Reads switch to the
      // canonical column; writes stamp BOTH `tenant_id` (canonical)
      // and `account_id` (compatibility) until a later cleanup phase
      // deprecates `account_id`.
      //
      // The slug-via-tenants-registry path is no longer needed for the
      // read; the column-level filter is more direct and scales to
      // multi-tenant without touching `tenants` per call.
      getTrackedPrompts: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("tracked_prompts")
          .select("*")
          .eq("tenant_id", tenantId);
        if (error)
          throw new Error(
            `Supabase query failed on tracked_prompts: ${error.message}`,
          );
        return (data ?? []) as TrackedPrompt[];
      },
      getTrackedEntities: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("tracked_entities")
          .select("*")
          .eq("tenant_id", tenantId);
        if (error)
          throw new Error(
            `Supabase query failed on tracked_entities: ${error.message}`,
          );
        return (data ?? []) as TrackedEntity[];
      },
    };
  },
};
