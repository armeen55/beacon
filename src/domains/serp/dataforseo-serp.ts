import "server-only";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId, currentTenant } from "@/lib/tenant-context";
import {
  recordSpendSupabase,
  getTenantSpentThisMonthUsd,
} from "@/lib/cost/budget-ledger-supabase";
import { assertPaidCallAllowed } from "@/domains/safety/cost-breaker";
import type { SerpSnapshot, SerpResult, SerpFeature } from "./serp-provider";
import { rootDomain } from "./serp-provider";

/**
 * dataforseo-serp (2026-06-25, Phase 3) — the SAFE live-SERP runner for DataForSEO.
 *
 * Money guardrails are NOT optional decoration — they are the whole point of this
 * module. Before ANY paid call it: (1) checks the connector is configured;
 * (2) serves a 14-day cache; (3) honors DRY-RUN (default ON — returns the PLANNED
 * call + est. cost, spends nothing); (4) enforces a hard monthly USD cap
 * (fail-CLOSED — over cap = no call); only then (5) fetches; then records spend in
 * the durable llm_budget_ledger (platform dataforseo-serp) + caches + logs a
 * structured ledger line. Every dependency is injectable so tests never spend.
 *
 * Smallest useful endpoint first: Google organic SERP top-N for ONE query. No
 * broad batches. Backlinks/keyword-volume are separate (deferred) endpoints.
 */

// DataForSEO "Live" Google organic ≈ $0.0006–0.002 / 10-result query. Use a
// conservative estimate so the cap trips early rather than late.
export const SERP_COST_USD = 0.003;
const SERP_CACHE_STORE = "dataforseo-serp-cache";
const SERP_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// R14b: exported so /settings/how-i-decide's registry imports the live value.
export const DEFAULT_MONTHLY_CAP_USD = 50;
// Item 20 (2026-07-02): live/regular -> live/advanced. The regular endpoint returns
// items ONLY for featured_snippet/organic/paid, so ai_overview never appeared in its
// items (verified against 83 real cached Iranopedia snapshots: 0 ai_overview). The
// DataForSEO pricing page lists ONE Live Mode price per SERP ($0.002, no regular vs
// advanced split), so advanced is the same documented cost and additionally returns
// the ai_overview element with its cited references. We deliberately do NOT send
// load_async_ai_overview (that parameter adds one base price per call); we parse
// only what the standard advanced response already contains.
const SERP_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/advanced";

export type SerpPlan = {
  endpoint: string;
  query: string;
  locationCode: number;
  languageCode: string;
  estCostUsd: number;
};

export type SerpRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type SerpRunResult = {
  status: SerpRunStatus;
  plan: SerpPlan;
  snapshot: SerpSnapshot | null;
  costUsd: number;
  detail: string;
};

export type DataForSeoEnv = {
  login?: string;
  password?: string;
  /** Pre-encoded base64(login:password) — the "Base64 Format" string DataForSEO
   *  shows in the dashboard. When present it's used verbatim, bypassing any
   *  login/password assembly. Most robust auth path. */
  authB64?: string;
  provider?: string;
  dryRun?: string;
  monthlyCapUsd?: string;
};

function readEnv(env: NodeJS.ProcessEnv = process.env): DataForSeoEnv {
  return {
    login: env.DATAFORSEO_LOGIN,
    password: env.DATAFORSEO_PASSWORD,
    authB64: (env.DATAFORSEO_AUTH_B64 ?? "").trim().replace(/^Basic\s+/i, "") || undefined,
    provider: env.BEACON_SERP_PROVIDER,
    dryRun: env.DATAFORSEO_DRY_RUN,
    monthlyCapUsd: env.DATAFORSEO_MONTHLY_CAP_USD,
  };
}

/** The Basic-auth value to send: the dashboard base64 string if provided, else
 *  base64(login:password). Returns null when nothing usable is set. */
export function resolveAuthB64(env: NodeJS.ProcessEnv = process.env): string | null {
  const e = readEnv(env);
  if (e.authB64) return e.authB64;
  if (e.login && e.password) return Buffer.from(`${e.login}:${e.password}`).toString("base64");
  return null;
}

/** Configured = provider selected AND a usable auth (base64 OR login+password). */
export function isDataForSeoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(env).provider === "dataforseo" && resolveAuthB64(env) !== null;
}

/** DRY-RUN is the DEFAULT. Only an explicit DATAFORSEO_DRY_RUN=false turns it off. */
export function isDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(env).dryRun !== "false";
}

export function monthlyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(readEnv(env).monthlyCapUsd);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_CAP_USD;
}

/** Build the planned call (endpoint + estimated cost) without performing it. */
export function planSerpCall(
  query: string,
  opts: { locationCode?: number; languageCode?: string } = {},
): SerpPlan {
  return {
    endpoint: SERP_ENDPOINT,
    query: query.trim(),
    locationCode: opts.locationCode ?? 2840, // United States
    languageCode: opts.languageCode ?? "en",
    estCostUsd: SERP_COST_USD,
  };
}

/** One 14-day cache row. Exported (type-only) so the history backfill script can
 *  read the real cache without re-declaring its shape. */
export type SerpCacheRow = { key: string; snapshot: SerpSnapshot; fetchedAt: string };
type CacheRow = SerpCacheRow;
const cacheKey = (plan: SerpPlan): string => `${plan.locationCode}|${plan.languageCode}|${plan.query.toLowerCase()}`;

/** One organic result in rank order: the minimal { rank, domain, url } triple the
 *  history table stores per snapshot (item 17). */
export type SerpOrganicItem = { rank: number; domain: string; url: string };

/** parseDataForSeoSerp's return: the existing SerpSnapshot PLUS the ranked organic
 *  triples (item 17) PLUS the parsed AI Overview (item 20) PLUS the featured-snippet
 *  owner + PAA questions (item 25). Additive - every existing consumer keeps
 *  treating it as a SerpSnapshot. */
export type ParsedSerp = SerpSnapshot & {
  organicItems: SerpOrganicItem[];
  aiOverview: ParsedAiOverview;
  snippetOwner: ParsedFeaturedSnippet | null;
  paaQuestions: ParsedPaaQuestion[];
};

/** The ranked { rank, domain, url } triples of a snapshot's organic results. Pure. */
export function organicItemsOf(snapshot: SerpSnapshot): SerpOrganicItem[] {
  return snapshot.results.map((r) => ({ rank: r.rank, domain: r.domain, url: r.url }));
}

/**
 * Where does the tenant's OWN domain sit in this snapshot? Pure. Handles the known
 * URL traps: schemeless forms ("www.iranopedia.com/x"), scheme + www prefixes on
 * the tenant domain itself, and subdomains ("blog.iranopedia.com" counts as owned).
 * Suffix look-alikes ("notiranopedia.com") do NOT match. Returns nulls when the
 * domain is absent from the captured results - never guessed.
 */
export function resolveOwnRank(
  items: SerpOrganicItem[],
  tenantDomain: string | null | undefined,
): { ownRank: number | null; ownUrl: string | null } {
  const own = rootDomain((tenantDomain ?? "").trim());
  if (!own) return { ownRank: null, ownUrl: null };
  for (const it of items) {
    // Result domains come from rootDomain(url) (lowercased, www-stripped); item
    // urls may still be schemeless, so normalize defensively here too.
    const d = (it.domain || rootDomain(it.url)).toLowerCase();
    if (d === own || d.endsWith(`.${own}`)) return { ownRank: it.rank, ownUrl: it.url };
  }
  return { ownRank: null, ownUrl: null };
}

// ─── Google AI Overview parsing (item 20) ───────────────────────────────────
//
// The live/advanced endpoint's ai_overview item carries a top-level `references`
// array: the deduplicated list of domains/urls the overview actually cites
// (verified against 2 real live probe calls on 2026-07-02 - "what is nowruz" and
// "persian new year traditions" both returned populated references with
// { domain, url, title, source }). We read ONLY that top-level references array
// (never the per-element nested `items[].references`, which repeats the same
// citations once per overview paragraph) so one reference = one cited domain.

/** One domain the AI Overview cites, in the order DataForSEO returned it. */
export type AiOverviewCitedDomain = { domain: string; url: string; position: number };

/** parseAiOverview's return: whether an overview rendered at all, which domains
 *  it cites (empty when present but references were withheld), and a short
 *  excerpt of its text for operator display. */
export type ParsedAiOverview = {
  present: boolean;
  citedDomains: AiOverviewCitedDomain[];
  overviewTextExcerpt: string;
};

const NO_AI_OVERVIEW: ParsedAiOverview = { present: false, citedDomains: [], overviewTextExcerpt: "" };
const AI_OVERVIEW_EXCERPT_MAX = 300;

/** Parse ONE SERP response's `ai_overview` item (when present) into the cited
 *  domains + a short text excerpt. Pure, never throws - malformed/absent input
 *  answers the honest "no overview" shape. */
export function parseAiOverview(item: unknown): ParsedAiOverview {
  if (!item || typeof item !== "object") return NO_AI_OVERVIEW;
  const it = item as Record<string, unknown>;
  if (String(it.type ?? "") !== "ai_overview") return NO_AI_OVERVIEW;

  const refs = Array.isArray(it.references) ? it.references : [];
  const citedDomains: AiOverviewCitedDomain[] = [];
  let position = 0;
  for (const r of refs) {
    if (!r || typeof r !== "object") continue;
    const ref = r as Record<string, unknown>;
    const url = typeof ref.url === "string" ? ref.url : "";
    if (!url) continue;
    // Always normalize through rootDomain (strips "www.", lowercases) so these
    // domains compare cleanly against SerpOrganicItem.domain and resolveOwnRank's
    // own-domain matching elsewhere in this file - a raw "www.un.org" reference
    // field would otherwise silently fail to match a bare "un.org" tenant domain.
    const domain = rootDomain(typeof ref.domain === "string" && ref.domain ? ref.domain : url);
    if (!domain) continue;
    position += 1;
    citedDomains.push({ domain, url, position });
  }

  // markdown is closest to what a reader sees; fall back to the plain-text field.
  const rawText = typeof it.markdown === "string" && it.markdown ? it.markdown : typeof it.text === "string" ? it.text : "";
  const flat = rawText.replace(/\s+/g, " ").trim();
  const overviewTextExcerpt =
    flat.length > AI_OVERVIEW_EXCERPT_MAX ? `${flat.slice(0, AI_OVERVIEW_EXCERPT_MAX - 3)}...` : flat;

  return { present: true, citedDomains, overviewTextExcerpt };
}

// ─── Featured snippet + PAA parsing (item 25) ───────────────────────────────
//
// The same live/advanced response body already carries the featured_snippet and
// people_also_ask items whenever they render; parseDataForSeoSerp previously only
// flagged their presence as a boolean SerpFeature and discarded who owns them and
// what they say. These two parsers pull that out at $0 added spend (no new call,
// no new parameter - just reading fields already in the paid-for body).

/** Who owns the featured snippet, in what format, and a short excerpt of its text. */
export type ParsedFeaturedSnippet = {
  ownerDomain: string;
  ownerUrl: string;
  /** Up to 300 chars of the snippet's own text (never the whole page). */
  textExcerpt: string;
  format: "paragraph" | "list" | "table";
};

/** One People Also Ask question, with the domain that answers it when the
 *  response includes an expanded answer (absent -> undefined, never guessed). */
export type ParsedPaaQuestion = {
  question: string;
  answerDomain?: string;
};

const SNIPPET_EXCERPT_MAX = 300;

/** Parse ONE SERP response's `featured_snippet` item (when present) into its owner
 *  domain/url, a short text excerpt, and the answer format. Pure, never throws -
 *  malformed/absent input answers null (no snippet observed). */
export function parseFeaturedSnippet(item: unknown): ParsedFeaturedSnippet | null {
  if (!item || typeof item !== "object") return null;
  const it = item as Record<string, unknown>;
  if (String(it.type ?? "") !== "featured_snippet") return null;

  const url = typeof it.url === "string" ? it.url : "";
  if (!url) return null;
  const ownerDomain = rootDomain(typeof it.domain === "string" && it.domain ? it.domain : url);
  if (!ownerDomain) return null;

  const rawText =
    typeof it.description === "string" && it.description
      ? it.description
      : typeof it.text === "string" && it.text
        ? it.text
        : typeof it.title === "string"
          ? it.title
          : "";
  const flat = rawText.replace(/\s+/g, " ").trim();
  const textExcerpt = flat.length > SNIPPET_EXCERPT_MAX ? `${flat.slice(0, SNIPPET_EXCERPT_MAX - 3)}...` : flat;

  // DataForSEO's featured_snippet item carries a `featured_snippet_type` of
  // "paragraph" | "list" | "table"; some responses instead signal a list/table via
  // a populated `table` array or bullet-style `items`. Default to paragraph, the
  // most common shape, when nothing else indicates otherwise.
  const rawFormat = String(it.featured_snippet_type ?? "").toLowerCase();
  let format: ParsedFeaturedSnippet["format"] = "paragraph";
  if (rawFormat === "list" || rawFormat === "table") {
    format = rawFormat;
  } else if (Array.isArray(it.table) && it.table.length > 0) {
    format = "table";
  } else if (Array.isArray(it.items) && it.items.length > 0) {
    format = "list";
  }

  return { ownerDomain, ownerUrl: url, textExcerpt, format };
}

/** Parse a DataForSEO `people_also_ask` item's nested question list into our lean
 *  shape. Pure, never throws - malformed/absent input answers []. Accepts the raw
 *  `people_also_ask_element` array so the caller does not need to know DataForSEO's
 *  nested item-of-items shape. */
export function parsePaaQuestions(items: unknown): ParsedPaaQuestion[] {
  if (!Array.isArray(items)) return [];
  const out: ParsedPaaQuestion[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as Record<string, unknown>;
    const question = typeof el.title === "string" && el.title ? el.title : typeof el.question === "string" ? el.question : "";
    if (!question.trim()) continue;
    // The expanded answer (when DataForSEO returns one) nests one level under
    // `expanded_element[0]`, carrying its own url/domain - the site Google chose
    // to answer that specific PAA question with.
    const expanded = Array.isArray(el.expanded_element) ? el.expanded_element[0] : null;
    let answerDomain: string | undefined;
    if (expanded && typeof expanded === "object") {
      const exp = expanded as Record<string, unknown>;
      const url = typeof exp.url === "string" ? exp.url : "";
      const domain = rootDomain(typeof exp.domain === "string" && exp.domain ? exp.domain : url);
      if (domain) answerDomain = domain;
    }
    out.push(answerDomain ? { question: question.trim(), answerDomain } : { question: question.trim() });
  }
  return out;
}

/** Parse a DataForSEO organic-live response body into our SerpSnapshot (+ ranked
 *  organic triples, item 17; + the parsed AI Overview, item 20; + the featured-snippet
 *  owner + PAA questions, item 25 - all additive; consumers of SerpSnapshot are
 *  unchanged). */
export function parseDataForSeoSerp(query: string, body: unknown, nowIso: string): ParsedSerp {
  const results: SerpResult[] = [];
  const features = new Set<SerpFeature>();
  let aiOverview: ParsedAiOverview = NO_AI_OVERVIEW;
  let snippetOwner: ParsedFeaturedSnippet | null = null;
  let paaQuestions: ParsedPaaQuestion[] = [];
  const FEATURE_MAP: Record<string, SerpFeature> = {
    ai_overview: "ai_overview",
    featured_snippet: "featured_snippet",
    people_also_ask: "people_also_ask",
    images: "image_pack",
    video: "video",
    knowledge_graph: "knowledge_panel",
  };
  try {
    const items = (body as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> })
      ?.tasks?.[0]?.result?.[0]?.items ?? [];
    let rank = 0;
    for (const it of items) {
      const type = String(it.type ?? "");
      if (FEATURE_MAP[type]) features.add(FEATURE_MAP[type]);
      if (type === "organic" && typeof it.url === "string") {
        rank += 1;
        results.push({
          rank,
          url: it.url,
          title: String(it.title ?? ""),
          domain: rootDomain(it.url),
        });
      }
      if (type === "ai_overview") aiOverview = parseAiOverview(it);
      if (type === "featured_snippet") snippetOwner = parseFeaturedSnippet(it);
      if (type === "people_also_ask") paaQuestions = parsePaaQuestions(it.items);
    }
  } catch {
    /* malformed body → empty results (honest, never throws) */
  }
  const snapshot: SerpSnapshot = { query, results, features: [...features], source: "dataforseo", fetchedAt: nowIso };
  return { ...snapshot, organicItems: organicItemsOf(snapshot), aiOverview, snippetOwner, paaQuestions };
}

// ─── Append-only SERP history (item 17) ─────────────────────────────────────
//
// Every OK live read ALSO appends one durable row to dataforseo_serp_history -
// the time dimension the overwrite-style cache destroys. $0 marginal cost (the
// read is already paid for). APPEND-ONLY: inserts use ON CONFLICT DO NOTHING;
// nothing here ever updates or deletes a history row.

/** One append-only history row - mirrors migrations/2026-07-02_dataforseo_serp_history.sql
 *  and its item-20 follow-up (ai_overview_present / ai_overview_domains). */
export type SerpHistoryRow = {
  tenant_id: string;
  id: string;
  query: string;
  location: string;
  captured_at: string;
  own_rank: number | null;
  own_url: string | null;
  top_domains: SerpOrganicItem[];
  serp_features: string[];
  raw_cost_usd: number;
  /** Item 20: did Google render an AI Overview for this query at capture time. */
  ai_overview_present: boolean;
  /** Item 20: the overview's cited domains in order, [] when absent or references
   *  were withheld. Never null - absence is expressed as an empty array. */
  ai_overview_domains: AiOverviewCitedDomain[];
  /** Item 25: who owns the featured snippet at capture time (owner domain/url,
   *  a short text excerpt, and its format), or null when no snippet rendered. */
  snippet_owner: ParsedFeaturedSnippet | null;
  /** Item 25: the People Also Ask questions rendered at capture time, [] when
   *  none rendered. Never null - absence is an empty array. */
  paa_questions: ParsedPaaQuestion[];
};

/** Build the history row for one captured snapshot. Pure - shared by the live
 *  writer and the backfill script so both produce byte-identical rows.
 *  `aiOverview` is optional (item 20), `snippetOwner`/`paaQuestions` are optional
 *  (item 25) so the existing backfill script, which has no overview/snippet/PAA
 *  data to replay, keeps building valid rows with the honest "nothing observed"
 *  default rather than fabricating one. */
export function buildSerpHistoryRow(input: {
  tenantId: string;
  query: string;
  location: string;
  snapshot: SerpSnapshot;
  tenantDomain: string | null;
  capturedAt: string;
  costUsd: number;
  aiOverview?: ParsedAiOverview;
  snippetOwner?: ParsedFeaturedSnippet | null;
  paaQuestions?: ParsedPaaQuestion[];
}): SerpHistoryRow {
  const normQuery = input.query.trim().toLowerCase();
  const items = organicItemsOf(input.snapshot);
  const own = resolveOwnRank(items, input.tenantDomain);
  const overview = input.aiOverview ?? NO_AI_OVERVIEW;
  return {
    tenant_id: input.tenantId,
    id: `${normQuery}|${input.capturedAt}`,
    query: normQuery,
    location: input.location,
    captured_at: input.capturedAt,
    own_rank: own.ownRank,
    own_url: own.ownUrl,
    top_domains: items,
    serp_features: [...input.snapshot.features],
    raw_cost_usd: input.costUsd,
    ai_overview_present: overview.present,
    ai_overview_domains: overview.citedDomains,
    snippet_owner: input.snippetOwner ?? null,
    paa_questions: input.paaQuestions ?? [],
  };
}

/** Default history appender: insert-or-ignore into Supabase (append-only). Throws
 *  on error - the caller treats any failure as fail-soft (log + move on). */
async function appendSerpHistorySupabase(row: SerpHistoryRow): Promise<void> {
  const { getSupabaseAdmin } = await import("@/lib/persistence/supabase");
  const { error } = await getSupabaseAdmin()
    .from("dataforseo_serp_history")
    .upsert(row, { onConflict: "tenant_id,id", ignoreDuplicates: true });
  if (error) throw new Error(error.message ?? String(error));
}

/** Default tenant-domain resolver for own-rank extraction. Null when the tenant
 *  record is unavailable (CLI without registry, misconfig) - fail-soft, never throws. */
async function currentTenantDomain(): Promise<string | null> {
  try {
    return (await currentTenant()).domain ?? null;
  } catch {
    return null;
  }
}

export type SerpRunDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  tenantId: () => Promise<string>;
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  readCache: () => Promise<CacheRow[]>;
  writeCache: (rows: CacheRow[]) => Promise<void>;
  fetchImpl: typeof fetch;
  /** Item 17: the tenant's own domain for own-rank extraction (null = unknown). */
  tenantDomain: () => Promise<string | null>;
  /** Item 17: append ONE durable history row (append-only; failures are fail-soft). */
  appendHistory: (row: SerpHistoryRow) => Promise<void>;
  /** N43 GLOBAL cost breaker (OUTER guard over the per-platform cap). Returns
   *  tripped=true to hold the paid call. Hermetic no-op under vitest by default
   *  (never reads the operator's real ledger from a test); the real breaker in
   *  production. Injected by tests that pin the outer ceiling. */
  globalBreaker: (env: NodeJS.ProcessEnv, now: Date, projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

const defaultDeps: SerpRunDeps = {
  env: process.env,
  now: () => new Date(),
  tenantId: currentTenantId,
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }),
  readCache: () => readStore<CacheRow>(SERP_CACHE_STORE, []),
  writeCache: (rows) => writeStore(SERP_CACHE_STORE, rows),
  fetchImpl: fetch,
  tenantDomain: currentTenantDomain,
  appendHistory: appendSerpHistorySupabase,
  globalBreaker: async (env, now, projectedCostUsd) => {
    // Hermetic under vitest: never read the real cross-lane ledger from a test.
    if (underVitest()) return { tripped: false };
    return assertPaidCallAllowed({ projectedCostUsd }, { env, now: () => now });
  },
};

/**
 * Run ONE Google-organic SERP query through the full safety gauntlet. Never
 * throws. Returns the status + (when available) the snapshot. Spends real money
 * ONLY on status "ok" (configured + not dry-run + under cap + cache miss).
 */
export async function runSerpQuery(
  query: string,
  opts: {
    locationCode?: number;
    languageCode?: string;
    depth?: number;
    /** Item 19 (2026-07-02): bypass the 14d cache for this call only - the full
     *  gauntlet below (configured / dry-run / cap / ledger) still applies. Used by
     *  the rank re-check pass so a day-7/14/28 "now" read is never a stale cache
     *  hit. Additive - every existing caller omits this and behaves exactly as
     *  before. */
    forceFresh?: boolean;
  } = {},
  depsOverride: Partial<SerpRunDeps> = {},
): Promise<SerpRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan = planSerpCall(query, opts);
  const q = plan.query;
  if (!q) return { status: "error", plan, snapshot: null, costUsd: 0, detail: "empty query" };

  if (!isDataForSeoConfigured(deps.env)) {
    return { status: "disabled", plan, snapshot: null, costUsd: 0, detail: "DataForSEO not configured" };
  }

  const now = deps.now();
  const nowMs = now.getTime();

  // (2) cache — serve a fresh result without spending. Skipped entirely when
  // forceFresh is set (item 19 rank re-check) so a due 7/14/28-day check can't
  // silently reuse a snapshot captured before the ship.
  if (!opts.forceFresh) {
    try {
      const rows = await deps.readCache();
      const hit = rows.find((r) => r.key === cacheKey(plan));
      if (hit && nowMs - Date.parse(hit.fetchedAt) < SERP_CACHE_TTL_MS) {
        log.info("[dataforseo-serp] cache hit", { query: q, fetchedAt: hit.fetchedAt });
        return { status: "cache_hit", plan, snapshot: hit.snapshot, costUsd: 0, detail: "served from 14d cache" };
      }
    } catch {
      /* cache read failure is non-fatal — fall through */
    }
  }

  // (3) DRY-RUN (default) — return the PLAN, spend nothing.
  if (isDryRun(deps.env)) {
    log.info("[dataforseo-serp] DRY-RUN (no spend)", { query: q, estCostUsd: plan.estCostUsd, endpoint: plan.endpoint });
    return { status: "dry_run", plan, snapshot: null, costUsd: 0, detail: `dry-run — would spend ~$${plan.estCostUsd}` };
  }

  // (3.5) GLOBAL cost breaker (N43) - the OUTER guard OVER the per-platform cap
  // below. Reached ONLY on the paid path (cache hits + dry-runs already returned
  // above), so it can never block free work. Belt-and-suspenders: it never
  // loosens the per-platform monthly cap in (4); it only ever adds a refusal
  // when the combined cross-lane spend has crossed the global ceiling.
  const breaker = await deps.globalBreaker(deps.env, now, plan.estCostUsd).catch(() => ({
    tripped: true,
    reason: "global spend breaker unavailable, failing closed",
  }));
  if (breaker.tripped) {
    log.warn("[dataforseo-serp] global cost breaker tripped — no call", { detail: breaker.reason });
    return { status: "capped", plan, snapshot: null, costUsd: 0, detail: breaker.reason ?? "global monthly ceiling reached" };
  }

  // (4) hard monthly cap — FAIL-CLOSED (over cap or unknown spend = no call).
  const tenantId = await deps.tenantId();
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(tenantId, now).catch(() => null);
  if (spent === null) {
    log.warn("[dataforseo-serp] spend unknown — failing closed (no call)", { tenantId });
    return { status: "capped", plan, snapshot: null, costUsd: 0, detail: "monthly spend unknown — failing closed" };
  }
  if (spent + plan.estCostUsd > cap) {
    log.warn("[dataforseo-serp] monthly cap reached — no call", { tenantId, spent, cap });
    return { status: "capped", plan, snapshot: null, costUsd: 0, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }

  // (5) the paid call.
  try {
    const auth = resolveAuthB64(deps.env) ?? "";
    const res = await deps.fetchImpl(plan.endpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keyword: q, location_code: plan.locationCode, language_code: plan.languageCode, depth: opts.depth ?? 10 },
      ]),
    });
    if (!res.ok) {
      log.warn("[dataforseo-serp] non-2xx", { query: q, status: res.status });
      return { status: "error", plan, snapshot: null, costUsd: 0, detail: `http ${res.status}` };
    }
    const body = await res.json();
    const snapshot = parseDataForSeoSerp(q, body, now.toISOString());

    // record spend (durable) + cache + structured ledger line.
    await deps.recordSpend(tenantId, plan.estCostUsd).catch((err) =>
      log.warn("[dataforseo-serp] durable spend write failed (non-fatal)", { error: String(err) }),
    );
    try {
      const rows = (await deps.readCache()).filter((r) => r.key !== cacheKey(plan));
      rows.push({ key: cacheKey(plan), snapshot, fetchedAt: now.toISOString() });
      await deps.writeCache(rows);
    } catch {
      /* cache write failure is non-fatal */
    }
    // Item 17 - append-only history row riding this already-paid read ($0 marginal).
    // Best-effort + fail-soft: NEVER fails the main read; runs ONLY on real "ok"
    // (never on cache hits / dry-run / capped / error). Awaited behind a catch so
    // serverless does not silently drop the write - the same posture as recordSpend.
    try {
      const tenantDomain = await deps.tenantDomain().catch(() => null);
      await deps.appendHistory(
        buildSerpHistoryRow({
          tenantId,
          query: q,
          location: `${plan.locationCode}|${plan.languageCode}`,
          snapshot,
          tenantDomain,
          capturedAt: now.toISOString(),
          costUsd: plan.estCostUsd,
          aiOverview: snapshot.aiOverview,
          snippetOwner: snapshot.snippetOwner,
          paaQuestions: snapshot.paaQuestions,
        }),
      );
    } catch (err) {
      log.warn("[dataforseo-serp] history append failed (non-fatal)", {
        query: q,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    log.info("[dataforseo-serp] LEDGER", {
      tenantId,
      query: q,
      endpoint: plan.endpoint,
      estCostUsd: plan.estCostUsd,
      results: snapshot.results.length,
      features: snapshot.features.join(","),
      cache: "miss",
    });
    return { status: "ok", plan, snapshot, costUsd: plan.estCostUsd, detail: `${snapshot.results.length} results` };
  } catch (err) {
    log.warn("[dataforseo-serp] fetch threw (non-fatal)", { query: q, error: err instanceof Error ? err.message : String(err) });
    return { status: "error", plan, snapshot: null, costUsd: 0, detail: "fetch failed" };
  }
}
