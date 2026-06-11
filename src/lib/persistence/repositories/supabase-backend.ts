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
import type { ProfoundImportRun } from "@/domains/observation-runs/types";

// ─────────────────────────────────────────────────────────────────────
// Section 5 durable denominator (2026-05-16) — observation_runs mapper.
//
// Production native-poll cron writes one `ObservationRun` row per
// successful poll to the Supabase `observation_runs` table via
// `syncObservationRuns()` (see `dual-write.ts:638-701`). Every row
// carries `run_type === "citation_sample_import"` (the discriminator
// vs website-crawl rows) and `source ∈ {"perplexity-native-poll",
// "openai-native-poll"}`. These records have been collecting since
// 2026-04-22 and are the authoritative denominator source for
// Section 5's repeat-citation classifier.
//
// `getProfoundImportRuns()` on the Supabase backend reads these
// rows and maps them through `mapObservationRunRowToProfoundImportRun`
// into the `ProfoundImportRun` shape Section 5 compute expects.
// NO new table, NO migration, NO new write path. The file-backend
// keeps its existing per-tenant disk read helper
// (`readProfoundImportRunsForTenant` in `./tenant-repo`) for local
// dev fixtures.
// ─────────────────────────────────────────────────────────────────────

type ObservationRunRow = {
  run_id: unknown;
  run_type: unknown;
  source: unknown;
  status: unknown;
  started_at: unknown;
  completed_at: unknown;
  tenant_id: unknown;
};

/**
 * Pure mapper — `observation_runs` row → `ProfoundImportRun`.
 *
 * Defensive: returns `null` for any row missing the four required
 * string fields (`run_id`, `tenant_id`, `source`, `completed_at`).
 * Callers filter the nulls.
 *
 * Source → platform mapping:
 *   • `"perplexity-native-poll"` → `"perplexity"`
 *   • `"openai-native-poll"` → `"chatgpt"`
 *   • anything else: pass `source` through as `platform` (forward-
 *     compat — a future native platform's poll script with a new
 *     source literal joins the denominator pool automatically).
 *
 * Status mapping (Section 5 compute filters by `status ===
 * "completed"` downstream; non-completed values are preserved as
 * `"failed"` for type-shape stability):
 *   • `"completed"` → `"completed"`
 *   • `"failed"` → `"failed"`
 *   • `"partial"` → `"failed"`
 *   • anything else → `"failed"`
 *
 * `source_type` is constant `"beacon_native"` because every
 * `citation_sample_import` row by construction comes from the
 * native poll cron.
 */
export function mapObservationRunRowToProfoundImportRun(
  row: ObservationRunRow,
): ProfoundImportRun | null {
  const runId = row.run_id;
  const tenantId = row.tenant_id;
  const source = row.source;
  const completedAt = row.completed_at;
  if (
    typeof runId !== "string" ||
    typeof tenantId !== "string" ||
    typeof source !== "string" ||
    typeof completedAt !== "string"
  ) {
    return null;
  }

  const platform =
    source === "perplexity-native-poll"
      ? "perplexity"
      : source === "openai-native-poll"
        ? "chatgpt"
        : source;

  const rawStatus = row.status;
  const status: ProfoundImportRun["status"] =
    rawStatus === "completed"
      ? "completed"
      : rawStatus === "failed"
        ? "failed"
        : rawStatus === "partial"
          ? "failed"
          : "failed";

  const startedAt =
    typeof row.started_at === "string" ? row.started_at : completedAt;

  return {
    id: runId,
    account_id: tenantId,
    import_run_id: null,
    run_date: completedAt.slice(0, 10),
    platform,
    model: null,
    geo: null,
    locale: null,
    source_type: "beacon_native",
    status,
    prompt_count: 0,
    metadata: { source },
    created_at: startedAt,
  };
}
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
  PageSummary,
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

/**
 * Perf+egress bundle 2 (2026-05-12) — projected reader for `pages`.
 *
 * Selects exactly the 6 customer-facing fields + `tenant_id` (used
 * by the file backend's `filterByTenantId` shim). Maps the schema's
 * `topics: string[]` array down to a single `primary_topic` at the
 * boundary so the PageSummary type stays narrow.
 *
 * Two callers: the unscoped base backend (`getPageSummaries` on
 * `supabaseBackend`) and the tenant-scoped variant which adds an
 * `eq("tenant_id", tenantId)` filter at the DB.
 */
const PAGE_SUMMARY_COLUMNS =
  "id, url, canonical_url, is_owned, page_type, topics, tenant_id";

type PageSummaryRow = {
  id: string;
  url: string;
  canonical_url: string | null;
  is_owned: boolean;
  page_type: string;
  topics: string[] | null;
  tenant_id: string;
};

function rowToPageSummary(row: PageSummaryRow): PageSummary {
  const topics = Array.isArray(row.topics) ? row.topics : [];
  return {
    id: row.id,
    url: row.url,
    canonical_url: row.canonical_url ?? "",
    is_owned: row.is_owned,
    page_type: row.page_type as PageSummary["page_type"],
    primary_topic: topics.length > 0 ? topics[0] : null,
    tenant_id: row.tenant_id,
  };
}

async function queryPageSummariesUnscoped(): Promise<PageSummary[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: PageSummary[] = [];
  let from = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await sb
      .from("pages")
      .select(PAGE_SUMMARY_COLUMNS)
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`Supabase query failed on pages: ${error.message}`);
    const rows = (data ?? []) as unknown as PageSummaryRow[];
    out.push(...rows.map(rowToPageSummary));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  logEgress({
    table: "pages[summaries-paged]",
    rows: out.length,
    data: out,
    durationMs: Date.now() - t0,
  });
  return out;
}

async function queryPageSummariesScoped(
  tenantId: string,
): Promise<PageSummary[]> {
  const sb = getSupabaseAdmin();
  const PAGE = 1000;
  const out: PageSummary[] = [];
  let from = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await sb
      .from("pages")
      .select(PAGE_SUMMARY_COLUMNS)
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE - 1);
    if (error)
      throw new Error(`Supabase query failed on pages: ${error.message}`);
    const rows = (data ?? []) as unknown as PageSummaryRow[];
    out.push(...rows.map(rowToPageSummary));
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  logEgress({
    table: "pages[summaries-scoped-paged]",
    rows: out.length,
    data: out,
    durationMs: Date.now() - t0,
    tenantId,
  });
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
    /** Emergency P0 (2026-05-12) — additional equality filter pushed
     *  down to Postgres. Used by `/prompts/[id]` to limit
     *  prompt_answer_observations to one prompt_id (15k rows → <500). */
    eqColumn?: string;
    eqValue?: string;
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
    if (options?.eqColumn && options?.eqValue !== undefined) {
      query = query.eq(options.eqColumn, options.eqValue);
    }
    const { data, error } = await query;
    if (error)
      throw new Error(`Supabase query failed on ${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  const filterDescParts: string[] = [];
  if (options?.since && options?.sinceColumn) {
    filterDescParts.push(`${options.sinceColumn}>=${options.since}`);
  }
  if (options?.eqColumn && options?.eqValue !== undefined) {
    filterDescParts.push(`${options.eqColumn}=${options.eqValue}`);
  }
  const filterDesc = filterDescParts.length > 0 ? filterDescParts.join(",") : null;
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
  // Perf+egress bundle 2 (2026-05-12) — narrow projection of `pages`.
  // Selects 6 columns (+ tenant_id for the file backend's in-memory
  // tenant filter) instead of the full ~20-field row. Maps the
  // schema's `topics: string[]` array down to a single
  // `primary_topic = topics[0] ?? null` at the boundary so the
  // PageSummary type stays narrow. Used by customer routes that
  // only need URL → id lookup / ownership classification.
  getPageSummaries: () => queryPageSummariesUnscoped(),
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

  // Night-shift fix (2026-06-11): the unscoped read now returns the
  // FOUNDER-era row only via the scoped helper below; ambient callers
  // go through the tenant-repo wrapper which prefers the scoped read.
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

  getCitationEvidenceIndexScoped: async (tenantId: string) => {
    const { data, error } = await getSupabaseAdmin()
      .from("citation_evidence_index")
      .select("*")
      .eq("id", "current")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on citation_evidence_index (scoped): ${error.message}`,
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

  getAnswerIntelligenceIndexScoped: async (tenantId: string) => {
    const { data, error } = await getSupabaseAdmin()
      .from("answer_intelligence_index")
      .select("*")
      .eq("id", "current")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error)
      throw new Error(
        `Supabase query failed on answer_intelligence_index (scoped): ${error.message}`,
      );
    if (!data) return null;
    return data.data as AnswerIntelligenceIndex;
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
      // Night-shift fix (2026-06-11) — per-tenant citation index row.
      getCitationEvidenceIndex: () =>
        supabaseBackend.getCitationEvidenceIndexScoped!(tenantId),
      getAnswerIntelligenceIndex: () =>
        supabaseBackend.getAnswerIntelligenceIndexScoped!(tenantId),

      // Paged reads — defeats PostgREST's default 1000-row cap and keeps
      // the tenant filter in every page request.
      getResults: () => queryAllPagedScoped<Result>("results", tenantId),
      getPages: () => queryAllPagedScoped<PageEntity>("pages", tenantId),
      // Perf+egress bundle 2 (2026-05-12) — narrow projection. See
      // `queryPageSummariesScoped` for column list + row→summary map.
      getPageSummaries: () => queryPageSummariesScoped(tenantId),
      getPageElementInventory: () =>
        queryAllPagedScoped<PageElementInventoryRow>(
          "page_element_inventory",
          tenantId,
        ),
      // E3 (operator audit, 2026-05-05) — accept optional `{ since }`
      // window. Without it, behavior is unchanged (full history).
      // /today + /prompts pass a 60-90-day window to avoid pulling
      // the entire 14k-row observation table on every render.
      // Emergency P0 (2026-05-12) — accept optional `{ promptId }`
      // so `/prompts/[id]` pushes the predicate down to Postgres
      // (`.eq("prompt_id", id)`) and the row count crossing the wire
      // drops from ~15k to typically <500.
      getPromptAnswerObservations: (options) => {
        const queryOpts:
          | { since?: string; sinceColumn?: string; eqColumn?: string; eqValue?: string }
          | undefined =
          options?.since || options?.promptId
            ? {
                ...(options?.since
                  ? { since: options.since, sinceColumn: "observed_at" }
                  : {}),
                ...(options?.promptId
                  ? { eqColumn: "prompt_id", eqValue: options.promptId }
                  : {}),
              }
            : undefined;
        return queryAllPagedScoped<PromptAnswerObservation>(
          "prompt_answer_observations",
          tenantId,
          queryOpts,
        );
      },
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

      // ─────────────────────────────────────────────────────────────
      // Phase A.3 (post-A.3.5) — robots_state + sitemap_reconciliation
      // tenant-scoped read/write pair.
      //
      // Sequencing model A (operator-locked): reads soft-fail to null
      // when the migration hasn't applied yet, recognized by the
      // PostgreSQL "undefined_table" error code 42P01. Writes
      // fail-loud — daily-scan will surface the missing migration to
      // the operator the next time it tries to UPSERT.
      // ─────────────────────────────────────────────────────────────
      getRobotsState: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("robots_state")
          .select(
            "tenant_id, site_domain, parsed, last_fetched_at, last_fetch_error, schema_version",
          )
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error) {
          if (error.code === "42P01") return null; // undefined_table soft-fail
          throw new Error(
            `Supabase query failed on robots_state: ${error.message}`,
          );
        }
        if (data == null) return null;
        const row = data as {
          site_domain: string;
          parsed: import("@/domains/pages/robots-parser").RobotsFile | null;
          last_fetched_at: string;
          last_fetch_error: string | null;
          schema_version: number;
        };
        if (row.schema_version !== 1) return null;
        return {
          schemaVersion: 1 as const,
          siteDomain: row.site_domain,
          parsed: row.parsed,
          lastFetchedAt: row.last_fetched_at,
          lastFetchError: row.last_fetch_error,
        };
      },
      setRobotsState: async (
        state: import("@/domains/pages/robots-parser").RobotsStateFile,
      ) => {
        const { error } = await getSupabaseAdmin()
          .from("robots_state")
          .upsert(
            {
              tenant_id: tenantId,
              site_domain: state.siteDomain,
              parsed: state.parsed,
              last_fetched_at: state.lastFetchedAt,
              last_fetch_error: state.lastFetchError,
              schema_version: state.schemaVersion,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id" },
          );
        if (error)
          throw new Error(
            `Supabase upsert failed on robots_state: ${error.message}`,
          );
      },
      getSitemapReconciliation: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("sitemap_reconciliation")
          .select(
            "tenant_id, sitemap_domain, sitemap_url_count, canonical_pages, stale_pages, registry_matched, sitemap_only, fetched_at, schema_version",
          )
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error) {
          if (error.code === "42P01") return null; // undefined_table soft-fail
          throw new Error(
            `Supabase query failed on sitemap_reconciliation: ${error.message}`,
          );
        }
        if (data == null) return null;
        const row = data as {
          sitemap_domain: string;
          sitemap_url_count: number;
          canonical_pages: SitemapReconciliation["canonical_pages"];
          stale_pages: SitemapReconciliation["stale_pages"];
          registry_matched: number;
          sitemap_only: number;
          fetched_at: string;
          schema_version: number;
        };
        if (row.schema_version !== 1) return null;
        return {
          canonical_pages: row.canonical_pages,
          stale_pages: row.stale_pages,
          sitemap_url_count: row.sitemap_url_count,
          sitemap_domain: row.sitemap_domain,
          registry_matched: row.registry_matched,
          sitemap_only: row.sitemap_only,
          fetched_at: row.fetched_at,
        };
      },
      setSitemapReconciliation: async (recon: SitemapReconciliation) => {
        const { error } = await getSupabaseAdmin()
          .from("sitemap_reconciliation")
          .upsert(
            {
              tenant_id: tenantId,
              sitemap_domain: recon.sitemap_domain ?? "",
              sitemap_url_count: recon.sitemap_url_count,
              canonical_pages: recon.canonical_pages,
              stale_pages: recon.stale_pages,
              registry_matched: recon.registry_matched ?? 0,
              sitemap_only: recon.sitemap_only ?? 0,
              fetched_at: recon.fetched_at ?? new Date().toISOString(),
              schema_version: 1,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "tenant_id" },
          );
        if (error)
          throw new Error(
            `Supabase upsert failed on sitemap_reconciliation: ${error.message}`,
          );
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
      /**
       * Section 5 durable denominator (2026-05-16) — explicit-tenant
       * read of native-poll run records from the existing Supabase
       * `observation_runs` table.
       *
       * Discriminator: `run_type === "citation_sample_import"` is
       * the structural marker every native-poll `ObservationRun`
       * row carries (`src/adapters/perplexity/poll.ts:695` +
       * `src/adapters/openai/poll.ts` via the same builder). Rows
       * are dual-written by `syncObservationRuns()` on every poll
       * (`src/lib/persistence/dual-write.ts:638-701`) and have been
       * collecting since 2026-04-22. No new table, no new write
       * path — the read-side mapper alone makes Section 5's
       * denominator durable in production.
       *
       * Scoping contract: explicit `.eq("tenant_id", tenantId)`
       * predicate (pushdown-invariant). The captured `tenantId`
       * scopes every read; ambient `currentTenantSlug()` is NOT
       * consulted. Pinned by
       * `tests/architecture/profound-import-runs-explicit-tenant-scope.test.ts`.
       *
       * Mapper: see `mapObservationRunRowToProfoundImportRun`
       * above for the row→ProfoundImportRun translation rules.
       */
      getProfoundImportRuns: async () => {
        const { data, error } = await getSupabaseAdmin()
          .from("observation_runs")
          .select(
            "run_id, run_type, source, status, started_at, completed_at, tenant_id",
          )
          .eq("tenant_id", tenantId)
          .eq("run_type", "citation_sample_import");
        if (error) {
          throw new Error(
            `Supabase query failed on observation_runs (Section 5 denominator read): ${error.message}`,
          );
        }
        const rows = (data ?? []) as ObservationRunRow[];
        const out: ProfoundImportRun[] = [];
        for (const row of rows) {
          const mapped = mapObservationRunRowToProfoundImportRun(row);
          if (mapped != null) out.push(mapped);
        }
        return out;
      },
    };
  },
};
