/** `DATA_SOURCE=supabase` implementation of `SeedDataRepository`. Route-critical tables read from Postgres; supplementary + json-store-only domains still hit disk (`readDotDataJson` / `readStore`) until migrated — same behavior as pre-cutover direct-file access, centralized here. */
import { getSupabaseAdmin } from "../supabase";
import type { PageSnapshotLinkGraph, SeedDataRepository } from "./types";

// (Section 5 observation_runs → ProfoundImportRun mapper removed 2026-07-21, CORE 100K Lane O: the getProfoundImportRuns read path lost its last caller when the repeat-citation loader was deleted.)

import type { Result } from "@/domains/measurement/results/types";
import type { ChangelogEntry } from "@/domains/measurement/changelog/types";
import type { Opportunity } from "@/domains/decision/opportunities/types";
import type { ImportRun } from "@/lib/import/types";
import type { ChangeContract } from "@/domains/measurement/changelog/change-contract";
import type {
  PageEntity,
  PageSnapshot,
} from "@/domains/evidence/pages/types";
import type { ObservationRun } from "@/domains/evidence/observations/types";
import type { Finding } from "@/domains/evidence/scanning/types";
import type { RecommendationResponse } from "@/domains/evidence/product/recommendation-response-store";
import type { DailyMetricSnapshot } from "@/domains/evidence/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/evidence/ai-visibility/tracked-entities";
import type { TrackedPrompt } from "@/domains/evidence/ai-visibility/tracked-prompts";
import { mapRowToEntity } from "./key-mapper";
import { selectPageVersion } from "@/domains/evidence/pages/page-version";

/** THE ONE snapshot projection both read paths use. body_text (up to 100,000 characters per page) and the other heavy payloads are deliberately absent: a page's own words are read narrowly through evidence/pages/owned-context. `internal_links` IS here and must stay: omitting it while snapshot-loader mapped `internal_links ?? []` sent every owned page to Decision with zero links, judging a site of 36,281 real links as a site with none. */
const SNAPSHOT_COLUMNS =
  "id, page_id, observation_run_id, url, canonical_url, final_url, fetched_at, http_status, title, meta_description, h1, h2_list, h3_count, faqs, schema_types, location_terms, service_terms, internal_links, internal_link_count, external_link_count, word_count, robots_meta, has_canonical_mismatch, content_hash, headings_hash, faq_hash, schema_hash, extraction_certainty, faq_schema_block_count, structural_warnings, table_count, h3_list, schema_validation_warnings, tenant_id";

type Capture = Pick<PageSnapshot, "id" | "page_id" | "fetched_at" | "word_count" | "extraction_certainty">;
const captureFacts = (s: Capture) => ({ fetchedAt: s.fetched_at, words: s.word_count ?? 0, bodyHeld: false, certainty: s.extraction_certainty ?? null });
/** Select per-page identities before payloads. A busy page cannot crowd out another page; completed page
 * groups skip their remaining history. Only an untrusted boundary group needs older identity records. */
async function selectedSnapshots<T extends Pick<PageSnapshot, "id" | "fetched_at">>(tenantId: string, columns: string): Promise<T[]> {
  if (!tenantId.trim()) throw new Error("page snapshots require an explicit tenant");
  const sb = getSupabaseAdmin(), selected = new Map<string, Capture[]>(), pageSize = 500;
  const identities = () => sb.from("page_snapshots").select("id, page_id, fetched_at, word_count, extraction_certainty").eq("tenant_id", tenantId);
  const keep = (rows: Capture[]) => { for (const row of rows) {
    const v = selectPageVersion([...(selected.get(row.page_id) ?? []), row], captureFacts);
    selected.set(row.page_id, v.current === v.content ? [v.current!] : [v.current!, v.content!]);
  } };
  let afterPage: string | null = null;
  for (;;) {
    let q = identities().order("page_id", { ascending: true }).order("fetched_at", { ascending: false }).order("id", { ascending: false });
    if (afterPage !== null) q = q.gt("page_id", afterPage);
    const { data, error } = await q.limit(pageSize);
    if (error) throw new Error(`Supabase snapshot identity read failed: ${error.message}`);
    const rows = (data ?? []) as Capture[];
    keep(rows);
    if (rows.length < pageSize) break;
    let boundary = rows[rows.length - 1]!;
    while (selectPageVersion(selected.get(boundary.page_id)!, captureFacts).state === "blank") {
      const at = JSON.stringify(boundary.fetched_at), id = JSON.stringify(boundary.id);
      const older = await identities().eq("page_id", boundary.page_id)
        .or(`fetched_at.lt.${at},and(fetched_at.eq.${at},id.lt.${id})`)
        .order("fetched_at", { ascending: false }).order("id", { ascending: false }).limit(pageSize);
      if (older.error) throw new Error(`Supabase snapshot history read failed: ${older.error.message}`);
      const history = (older.data ?? []) as Capture[];
      keep(history);
      if (history.length < pageSize) break;
      boundary = history[history.length - 1]!;
    }
    afterPage = boundary.page_id;
  }
  const ids = [...selected.values()].flatMap((rows) => rows.map((r) => r.id)), out: T[] = [];
  // PostgREST echoes the URI in response headers. Bound encoded bytes, not just rows;
  // long capture identities otherwise overflow the HTTP parser before JSON arrives.
  const baseBytes = Buffer.byteLength(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") + 24;
  const query = new URLSearchParams({ select: columns.replace(/\s/g, ""), tenant_id: `eq.${tenantId}`, limit: String(pageSize) });
  for (let start = 0; start < ids.length;) {
    const chunk: string[] = [];
    let bytes = baseBytes + query.toString().length + "&id=in.%28%29".length;
    while (start < ids.length && chunk.length < pageSize) {
      const id = ids[start]!, cost = new URLSearchParams({ id: JSON.stringify(id) }).toString().length + 3;
      if (bytes + cost > 8000) break;
      chunk.push(id); bytes += cost; start++;
    }
    if (!chunk.length) throw new Error("Supabase snapshot identity exceeds the encoded request budget");
    const { data, error } = await sb.from("page_snapshots").select(columns).eq("tenant_id", tenantId).in("id", chunk).limit(pageSize);
    if (error) throw new Error(`Supabase selected snapshot read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    if (rows.length !== chunk.length) throw new Error("Supabase selected snapshot read was incomplete");
    out.push(...rows);
  }
  return out.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at) || b.id.localeCompare(a.id));
}

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
/**
 * Quota/waste pass (2026-06-17): a read returning more than this many rows is
 * an egress smell (the class of read that burned the egress quota — e.g. a
 * full prompt_answer_observations pull of 8,700 rows / 17 MB). We ALWAYS warn
 * on these (cheap — row count is already known, no stringify), even when the
 * verbose debug flag is off, so an anomalous read can never sneak by unnoticed
 * again. Full per-read detail (byte estimate) stays behind the debug flag.
 */
const BIG_READ_WARN_ROWS = 2_000;

function logEgress(opts: {
  table: string;
  rows: number;
  data: unknown;
  durationMs: number;
  tenantId?: string | null;
  filter?: string | null;
}): void {
  const debug = process.env.BEACON_SUPABASE_EGRESS_DEBUG === "1";

  // Always-on alarm for anomalously large reads (no stringify cost — rows is already counted). This is the "never surprises us again" guard.
  if (!debug && opts.rows >= BIG_READ_WARN_ROWS) {
    console.warn(
      `[supabase-egress][LARGE READ] table=${opts.table} rows=${opts.rows} ms=${opts.durationMs}` +
        `${opts.tenantId ? ` tenant=${opts.tenantId}` : ""} — consider column projection / a tighter window. ` +
        `Set BEACON_SUPABASE_EGRESS_DEBUG=1 for full per-read byte detail.`,
    );
    return;
  }
  if (!debug) return;

  let approxBytes = 0;
  try {
    approxBytes = JSON.stringify(opts.data ?? []).length;
  } catch {
    approxBytes = -1;
  }
  // Simple console line — keeps the logger dependency-free and avoids triggering the structured-logger code path during cold-start tests.
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

/** Phase 3.5E (2026-04-22) — pages through a table in 1000-row batches. Use this for tables that can exceed PostgREST's default `max-rows` limit (prompt_answer_observations at 11,996 and daily_metric_snapshots at 24,085 both do). One-shot per cold start; results held in-memory by the canonical-store seed layer. */
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

// (PAGE_SUMMARY_COLUMNS / queryPageSummariesUnscoped / queryPageSummariesScoped removed 2026-07-21, CORE 100K Lane O: getPageSummaries had zero callers on either interface.)

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
/** Night-shift (2026-06-11): tenant-scoped variant of queryMapped —
 *  same key-mapping, with the tenant filter pushed to Postgres. */
async function queryMappedScoped<T>(table: string, tenantId: string): Promise<T[]> {
  const { data, error } = await getSupabaseAdmin()
    .from(table)
    .select("*")
    .eq("tenant_id", tenantId);
  if (error)
    throw new Error(`Supabase query failed on ${table}: ${error.message}`);
  return (data ?? []).map((row) =>
    mapRowToEntity<T>(row as Record<string, unknown>),
  );
}

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
 * Adds an OPTIONAL date-window filter (`since` ISO string) and column projection (`columns`) so callers that only need recent rows or a subset of columns can avoid pulling the entire table.
 *
 * Default behavior unchanged: `since` undefined + `columns` undefined → `select("*")` over all rows for the tenant. Existing scripts / migration helpers keep their full-history reads.
 *
 * `since` filters on `observed_at` (observations) or `for_date` (snapshots) — the column name varies by table, so the caller passes the column name explicitly to avoid coupling.
 */
async function queryAllPagedScoped<T>(
  table: string,
  tenantId: string,
  options?: {
    since?: string;
    sinceColumn?: string;
    columns?: string;
    /** Emergency P0 (2026-05-12) — additional equality filter pushed down to Postgres. Used by `/prompts/[id]` to limit prompt_answer_observations to one prompt_id (15k rows → <500). */
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

  // Phase 1D (getEventDecisions / getCandidateLinks / getPageIssues removed 2026-07-21, CORE 100K Lane O: zero callers.)
  getChangeContracts: () => queryMapped<ChangeContract>("change_contracts"),

  // Phase 1E pages: 5929 rows as of 2026-04-24 — past PostgREST's 1000-row cap. Without pagination, buildPageInventory saw only ~3 owned rows on hosted and the resolver fell through to create_new_page for every blocker cluster.
  getPages: () => queryAllPaged<PageEntity>("pages"),

  getPageSnapshotLinkGraphs: async () => { throw new Error("page link graphs require forTenant"); },
  getPageSnapshots: async () => { throw new Error("page snapshots require forTenant"); },
  getObservationRuns: () => query<ObservationRun>("observation_runs"),

  // (Dead columns removed 2026-07-21, CORE 100K Lane O: citation/answer-intel index reads, page-snapshot-diffs, render-checks, legacy-global sitemap-reconciliation, visibility runs, rollout/pattern/frontier/wave/ asset/outcome/truth-label reads, page summaries — zero callers. The tenant-scoped sitemap pair in forTenant below is LIVE and untouched.)

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
      dismissReason: row.dismiss_reason ?? null,
    })) as RecommendationResponse[];
  },

  // Phase 3.5E — hero-surface data. Paged reads defeat PostgREST's default 1000-row cap.
  getDailyMetricSnapshots: async () =>
    queryAllPaged<DailyMetricSnapshot>("daily_metric_snapshots"),
  getTrackedEntities: async () =>
    query<TrackedEntity>("tracked_entities"),
  getTrackedPrompts: async () =>
    query<TrackedPrompt>("tracked_prompts"),

  // Sprint 7 Phase 7.5b Commit 1C (2026-04-25) — tenant-bound facade with push-down filters. Each method appends `.eq("tenant_id", tenantId)` (via selectScoped / queryAllPagedScoped) so Postgres can pick the tenant-prefixed indexes and we never fetch cross-tenant rows just to filter them out in JS. `buildTenantRepo` (in-memory filter) remains the file-backend pattern.
  forTenant(tenantId: string) {
    return {
      // Plain selects (15 rows or fewer in single-tenant production today).
      getImportRuns: () => selectScoped<ImportRun>("import_runs", tenantId),
      getChangelogEntries: () =>
        selectScoped<ChangelogEntry>("changelog_entries", tenantId),
      getObservationRuns: () =>
        selectScoped<ObservationRun>("observation_runs", tenantId),
      getChangeContracts: () =>
        queryMappedScoped<ChangeContract>("change_contracts", tenantId),
      // (Tenant-scoped getPageIssues / getEventDecisions / getCandidateLinks and the citation/answer-intel index reads removed 2026-07-21, CORE 100K Lane O: zero callers.)
      getOpportunities: () =>
        selectScoped<Opportunity>("opportunities", tenantId),

      // Paged reads — defeats PostgREST's default 1000-row cap and keeps the tenant filter in every page request.
      getResults: () => queryAllPagedScoped<Result>("results", tenantId),
      getPages: () => queryAllPagedScoped<PageEntity>("pages", tenantId),
      // E3 (operator audit, 2026-05-05) — accept optional `{ since }` window. Without it, behavior is unchanged (full history). /today + /prompts pass a 60-90-day window to avoid pulling the entire 14k-row observation table on every render. Emergency P0 (2026-05-12) — accept optional `{ promptId }` so `/prompts/[id]` pushes the predicate down to Postgres (`.eq("prompt_id", id)`) and the row count crossing the wire drops from ~15k to typically <500.
      getDailyMetricSnapshots: (options) => {
        // Thread `since` (date-window, predicate pushdown) and `columns` (lean projection) independently — /today passes `columns` alone to fetch a date-only projection for its two count consumers without changing the window.
        const queryOpts =
          options?.since || options?.columns
            ? {
                ...(options?.since
                  ? { since: options.since, sinceColumn: "date" }
                  : {}),
                ...(options?.columns ? { columns: options.columns } : {}),
              }
            : undefined;
        return queryAllPagedScoped<DailyMetricSnapshot>(
          "daily_metric_snapshots",
          tenantId,
          queryOpts,
        );
      },

      getPageSnapshots: async () => {
        const started = Date.now(), rows = await selectedSnapshots<PageSnapshot>(tenantId, SNAPSHOT_COLUMNS);
        logEgress({ table: "page_snapshots[selected]", rows: rows.length, data: rows, durationMs: Date.now() - started, tenantId, filter: "current_and_trusted_per_page" });
        return rows;
      },
      getPageSnapshotLinkGraphs: async () => {
        const rows = await selectedSnapshots<PageSnapshotLinkGraph & Pick<PageSnapshot, "id">>(tenantId, "id, page_id, url, fetched_at, tenant_id, internal_links, word_count, extraction_certainty");
        return rows.filter((r) => Array.isArray(r.internal_links)).map((r) => ({ ...r, internal_links: r.internal_links! }));
      },

      // ─────────────────────────────────────────────────────────────
      // Phase A.3 (post-A.3.5) — robots_state tenant-scoped read/write pair.
      //
      // Sequencing model A (operator-locked): reads soft-fail to null when the migration hasn't applied yet, recognized by the PostgreSQL "undefined_table" error code 42P01. Writes fail-loud — daily-scan will surface the missing migration to the operator the next time it tries to UPSERT.
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
          if (error.code === "42P01" || error.code === "PGRST205") return null; // undefined_table / schema-cache soft-fail (audit-wave6 #5)
          throw new Error(
            `Supabase query failed on robots_state: ${error.message}`,
          );
        }
        if (data == null) return null;
        const row = data as {
          site_domain: string;
          parsed: import("@/domains/evidence/pages/robots-parser").RobotsFile | null;
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
        state: import("@/domains/evidence/pages/robots-parser").RobotsStateFile,
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
          dismissReason: row.dismiss_reason ?? null,
        })) as RecommendationResponse[];
      },

      // Phase 1 Stage C (2026-05-09): tenant-scoped reads for `tracked_prompts` and `tracked_entities` now filter by `tenant_id` (the canonical scoping column).
      //
      // History: pre-2026-05-09 these tables had no `tenant_id` column; the 2026-05-06 customer-#2-isolation fix worked around this by resolving the tenant slug and filtering by `account_id`. The 2026-05-09 migration adds `tenant_id` additively, backfilled single-tenant to `tenant-ritz-founder`. Reads switch to the canonical column; writes stamp BOTH `tenant_id` (canonical) and `account_id` (compatibility) until a later cleanup phase deprecates `account_id`.
      //
      // The slug-via-tenants-registry path is no longer needed for the read; the column-level filter is more direct and scales to multi-tenant without touching `tenants` per call.
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
      // (getProfoundImportRuns removed 2026-07-21, CORE 100K Lane O: the Section 5 repeat-citation loader that consumed it was deleted in an earlier campaign.)
    };
  },
};
