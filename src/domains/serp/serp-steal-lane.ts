import "server-only";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { readLastFinalizedDate } from "@/domains/proof-gsc/gsc-window";
import { getLatestMoveDrafts, saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import {
  auditCompetitorPage,
  getCompetitorAuditsForTenant,
  isTeardownFresh,
  whatWins,
  type CompetitorPageAudit,
} from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { topicTokens } from "@/domains/evidence/relevance-gate";
import { runSerpQuery, type SerpOrganicItem } from "./dataforseo-serp";
import { rootDomain } from "./serp-provider";

/**
 * serp-steal-lane (DREAM SITE V1, item D3, 2026-07-02) - "we scrape by the
 * keyword, competitors that are beating our keywords or phrases in GSC, the
 * SERPs, and then steal the best among the top 5 in the SERPs."
 *
 * This is the SEO-mirror twin of D2's AEO citation teardown: instead of
 * starting from a prompt's AI-cited sources, it starts from a GSC keyword the
 * tenant already ranks for (position 4-20, real impressions) but does not
 * lead on, reads the real Google top-5 for that keyword, and tears those
 * pages down through the EXISTING competitor-page-audit engine (imported
 * read-only - this file never edits that module). The two lanes converge in
 * teardown-library.ts so one page can be tagged ai_answers, google_results,
 * or both.
 *
 * Money posture, cheapest source first:
 *   1. `dataforseo_serp_history` - a stored row for this exact query, $0.
 *   2. `runSerpQuery`'s own full gauntlet (configured -> 14d cache -> dry-run
 *      default -> fail-closed monthly cap -> ledger) - untouched here - but
 *      ONLY up to `maxLiveSerpPulls` (default 5) queries per run, so a
 *      keyword list can never silently drain the whole nightly live-SERP
 *      allowance the displacement-check step also draws from.
 *   3. Teardown of the resulting top-5 URLs rides the EXISTING, already-free
 *      polite-fetch + 14-day-fresh competitor-page-audit cache - no new
 *      paid call.
 *
 * Every read is bounded and fail-soft, mirroring displacement-check.ts's
 * posture (the closest existing analog: GSC-derived, capped live SERP spend,
 * persisted verdict via move_drafts).
 */

// ── PURE beaten-keyword selection (unit-testable without a DB) ─────────────

export type BeatenKeywordAgg = { clicks: number; impressions: number; posWeighted: number; page: string };

export type BeatenKeyword = {
  query: string;
  /** Our own best-attributed page for this query (highest clicks). */
  page: string;
  clicks: number;
  impressions: number;
  /** Impression-weighted average Google position over the window. */
  position: number;
};

/** Floor: rank 4-20 (page 1 tail through page 2) with real demand - a top-3
 *  result has nothing to steal, and a rank past 20 rarely has any organic
 *  competitor worth reading (SERP composition there is noisy/thin). */
const DEFAULT_MIN_POSITION = 4;
const DEFAULT_MAX_POSITION = 20;
/** Impressions floor: a real audience is searching, not a stray query. */
const DEFAULT_MIN_IMPRESSIONS = 500;

/**
 * PURE: from one window's per-query aggregate, pick the queries where we
 * rank 4-20 with meaningful impressions - "keywords competitors beat us on."
 * Sorted by impressions (biggest audience first), capped. Exported so the
 * floors are fully unit-testable without a live DB.
 */
export function selectBeatenKeywords(
  byQuery: ReadonlyMap<string, BeatenKeywordAgg>,
  opts: { minPosition?: number; maxPosition?: number; minImpressions?: number; cap?: number } = {},
): BeatenKeyword[] {
  const minPosition = opts.minPosition ?? DEFAULT_MIN_POSITION;
  const maxPosition = opts.maxPosition ?? DEFAULT_MAX_POSITION;
  const minImpressions = opts.minImpressions ?? DEFAULT_MIN_IMPRESSIONS;
  const cap = opts.cap ?? 25;

  const out: BeatenKeyword[] = [];
  for (const [query, agg] of byQuery) {
    if (agg.impressions < minImpressions) continue;
    const position = agg.impressions > 0 ? agg.posWeighted / agg.impressions : 0;
    if (position < minPosition || position > maxPosition) continue;
    out.push({ query, page: agg.page, clicks: agg.clicks, impressions: agg.impressions, position });
  }
  out.sort((a, b) => b.impressions - a.impressions);
  return out.slice(0, cap);
}

// ── GSC read: one window, site-wide, bounded (mirrors displacement-check) ──

const WINDOW_DAYS = 28;
const ROW_BUDGET = 40_000;
const PAGE_SIZE = 1_000;

function isoDaysBefore(anchorMs: number, days: number): string {
  return new Date(anchorMs - days * 86_400_000).toISOString().slice(0, 10);
}

async function readBeatenKeywordWindow(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<Map<string, BeatenKeywordAgg>> {
  const out = new Map<string, BeatenKeywordAgg>();
  const sb = getSupabaseAdmin();
  const pageClicksByQuery = new Map<string, Map<string, number>>();

  for (let offset = 0; offset < ROW_BUDGET; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("gsc_daily_rows")
      .select("query, page, clicks, impressions, position")
      .eq("tenant_id", tenantId)
      .gte("date", fromIso)
      .lt("date", toIso)
      .order("date", { ascending: true })
      .order("page", { ascending: true })
      .order("query", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      log.warn("[serp-steal-lane] gsc_daily_rows page read failed", { tenantId, offset, error: error.message });
      break;
    }
    const batch = data ?? [];
    for (const r of batch) {
      const query = (r.query as string)?.trim();
      const page = (r.page as string)?.trim();
      if (!query || !page) continue;
      const impr = Number(r.impressions) || 0;
      const clicks = Number(r.clicks) || 0;
      const a = out.get(query) ?? { clicks: 0, impressions: 0, posWeighted: 0, page: "" };
      a.clicks += clicks;
      a.impressions += impr;
      a.posWeighted += (Number(r.position) || 0) * impr;
      out.set(query, a);

      const perPage = pageClicksByQuery.get(query) ?? new Map<string, number>();
      perPage.set(page, (perPage.get(page) ?? 0) + clicks);
      pageClicksByQuery.set(query, perPage);
    }
    if (batch.length < PAGE_SIZE) break;
  }

  for (const [query, agg] of out) {
    const perPage = pageClicksByQuery.get(query);
    if (!perPage || perPage.size === 0) continue;
    agg.page = [...perPage.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  return out;
}

/**
 * Load the tenant's real beaten keywords - our own rank 4-20, real
 * impressions - anchored to the last FINALIZED GSC day (same anchoring as
 * displacement-check, so a partially-synced "recent" window never
 * manufactures a phantom position). Fail-soft -> [].
 */
export async function loadBeatenKeywordsForTenant(
  tenantId: string,
  opts: { minPosition?: number; maxPosition?: number; minImpressions?: number; cap?: number; windowDays?: number } = {},
): Promise<BeatenKeyword[]> {
  if (!tenantId || !isSupabaseConfigured()) return [];
  try {
    const lastFinal = await readLastFinalizedDate(tenantId).catch(() => null);
    const anchorMs = lastFinal ? Date.parse(`${lastFinal}T00:00:00.000Z`) : Date.now();
    const fromIso = isoDaysBefore(anchorMs, opts.windowDays ?? WINDOW_DAYS);
    const toIso = isoDaysBefore(anchorMs, 0);
    const byQuery = await readBeatenKeywordWindow(tenantId, fromIso, toIso);
    return selectBeatenKeywords(byQuery, opts);
  } catch (e) {
    log.warn("[serp-steal-lane] beaten-keyword read threw", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

// ── SERP top-5 resolution: stored history first, capped live pull second ───

export type SerpTop5Source = "stored_history" | "live_pull" | "unavailable";

export type SerpTop5Result = {
  query: string;
  source: SerpTop5Source;
  /** Up to 5 organic result URLs, rank order. Empty when unavailable. */
  items: SerpOrganicItem[];
  capturedAt: string | null;
};

/** Read the most recent stored SERP snapshot for this exact query, $0. */
async function readStoredSerpTop5(tenantId: string, query: string): Promise<SerpTop5Result | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("dataforseo_serp_history")
      .select("captured_at, top_domains")
      .eq("tenant_id", tenantId)
      .eq("query", query.trim().toLowerCase())
      .order("captured_at", { ascending: false })
      .limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as { captured_at: string; top_domains: SerpOrganicItem[] | null };
    const items = Array.isArray(row.top_domains) ? row.top_domains.slice(0, 5) : [];
    if (items.length === 0) return null;
    return { query, source: "stored_history", items, capturedAt: row.captured_at };
  } catch {
    return null;
  }
}

export type SteaLaneDeps = {
  readStored: (tenantId: string, query: string) => Promise<SerpTop5Result | null>;
  runLive: (query: string) => ReturnType<typeof runSerpQuery>;
};

const defaultDeps: SteaLaneDeps = {
  readStored: readStoredSerpTop5,
  runLive: (query) => runSerpQuery(query, { depth: 10 }),
};

/**
 * Resolve the real Google top-5 for each beaten keyword, cheapest source
 * first: a stored `dataforseo_serp_history` row, else (bounded by
 * `maxLiveSerpPulls`) one live `runSerpQuery` call through its own unmodified
 * gauntlet (configured -> cache -> dry-run -> fail-closed cap -> ledger).
 * Queries past the live-pull budget are honestly marked "unavailable" rather
 * than silently skipped. Fail-soft per query.
 */
export async function resolveSerpTop5ForKeywords(
  tenantId: string,
  keywords: readonly string[],
  opts: { maxLiveSerpPulls?: number } = {},
  depsOverride: Partial<SteaLaneDeps> = {},
): Promise<{ results: SerpTop5Result[]; livePullsUsed: number; liveCostUsd: number }> {
  const deps = { ...defaultDeps, ...depsOverride };
  const maxLiveSerpPulls = opts.maxLiveSerpPulls ?? 5;
  const results: SerpTop5Result[] = [];
  let livePullsUsed = 0;
  let liveCostUsd = 0;

  for (const query of keywords) {
    const stored = await deps.readStored(tenantId, query).catch(() => null);
    if (stored) {
      results.push(stored);
      continue;
    }
    if (livePullsUsed >= maxLiveSerpPulls) {
      results.push({ query, source: "unavailable", items: [], capturedAt: null });
      continue;
    }
    livePullsUsed += 1;
    let run;
    try {
      run = await deps.runLive(query);
    } catch (e) {
      log.warn("[serp-steal-lane] live SERP pull threw", { tenantId, query, error: e instanceof Error ? e.message : String(e) });
      results.push({ query, source: "unavailable", items: [], capturedAt: null });
      continue;
    }
    if (run.status !== "ok" && run.status !== "cache_hit") {
      results.push({ query, source: "unavailable", items: [], capturedAt: null });
      continue;
    }
    liveCostUsd += run.costUsd;
    const items = (run.snapshot?.results ?? []).slice(0, 5).map((r) => ({ rank: r.rank, domain: r.domain, url: r.url }));
    results.push({ query, source: "live_pull", items, capturedAt: run.snapshot?.fetchedAt ?? null });
  }

  return { results, livePullsUsed, liveCostUsd: Number(liveCostUsd.toFixed(4)) };
}

// ── Steal brief: same shape D2's clone-and-beat brief uses ──────────────────

export type StealBriefTeardownStatus = "torn_down" | "blocked" | "not_read";

/** Same "atomic edit brief on OUR page" shape D2's CommonalityBrief uses -
 *  structure + facts only, never copied text. */
export type StealBrief = {
  keyword: string;
  ourPage: string | null;
  ourPosition: number;
  impressions: number;
  serpSource: SerpTop5Source;
  /** The single best (first relevant, then first usable) top-5 competitor URL torn down. */
  competitorUrl: string | null;
  competitorDomain: string | null;
  teardownStatus: StealBriefTeardownStatus;
  whatWins: string | null;
  /** What the top-5 share (by term frequency across their torn-down facts)
   *  that our ranking page's own topic tokens do not already cover. */
  structureGaps: string[];
  /** The atomic edit pointer - what to change on OUR existing page, never a
   *  copy-paste instruction. Null only when nothing concrete was found. */
  editPointer: { label: string; reason: string } | null;
  /** First-person, dash-clean operator sentence. */
  summary: string;
};

const MAX_STRUCTURE_GAPS = 6;

/**
 * The competitor's own page topic tokens, MINUS pure-number noise ("519" from
 * a "519+ Names" title - a real fact found while ground-truthing this module
 * against babynama.com) and minus their own brand/domain token (the second
 * name of their root domain, e.g. "babynama" from babynama.com) - a structure
 * gap must be a TOPIC we are missing, never the competitor's own name or a
 * stray listicle count.
 */
function pageTopicTokensFrom(facts: CompetitorPageAudit["facts"], competitorDomain: string | null): string[] {
  if (!facts) return [];
  const brandToken = competitorDomain?.split(".")[0]?.toLowerCase() ?? "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...topicTokens(facts.title), ...topicTokens(facts.h1), ...topicTokens((facts.topTerms ?? []).join(" "))]) {
    const tok = t.toLowerCase();
    if (tok.length < 3 || seen.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue; // pure numbers ("519") are never a topic
    if (brandToken && tok === brandToken) continue; // never the competitor's own brand name
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/**
 * Build ONE steal brief from a beaten keyword + its resolved SERP top-5 +
 * the single best torn-down competitor page + our own page's topic tokens.
 * PURE - the caller supplies the already-fetched teardown (competitor-page-
 * audit's cache) and our own page's known topic terms. Never fabricates a
 * fact the teardown did not find, and never copies competitor text.
 */
export function buildStealBrief(input: {
  keyword: BeatenKeyword;
  serp: SerpTop5Result;
  competitorUrl: string | null;
  audit: { fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"] } | null;
  ourPageTopicTokens: readonly string[];
}): StealBrief {
  const { keyword, serp, competitorUrl, audit, ourPageTopicTokens } = input;

  const teardownStatus: StealBriefTeardownStatus =
    !competitorUrl || !audit
      ? "not_read"
      : audit.fetchStatus === "ok"
        ? "torn_down"
        : audit.fetchStatus === "blocked_robots"
          ? "blocked"
          : "not_read";

  const wins = teardownStatus === "torn_down" ? whatWins(audit!.facts) : null;
  const competitorDomainEarly = competitorUrl ? rootDomain(competitorUrl) : null;
  const theirTokens = teardownStatus === "torn_down" ? pageTopicTokensFrom(audit!.facts, competitorDomainEarly) : [];
  const ownTokenSet = new Set(ourPageTopicTokens.map((t) => t.toLowerCase()));
  const structureGaps = theirTokens.filter((t) => !ownTokenSet.has(t)).slice(0, MAX_STRUCTURE_GAPS);

  const editPointer =
    teardownStatus === "torn_down"
      ? {
          label: keyword.query,
          reason:
            structureGaps.length > 0
              ? `The top result covers ${structureGaps.slice(0, 3).join(", ")}, which our page does not mention yet.`
              : `We already cover the same ground, the gap is structure (${wins ?? "their page format"}), not topic.`,
        }
      : null;

  const competitorDomain = competitorDomainEarly;

  const positionPart = `We rank position ${Math.round(keyword.position)} for "${keyword.query}" with about ${keyword.impressions.toLocaleString("en-US")} monthly impressions`;
  const serpPart =
    serp.source === "unavailable"
      ? ", and I have not read the top 5 for this one yet."
      : competitorDomain
        ? `, and ${competitorDomain} outranks us there.`
        : ", and I found the top 5 but could not tell who leads.";
  const structurePart =
    teardownStatus === "torn_down"
      ? wins
        ? ` Their page wins on ${wins}.`
        : ` I read their page but it has little real structure to copy.`
      : teardownStatus === "blocked"
        ? ` I could not read their page, it blocks crawlers.`
        : "";
  const gapPart =
    structureGaps.length > 0
      ? ` Our page is missing ${structureGaps.slice(0, 3).join(", ")}, that is the edit.`
      : teardownStatus === "torn_down"
        ? ` We already cover this topic, the edit is structure, not new content.`
        : "";

  const summary = `${positionPart}${serpPart}${structurePart}${gapPart}`;

  return {
    keyword: keyword.query,
    ourPage: keyword.page || null,
    ourPosition: keyword.position,
    impressions: keyword.impressions,
    serpSource: serp.source,
    competitorUrl,
    competitorDomain,
    teardownStatus,
    whatWins: wins,
    structureGaps,
    editPointer,
    summary,
  };
}

/** Stable move_drafts key for one tenant+keyword pair - a re-run lands on the
 *  same row (latest wins, same read contract as displacement_check). */
export function stealBriefDraftKey(keyword: string): string {
  return `steal:${keyword.trim().toLowerCase()}`;
}

export const STEAL_BRIEF_KIND = "structured_draft" as const;

export function parseStealBrief(content: string | null | undefined): StealBrief | null {
  if (!content) return null;
  try {
    const v = JSON.parse(content) as { __kind?: string } & StealBrief;
    return v && v.__kind === "steal_brief" && typeof v.keyword === "string" ? v : null;
  } catch {
    return null;
  }
}

function serializeStealBrief(brief: StealBrief): string {
  return JSON.stringify({ __kind: "steal_brief", ...brief });
}

// ── The nightly step: bounded, fail-soft, additive ──────────────────────────

export type StealLaneRunSummary = {
  beatenKeywordsFound: number;
  storedSerpHits: number;
  livePullsUsed: number;
  liveCostUsd: number;
  briefsBuilt: number;
  teardownsTorndown: number;
  briefs: StealBrief[];
};

const MAX_KEYWORDS_PER_RUN = 10;

/**
 * Run the SERP-steal lane for one tenant: select beaten keywords from GSC,
 * resolve each one's top-5 (stored first, capped live second), tear down the
 * best top-5 page through the EXISTING competitor-page-audit cache, and
 * persist one steal brief per beaten keyword with a usable teardown. Never
 * throws - every failure degrades to an honest empty/partial summary.
 */
export async function runStealLaneForTenant(
  tenantId: string,
  opts: { maxKeywords?: number; maxLiveSerpPulls?: number; now?: () => Date } = {},
): Promise<StealLaneRunSummary> {
  const empty: StealLaneRunSummary = {
    beatenKeywordsFound: 0,
    storedSerpHits: 0,
    livePullsUsed: 0,
    liveCostUsd: 0,
    briefsBuilt: 0,
    teardownsTorndown: 0,
    briefs: [],
  };
  if (!tenantId) return empty;

  const keywords = await loadBeatenKeywordsForTenant(tenantId, { cap: opts.maxKeywords ?? MAX_KEYWORDS_PER_RUN });
  if (keywords.length === 0) return empty;

  const { results: serpResults, livePullsUsed, liveCostUsd } = await resolveSerpTop5ForKeywords(
    tenantId,
    keywords.map((k) => k.query),
    { maxLiveSerpPulls: opts.maxLiveSerpPulls },
  );
  const serpByQuery = new Map(serpResults.map((r) => [r.query, r]));
  const storedSerpHits = serpResults.filter((r) => r.source === "stored_history").length;

  const teardownCache = await getCompetitorAuditsForTenant().catch(() => new Map<string, CompetitorPageAudit>());
  const nowFn = opts.now ?? (() => new Date());
  const nowMs = nowFn().getTime();

  const existingDrafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());

  let teardownsTorndown = 0;
  const briefs: StealBrief[] = [];

  for (const keyword of keywords) {
    const serp = serpByQuery.get(keyword.query) ?? { query: keyword.query, source: "unavailable" as const, items: [], capturedAt: null };
    const ownDomain = keyword.page ? rootDomain(keyword.page) : "";
    const candidateUrl = serp.items.find((it) => rootDomain(it.domain || it.url) !== ownDomain)?.url ?? null;

    let audit: { fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"] } | null = null;
    if (candidateUrl) {
      const key = canonicalizeCitationUrl(candidateUrl) || candidateUrl;
      const cached = teardownCache.get(key);
      if (cached && cached.fetchStatus === "ok" && isTeardownFresh(cached.auditedAt, nowMs)) {
        audit = { fetchStatus: cached.fetchStatus, facts: cached.facts };
      } else {
        const fresh = await auditCompetitorPage(candidateUrl).catch(() => null);
        audit = fresh ? { fetchStatus: fresh.fetchStatus, facts: fresh.facts } : null;
      }
      if (audit?.fetchStatus === "ok") teardownsTorndown += 1;
    }

    // Our own page's topic tokens: reuse the beaten keyword itself as the
    // minimal known-topic signal (the fuller page_snapshots title/H1 join is
    // teardown-library.ts's job when it composes this for the UI - here we
    // stay $0/no-extra-I/O and let the gap check be conservative).
    const ourPageTopicTokens = topicTokens(keyword.query);

    const brief = buildStealBrief({ keyword, serp, competitorUrl: candidateUrl, audit, ourPageTopicTokens });
    briefs.push(brief);

    if (brief.teardownStatus === "torn_down" || brief.teardownStatus === "blocked") {
      const draftKey = stealBriefDraftKey(keyword.query);
      const already = existingDrafts.get(`${draftKey}::${STEAL_BRIEF_KIND}`);
      const alreadyBrief = already ? parseStealBrief(already.content) : null;
      // Only re-write when the brief actually changed (new teardown facts) -
      // avoids a no-op insert every night for a keyword whose SERP is stable.
      if (!alreadyBrief || JSON.stringify(alreadyBrief) !== JSON.stringify(brief)) {
        await saveMoveDraft(tenantId, draftKey, STEAL_BRIEF_KIND, serializeStealBrief(brief)).catch(() => false);
      }
    }
  }

  log.info("[serp-steal-lane] done", {
    tenantId,
    beatenKeywordsFound: keywords.length,
    storedSerpHits,
    livePullsUsed,
    liveCostUsd,
    teardownsTorndown,
    briefsBuilt: briefs.length,
  });

  return {
    beatenKeywordsFound: keywords.length,
    storedSerpHits,
    livePullsUsed,
    liveCostUsd,
    briefsBuilt: briefs.length,
    teardownsTorndown,
    briefs,
  };
}

/**
 * Read every persisted steal brief for a tenant - the $0 read the Research
 * hub / teardown-library.ts consumes. Fail-soft -> [].
 */
export async function loadStealBriefsForTenant(tenantId: string): Promise<StealBrief[]> {
  if (!tenantId) return [];
  try {
    const drafts = await getLatestMoveDrafts(tenantId);
    const out: StealBrief[] = [];
    for (const [key, row] of drafts) {
      if (!key.endsWith(`::${STEAL_BRIEF_KIND}`)) continue;
      const v = parseStealBrief(row.content);
      if (v) out.push(v);
    }
    return out;
  } catch (e) {
    log.warn("[serp-steal-lane] brief read threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}
