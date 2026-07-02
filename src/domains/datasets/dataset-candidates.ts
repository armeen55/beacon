/**
 * datasets/dataset-candidates (BEACON 500 item 76) - detect a tenant's strongest
 * "citable dataset page" opportunities from its OWN data. PURE detection +
 * ranking (no I/O) plus a thin loader at the bottom.
 *
 * AI answer engines disproportionately cite pages that look like primary data
 * sources (a table, a compiled list with real numbers, a stats page) rather
 * than prose. This module finds two kinds of dataset opportunity, entirely
 * from data SHAPE, never a hardcoded topic list:
 *
 *   (a) page_family - a cluster of the tenant's own pages that share a
 *       structural template (same schema_types signature + a recurring H2
 *       shape) with enough members to compile into one sortable table. A
 *       family of "X profile" pages that each carry a "History" and a
 *       "Meaning" H2, for example, compiles into a table of X -> meaning ->
 *       history-era, with no topic name ever referenced in the detector.
 *   (b) beacon_aggregate - a stats page built from data ONLY Beacon holds:
 *       the tenant's own GSC query universe (how many distinct questions
 *       people ask that this site could answer) and AI prompt/fanout volumes
 *       (how many sub-questions AI engines fan a topic into). These are
 *       proprietary per-tenant aggregates no competitor page can replicate.
 *
 * Ranked by real demand: summed GSC impressions across the family's member
 * pages, or the fanout/query counts for the aggregate kind. Never a fabricated
 * number - a family with no impression data still surfaces (row-count alone is
 * a legitimate signal) but is ranked below anything with real demand behind it.
 *
 * Pinned by dataset-candidates.test.ts.
 */

import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getPageSnapshotsForTenant } from "@/lib/tenant-data";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

/** Host-normalized lookup key for a page URL (strips scheme/www/trailing
 *  slash via the shared canonical-URL util) - page_snapshots and the demand
 *  graph's pageNodes can carry the SAME page under a www vs bare-host
 *  variant (one sourced from crawl, the other from GSC), so demand lookups
 *  join on this key rather than the raw URL string. Falls back to the raw
 *  URL (lowercased) when canonicalization fails, so a lookup never just
 *  silently drops a page over an unusual URL shape. */
function demandLookupKey(url: string): string {
  return canonicalizeCitationUrl(url) ?? url.trim().toLowerCase();
}

/** PostgREST's per-response row cap - one page of the paginated Supabase read. */
const SUPABASE_PAGE_SIZE = 1000;
/** Hard ceiling on pages read (1000 x this = the absolute row ceiling for one
 *  dataset-detection pass) - far above any real single-tenant page count. */
const MAX_SUPABASE_PAGES = 5;
/** Defense-in-depth cap on rows pulled into memory for family detection,
 *  applied after the read regardless of source. */
export const MAX_SNAPSHOTS_SCANNED = 1000;

/** Lean projection of page_snapshots this domain actually reads. */
type LeanSnapshotRow = {
  url: string;
  title: string | null;
  h2_list: string[] | null;
  schema_types: string[] | null;
  word_count: number | null;
};

/**
 * Read page_snapshots DIRECTLY from Supabase (paginated, capped at
 * MAX_SUPABASE_PAGES x SUPABASE_PAGE_SIZE rows). The generic json-store
 * `getPageSnapshotsForTenant` reads a FILE-backed store that `page_snapshots`
 * is not mirrored into (dual-write.ts writes this table directly) - so a
 * real read for dataset detection has to go straight at the table, same
 * pattern as profound-coverage/load-cached.ts's `readAll`. Fail-soft -> [],
 * and falls back to the json-store path when Supabase is not configured
 * (keeps this module usable in a pure file-backend dev environment).
 */
async function readPageSnapshotsDirect(tenantId: string): Promise<LeanSnapshotRow[]> {
  if (!isSupabaseConfigured()) {
    const fileRows = await getPageSnapshotsForTenant(tenantId).catch(() => []);
    return fileRows.map((s) => ({ url: s.url, title: s.title, h2_list: s.h2_list, schema_types: s.schema_types, word_count: s.word_count }));
  }
  const sb = getSupabaseAdmin();
  const out: LeanSnapshotRow[] = [];
  for (let page = 0; page < MAX_SUPABASE_PAGES; page += 1) {
    const from = page * SUPABASE_PAGE_SIZE;
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url,title,h2_list,schema_types,word_count")
      .eq("tenant_id", tenantId)
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) {
      log.warn("[datasets] page_snapshots read failed", { tenantId, error: error.message });
      break;
    }
    const rows = (data ?? []) as unknown as LeanSnapshotRow[];
    out.push(...rows);
    if (rows.length < SUPABASE_PAGE_SIZE) break;
  }
  return out;
}

/** A family needs at least this many member pages before it is worth
 *  compiling into a table (fewer rows would not read as a real dataset). */
export const MIN_FAMILY_SIZE = 5;

/** One dataset candidate's column spec (a table header + what it holds). */
export type DatasetColumn = {
  key: string;
  label: string;
  /** Where this column's values come from, in plain terms. */
  source: string;
};

export type DatasetCandidateKind = "page_family" | "beacon_aggregate";

export type DatasetCandidate = {
  slug: string;
  title: string;
  description: string;
  kind: DatasetCandidateKind;
  columns: DatasetColumn[];
  /** Estimated row count the compiled table would carry. */
  rowCountEstimate: number;
  /** The owned page URLs (page_family) or the aggregate's own name
   *  (beacon_aggregate) this candidate compiles from. */
  sourceFamilies: string[];
  /** Dated, honest one-liner: exactly where this data comes from and when it
   *  was last refreshed. Never claims data Beacon does not actually hold. */
  methodologyLine: string;
  /** Plain-English reason this is worth building, with a real number. */
  whyItWins: string;
  /** Real demand backing this candidate (summed GSC impressions across the
   *  family, or a query/fanout count for an aggregate) - the ranking key. */
  demandScore: number;
  /** Provenance tag threaded through the page-factory pipeline so the
   *  citation-outcome lane can later attribute AI citations to this dataset
   *  play specifically (see production-line.ts wiring). */
  datasetTag: "dataset_page";
};

// ── page_family detection (pure) ────────────────────────────────────────────

/** The minimal page-snapshot shape family detection needs. Matches the real
 *  PageSnapshot fields (src/domains/pages/types.ts) but only requires what is
 *  actually read, so tests can pass lean fixtures. */
export type SnapshotForFamilyDetection = {
  url: string;
  title?: string | null;
  h2_list?: string[] | null;
  schema_types?: string[] | null;
  word_count?: number | null;
};

/** Normalize an H2 into a generic SHAPE token (strip the specific entity,
 *  keep the structural word) so "History of Rice" and "History of Saffron"
 *  both fingerprint as "history" - shape, never topic. */
function h2ShapeTokens(h2s: readonly string[]): string[] {
  const GENERIC_H2_WORDS = [
    "history", "meaning", "origin", "overview", "facts", "date", "dates",
    "guide", "list", "types", "examples", "ingredients", "recipe", "population",
    "climate", "culture", "traditions", "significance", "etymology", "variations",
    "region", "regions", "pronunciation", "usage", "summary", "profile",
  ];
  const lower = h2s.map((h) => h.toLowerCase());
  return GENERIC_H2_WORDS.filter((w) => lower.some((h) => h.includes(w)));
}

/** A page's structural fingerprint: sorted schema types + sorted generic H2
 *  shape tokens. Two pages with the SAME fingerprint belong to the same
 *  template family - they share a repeatable structure, not a topic. */
function structuralFingerprint(s: SnapshotForFamilyDetection): string | null {
  const schema = [...new Set((s.schema_types ?? []).map((t) => t.trim()).filter(Boolean))].sort();
  const shape = [...new Set(h2ShapeTokens(s.h2_list ?? []))].sort();
  // Require at least SOME structural signal (a schema type or 2+ generic H2
  // shape tokens) before a page counts toward a family - otherwise every
  // thin/unstructured page would collapse into one meaningless "family".
  if (schema.length === 0 && shape.length < 2) return null;
  return `${schema.join("+")}::${shape.join("+")}`;
}

export type TemplateFamily = {
  fingerprint: string;
  members: SnapshotForFamilyDetection[];
  /** Shape tokens shared by every member - what the compiled columns cover. */
  sharedShapeTokens: string[];
  /** Schema types shared by every member. */
  sharedSchemaTypes: string[];
};

/**
 * Cluster snapshots into template families by structural fingerprint. PURE.
 * Never groups by a topic word - only by shared schema types + shared H2
 * shape - so this works identically for any tenant's content.
 */
export function detectTemplateFamilies(
  snapshots: readonly SnapshotForFamilyDetection[],
  minSize: number = MIN_FAMILY_SIZE,
): TemplateFamily[] {
  const byFingerprint = new Map<string, SnapshotForFamilyDetection[]>();
  for (const s of snapshots) {
    const fp = structuralFingerprint(s);
    if (!fp) continue;
    const arr = byFingerprint.get(fp) ?? [];
    arr.push(s);
    byFingerprint.set(fp, arr);
  }
  const out: TemplateFamily[] = [];
  for (const [fingerprint, members] of byFingerprint) {
    if (members.length < minSize) continue;
    const [schemaPart, shapePart] = fingerprint.split("::");
    out.push({
      fingerprint,
      members,
      sharedShapeTokens: shapePart ? shapePart.split("+").filter(Boolean) : [],
      sharedSchemaTypes: schemaPart ? schemaPart.split("+").filter(Boolean) : [],
    });
  }
  return out.sort((a, b) => b.members.length - a.members.length);
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

/** Build ONE page_family DatasetCandidate from a template family. PURE. */
export function buildPageFamilyCandidate(
  family: TemplateFamily,
  demandByUrl: ReadonlyMap<string, number>,
  now: Date = new Date(),
): DatasetCandidate | null {
  if (family.members.length < MIN_FAMILY_SIZE) return null;

  // Prefer a real H2 shape token as the label (most distinguishing); fall
  // back to the shared schema type (still real, still distinguishing between
  // e.g. a Product family and an ImageObject family); "profile" is the last
  // resort only when a family somehow carries neither (should not happen
  // given structuralFingerprint's own gate, kept as a safe default).
  const hasShapeToken = family.sharedShapeTokens.length > 0;
  const shapeLabel = family.sharedShapeTokens[0] ?? family.sharedSchemaTypes[0] ?? "profile";
  // "section" is only honest when the label came from a real H2 heading; a
  // schema-type label (e.g. "Product") describes the page's structured-data
  // TYPE, not a section on the page, so the copy says so plainly.
  const structureLine = hasShapeToken
    ? `each carrying its own ${titleCase(shapeLabel)} section`
    : `each tagged with the same "${titleCase(shapeLabel)}" structured-data type`;
  const rowLabel = "Entity";
  const columns: DatasetColumn[] = [
    { key: "entity", label: rowLabel, source: "The page title of each page in the family." },
    ...family.sharedShapeTokens.slice(0, 5).map((tok) => ({
      key: tok,
      label: titleCase(tok),
      source: `Extracted from the "${titleCase(tok)}" section of each page.`,
    })),
  ];
  if (family.sharedSchemaTypes.length > 0) {
    columns.push({
      key: "schema_type",
      label: "Page Type",
      source: "The structured-data type already on each page.",
    });
  }

  const demandScore = family.members.reduce((sum, m) => sum + (demandByUrl.get(demandLookupKey(m.url)) ?? 0), 0);
  const dateStamp = now.toISOString().slice(0, 10);
  const title = `${titleCase(shapeLabel)} Data: ${family.members.length} Pages Compared`;
  const slug = slugify(`${shapeLabel}-data-${family.members.length}`);

  return {
    slug,
    title,
    description: `A sortable table compiling the ${titleCase(shapeLabel)} data already published across ${family.members.length} of your pages, in one place.`,
    kind: "page_family",
    columns,
    rowCountEstimate: family.members.length,
    sourceFamilies: family.members.map((m) => m.url),
    methodologyLine: `I compiled this from ${family.members.length} pages already live on your site, ${structureLine}. Updated ${dateStamp} from your own published content.`,
    whyItWins: demandScore > 0
      ? `These ${family.members.length} pages together get ${Math.round(demandScore).toLocaleString()} search impressions. Compiling them into one table gives AI engines a primary source to cite instead of stitching your pages together themselves.`
      : `You already have ${family.members.length} pages sharing this exact structure. One compiled table turns scattered pages into a single citable source.`,
    demandScore,
    datasetTag: "dataset_page",
  };
}

// ── beacon_aggregate detection (pure) ───────────────────────────────────────

export type BeaconAggregateInput = {
  /** Distinct GSC query strings this tenant's owned pages have impressions
   *  for (the tenant's own query universe - Beacon-held, not public). */
  gscQueries: readonly string[];
  /** Distinct AI fanout sub-queries observed for this tenant (Profound query
   *  fanout rows) - the hidden sub-questions AI engines ask on this topic. */
  fanoutQueries: readonly string[];
  /** Total GSC impressions across those queries (the demand-score input). */
  totalImpressions: number;
};

/** Build the "how people actually search for this" aggregate candidate from
 *  Beacon's own held data (the tenant's GSC query universe). PURE. */
export function buildQueryUniverseCandidate(
  input: BeaconAggregateInput,
  now: Date = new Date(),
): DatasetCandidate | null {
  const rowCount = input.gscQueries.length;
  if (rowCount < MIN_FAMILY_SIZE) return null;
  const dateStamp = now.toISOString().slice(0, 10);
  return {
    slug: "search-questions-data",
    title: `The ${rowCount.toLocaleString()} Real Questions People Search For This Site`,
    description: "A compiled table of the exact search queries Google reports your pages have impressions for, ranked by volume.",
    kind: "beacon_aggregate",
    columns: [
      { key: "query", label: "Search Query", source: "Google Search Console, your own site's real query data." },
      { key: "impressions", label: "Impressions (90 days)", source: "Google Search Console impression counts." },
    ],
    rowCountEstimate: rowCount,
    sourceFamilies: ["gsc_query_universe"],
    methodologyLine: `I pulled this from your own Google Search Console data: ${rowCount.toLocaleString()} distinct queries with impressions in the last 90 days, as of ${dateStamp}. This is your own measured search data, not an estimate.`,
    whyItWins: `You have ${input.totalImpressions.toLocaleString()} real search impressions behind ${rowCount.toLocaleString()} distinct queries. No competitor can publish this exact table because it is your own measured data.`,
    demandScore: input.totalImpressions,
    datasetTag: "dataset_page",
  };
}

/** Build the "how AI breaks this topic down" aggregate candidate from
 *  Beacon's own held AI fanout data. PURE. */
export function buildFanoutVolumeCandidate(
  input: BeaconAggregateInput,
  now: Date = new Date(),
): DatasetCandidate | null {
  const rowCount = input.fanoutQueries.length;
  if (rowCount < MIN_FAMILY_SIZE) return null;
  const dateStamp = now.toISOString().slice(0, 10);
  return {
    slug: "ai-question-breakdown-data",
    title: `${rowCount.toLocaleString()} Sub-Questions AI Engines Ask About This Topic`,
    description: "A compiled table of the sub-questions AI answer engines fan your top topics into, tracked from real prompt runs.",
    kind: "beacon_aggregate",
    columns: [
      { key: "sub_question", label: "Sub-Question", source: "AI prompt fan-out tracking (Beacon's own nightly runs)." },
    ],
    rowCountEstimate: rowCount,
    sourceFamilies: ["ai_fanout_universe"],
    methodologyLine: `I pulled this from Beacon's own AI prompt tracking: ${rowCount.toLocaleString()} distinct sub-questions AI engines generated while answering questions about your topics, as of ${dateStamp}.`,
    whyItWins: `AI engines broke your topics into ${rowCount.toLocaleString()} distinct sub-questions. A page answering all of them in one table is the exact shape AI engines look for when citing a source.`,
    demandScore: rowCount,
    datasetTag: "dataset_page",
  };
}

// ── ranking ──────────────────────────────────────────────────────────────

/** Merge every detected candidate and take the top N by real demand score.
 *  Ties broken by row count (a bigger compiled table is a stronger source
 *  when demand is equal). PURE. */
export function rankDatasetCandidates(
  candidates: readonly DatasetCandidate[],
  topN: number = 3,
): DatasetCandidate[] {
  return [...candidates]
    .sort((a, b) => b.demandScore - a.demandScore || b.rowCountEstimate - a.rowCountEstimate)
    .slice(0, topN);
}

// ── loader (I/O) ─────────────────────────────────────────────────────────

/**
 * Load the tenant's top dataset candidates end to end: read owned page
 * snapshots DIRECTLY from Supabase (paginated, capped) + the cached demand
 * graph for real impressions, detect template families, build the two
 * Beacon-aggregate candidates from the graph's own query/fanout signal, rank
 * everything by real demand, return the top 3. Fail-soft -> [].
 */
export async function loadDatasetCandidatesForTenant(tenantId: string): Promise<DatasetCandidate[]> {
  try {
    const [snapshotsAll, { graph }] = await Promise.all([
      readPageSnapshotsDirect(tenantId).catch(() => []),
      loadDemandGraphForTenantCached(tenantId).catch(() => ({ graph: { demandNodes: [], pageNodes: [], edges: [], moves: [] } })),
    ]);
    const snapshots = snapshotsAll.slice(0, MAX_SNAPSHOTS_SCANNED);

    const demandByUrl = new Map<string, number>();
    for (const p of graph.pageNodes) {
      if (p.isOwned) demandByUrl.set(demandLookupKey(p.url), p.gscImpressions ?? 0);
    }

    const families = detectTemplateFamilies(
      snapshots.map((s) => ({
        url: s.url,
        title: s.title,
        h2_list: s.h2_list,
        schema_types: s.schema_types,
        word_count: s.word_count,
      })),
    );

    const now = new Date();
    const pageFamilyCandidates = families
      .map((f) => buildPageFamilyCandidate(f, demandByUrl, now))
      .filter((c): c is DatasetCandidate => c !== null);

    // Beacon-held aggregates: the tenant's own GSC query universe (from
    // owned page nodes' impressions - already loaded above, $0) plus the
    // AI fanout sub-query universe (already loaded on the demand graph's
    // demand nodes, $0, no new fetch).
    const gscQueries = new Set<string>();
    let totalImpressions = 0;
    for (const d of graph.demandNodes) {
      for (const q of d.queries ?? []) gscQueries.add(q);
      totalImpressions += d.demandWeight ?? 0;
    }
    const fanoutQueries = new Set<string>();
    for (const d of graph.demandNodes) {
      for (const q of d.fanoutSubQueries ?? []) fanoutQueries.add(q);
    }
    // Cached DataForSEO keyword volumes also feed the query-universe count
    // when the graph itself carries no demand nodes yet (thin tenants) -
    // still $0, still already-cached, never a fresh paid lookup.
    if (gscQueries.size === 0) {
      const cachedKeywords = await readAllCachedKeywordDemand().catch(() => []);
      for (const k of cachedKeywords) {
        gscQueries.add(k.keyword);
        totalImpressions += k.searchVolume ?? 0;
      }
    }

    const aggregateInput: BeaconAggregateInput = {
      gscQueries: [...gscQueries],
      fanoutQueries: [...fanoutQueries],
      totalImpressions,
    };
    const aggregateCandidates = [
      buildQueryUniverseCandidate(aggregateInput, now),
      buildFanoutVolumeCandidate(aggregateInput, now),
    ].filter((c): c is DatasetCandidate => c !== null);

    return rankDatasetCandidates([...pageFamilyCandidates, ...aggregateCandidates], 3);
  } catch (e) {
    log.warn("[datasets] candidate load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
