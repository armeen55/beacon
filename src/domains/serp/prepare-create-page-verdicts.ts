import "server-only";

import { log } from "@/lib/logger";
import { loadDemandGraphForTenant } from "@/domains/demand-graph/load-graph";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { runSerpQuery } from "./dataforseo-serp";
import { validateCreatePage } from "./serp-validation";
import { rootDomain } from "./serp-provider";
import type { SerpSnapshot } from "./serp-provider";
import { draftCreatePageStructured } from "@/domains/llm/structured-drafter";
import { getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
import { readAllCachedKeywordDemand } from "./dataforseo-keywords";
import { matchKeywordDemand } from "@/domains/demand/keyword-match";
import { evaluateCreatePageBriefQuality } from "@/domains/drafts/draft-quality";
import { runBulkKeywordDifficulty, runBulkDomainRanks, runBacklinksSummary } from "./dataforseo-labs";
import type { Winnability } from "./winnability";
import { checkTopicCoherence } from "@/domains/demand-graph/topic-coherence-gate";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { resolveOwner } from "@/domains/ownership/registry";
import { getBusinessConfig, hydrateBusinessConfigFromSupabase } from "@/lib/business-config";

/**
 * prepare-create-page-verdicts (2026-06-25, Phase 4-auto) - the "prepared, not a
 * chore" precompute. Instead of the operator clicking "Validate with live SERP"
 * on each New Pages card, this runs the top-N create-page candidates through
 * DataForSEO once and PERSISTS the verdict (via move_drafts, kind=serp_verdict),
 * so the board arrives "Google checked: BUILD/WAIT/SKIP" with zero clicks.
 *
 * Capped (default 25/run), cache-first (the runner serves a 14d SERP cache for
 * free), fail-soft per candidate. Dry-run/capped candidates are skipped (no
 * fake verdict persisted). Tenant-agnostic.
 *
 * Item 18 (2026-07-02): after every candidate's SERP snapshot is in, this now
 * runs THREE batched winnability reads over the whole run (never per candidate):
 *   (a) bulk_keyword_difficulty for every candidate's label, ONE call
 *   (b) bulk_ranks for every distinct winning domain across the whole batch, ONE call
 *   (c) a backlinks summary bounded to the top BACKLINKS_RUN_URL_LIMIT winning
 *       URLs (best-ranked first) plus the tenant's own top page, ONE call
 * Each read is cache-first and fail-soft (dry-run/capped/error just means that
 * candidate's verdict stays SERP-shape-only, exactly like before item 18).
 */

export type PreparedSerpVerdict = {
  verdict: "build" | "wait" | "reject";
  confidence: "high" | "medium" | "low";
  intent: string;
  contentDomainCount: number;
  marketplaceUgcCount: number;
  profoundOverlapCount: number;
  ownAlreadyRanks: boolean;
  topDomains: string[];
  reason: string;
  generatedAt: string;
  costUsd: number;
  /** Item 18: the difficulty/domain-rank/backlink arithmetic behind the verdict, when reads landed. */
  winnability?: {
    score: number;
    band: "winnable" | "hard" | "reject";
    sentence: string;
  };
};

export type PrepareSummary = {
  validated: number;
  cached: number;
  skipped: number;
  /** Structured page briefs (title/meta/opening/outline/FAQ/schema) drafted + persisted. */
  briefs: number;
  costUsd: number;
  /** LLM spend for the page briefs (separate from SERP costUsd). */
  briefCostUsd: number;
  capped: boolean;
  /** Item 18: spend from the three batched winnability reads (difficulty + domain ranks + backlinks), separate from SERP costUsd. */
  winnabilityCostUsd: number;
  /** UX0 (2026-07-02) - candidates that failed the topic-coherence quality check
   *  (an incoherent label vs its own fanouts/competitor evidence) and were skipped
   *  BEFORE spending a SERP call on them. Honest, never silent: "skipped 3 that
   *  failed my quality check". Empty on a clean run. */
  skippedQualityGate: { label: string; reason: string }[];
  /** N2 (2026-07-02) - candidates the ownership registry already resolves to an
   *  owned page (Google ranks, or a SERP-overlap intent cluster) and were skipped
   *  BEFORE spending a SERP call or an LLM brief on them - the registry's
   *  enforcement at the "spend money treating this as new" choke point. Empty
   *  when the registry has no opinion on any candidate this run. */
  skippedOwnedByRegistry: { label: string; owner: string; basis: string }[];
};

/** Item 18: bound the backlinks read to a small, cheap set of URLs per run (not per candidate). */
const BACKLINKS_RUN_URL_LIMIT = 3;

function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    const d = rootDomain(p.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/**
 * Item 18: the create-page candidate does not exist yet, so there is no real
 * per-page backlink count for it. The honest stand-in is the tenant's own
 * strongest owned page (highest GSC impressions) - the best available proxy for
 * "how many linking domains does a typical page on this site have". Absent
 * data -> "" (the backlinks read is then skipped for the own side, never faked).
 */
function deriveOwnReferencePage(pageNodes: ReadonlyArray<{ url: string; isOwned: boolean; gscImpressions: number }>): string {
  const owned = pageNodes.filter((p) => p.isOwned && p.url);
  return owned.sort((a, b) => b.gscImpressions - a.gscImpressions)[0]?.url ?? "";
}

export async function prepareCreatePageVerdicts(
  tenantId: string,
  opts: {
    maxValidations?: number;
    now?: () => Date;
    /** Only validate create-page candidates with a strong/exact cached keyword-volume
     *  match, ranked by volume (the "spend SERP on volume-backed topics" path). */
    onlyKeywordMatched?: boolean;
    /** SERP verdict only - skip the (separately-budgeted) LLM brief generation. */
    skipBriefs?: boolean;
    /** Skip candidates that already carry a fresh (<14d) serp_verdict. */
    skipFreshVerdict?: boolean;
    /** Hard cap on how many LLM page briefs to generate this run (bounds spend). */
    maxBriefs?: number;
    /** Cache-first: don't regenerate a brief that already exists AND passes the gate. */
    skipExistingBrief?: boolean;
  } = {},
): Promise<PrepareSummary> {
  // This path creates the briefs rendered on the New Pages board. Resolve the
  // tenant's durable config before drafting so source allowlists do not fall
  // back to the process-local placeholder on Vercel.
  const bizConfig =
    (await hydrateBusinessConfigFromSupabase(tenantId).catch(() => null)) ??
    getBusinessConfig(tenantId);
  const max = opts.maxValidations ?? 25;
  const now = opts.now ?? (() => new Date());
  const summary: PrepareSummary = {
    validated: 0,
    cached: 0,
    skipped: 0,
    briefs: 0,
    costUsd: 0,
    briefCostUsd: 0,
    capped: false,
    winnabilityCostUsd: 0,
    skippedQualityGate: [],
    skippedOwnedByRegistry: [],
  };

  let graph;
  try {
    graph = (await loadDemandGraphForTenant(tenantId)).graph;
  } catch (e) {
    log.warn("[prepare-verdicts] graph load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return summary;
  }

  const ownDomain = deriveOwnDomain(graph.pageNodes);
  const ownReferencePage = deriveOwnReferencePage(graph.pageNodes);
  let createMoves = graph.moves.filter((m) => m.gap === "create_page");

  // UX0 (2026-07-02) - Prepare-all safety: never spend a SERP call (or an LLM brief)
  // on a candidate whose own label disagrees with its own evidence (fanout seeds +
  // competitor URLs). The upstream demand-graph coherence gate already suppresses
  // the worst offenders before they become Moves, but this is the direct, honest
  // "skip it and say why" check the bulk action itself owns.
  const qualityChecked = createMoves.map((m) => ({
    m,
    verdict: checkTopicCoherence(m.label, [
      ...(m.fanoutSeeds ?? []).map((q) => ({ id: q, text: q })),
      ...(m.competitorUrls ?? []).map((u) => ({ id: u, text: u })),
    ]),
  }));
  for (const { m, verdict } of qualityChecked) {
    if (verdict.suppressCandidate) {
      summary.skippedQualityGate.push({ label: m.label, reason: verdict.reason });
    }
  }
  createMoves = qualityChecked.filter(({ verdict }) => !verdict.suppressCandidate).map(({ m }) => m);
  if (summary.skippedQualityGate.length > 0) {
    log.info("[prepare-verdicts] skipped candidates that failed the quality check", {
      tenantId,
      skipped: summary.skippedQualityGate.map((s) => s.label),
    });
  }

  // N2 (2026-07-02) - ownership registry enforcement: never spend a live SERP call or
  // an LLM brief pitching a candidate as "new" when the registry already resolves its
  // topic to an owned page (Google ranks, or a SERP-overlap intent cluster). The
  // upstream demand-graph gate (`gateCreatePageOwnershipWithRegistry` in load-graph.ts)
  // already reclassifies most of these away from `create_page` before this function
  // ever sees them; this is the SAME rule applied a second, independent time at the
  // money-spending choke point itself, so a stale/failed upstream registry read can
  // never let a registry-owned topic slip through and get a paid SERP call + LLM brief.
  const registry = await loadOwnershipRegistryForTenant(tenantId).catch(() => null);
  if (registry && registry.byQuery.size > 0) {
    const stillCreate: typeof createMoves = [];
    for (const m of createMoves) {
      const entry = resolveOwner(registry, m.label);
      if (entry && entry.owner) {
        summary.skippedOwnedByRegistry.push({ label: m.label, owner: entry.owner, basis: entry.basis });
      } else {
        stillCreate.push(m);
      }
    }
    createMoves = stillCreate;
    if (summary.skippedOwnedByRegistry.length > 0) {
      log.info("[prepare-verdicts] skipped candidates the ownership registry already resolves to an owned page", {
        tenantId,
        skipped: summary.skippedOwnedByRegistry.map((s) => `${s.label} -> ${s.owner} (${s.basis})`),
      });
    }
  }

  // Optional: skip candidates that already have a fresh serp_verdict (re-validate only
  // missing/stale) and/or restrict to strong/exact keyword-volume matches, volume-first.
  if (opts.onlyKeywordMatched || opts.skipFreshVerdict) {
    const FRESH_MS = 14 * 24 * 60 * 60 * 1000;
    const nowMs = now().getTime();
    const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());
    const keywords = opts.onlyKeywordMatched ? await readAllCachedKeywordDemand().catch(() => []) : [];
    const isFresh = (demandKey: string): boolean => {
      const raw = drafts.get(`${demandKey}::serp_verdict`)?.content;
      if (!raw) return false;
      try {
        const v = JSON.parse(raw) as PreparedSerpVerdict;
        return !!v.generatedAt && nowMs - Date.parse(v.generatedAt) < FRESH_MS;
      } catch {
        return false;
      }
    };
    const scored = createMoves
      .map((m) => ({
        m,
        match: opts.onlyKeywordMatched
          ? matchKeywordDemand(m.label, m.aeoEvidence?.prompts?.[0] ?? null, keywords)
          : null,
      }))
      .filter(({ m }) => !(opts.skipFreshVerdict && isFresh(m.demandKey)))
      .filter(({ match }) => !opts.onlyKeywordMatched || match!.confidence === "strong" || match!.confidence === "exact")
      .sort((a, b) => (b.match?.searchVolume ?? 0) - (a.match?.searchVolume ?? 0) || b.m.components.demand - a.m.components.demand);
    createMoves = scored.map((s) => s.m);
  } else {
    createMoves = createMoves.sort((a, b) => b.components.demand - a.components.demand);
  }
  const creates = createMoves.slice(0, max);

  // For cache-first brief skipping: a map of existing drafts (only when requested).
  const briefDrafts = opts.skipExistingBrief ? await getLatestMoveDrafts(tenantId).catch(() => new Map()) : null;
  const hasPassingBrief = (demandKey: string, hasVerdict: boolean): boolean => {
    const raw = briefDrafts?.get(`${demandKey}::create_page_brief`)?.content;
    if (!raw) return false;
    try {
      const b = JSON.parse(raw);
      return evaluateCreatePageBriefQuality({
        title: b.proposedTitle,
        meta: b.metaDescription,
        opening: b.openingAnswer,
        outline: b.outline,
        faqQuestions: b.faqQuestions,
        schemaTypes: b.schemaTypes,
        hasSerpVerdict: hasVerdict,
        authoritativeSourceDomains: bizConfig.authoritativeSourceDomains,
      }).copyAllowed;
    } catch {
      return false;
    }
  };
  let briefedCount = 0;

  // ── PASS 1: fetch every candidate's live SERP snapshot (existing behavior,
  // unchanged). Collect the winning-domain union along the way so PASS 1.5 can
  // batch the difficulty + domain-rank reads in exactly two calls total. ──
  type PendingCandidate = { m: (typeof creates)[number]; profoundDomains: string[]; snapshot: SerpSnapshot | null; costUsd: number };
  const pending: PendingCandidate[] = [];
  const allWinningDomains = new Set<string>();

  for (const m of creates) {
    const profoundDomains = [...new Set(m.competitorUrls.map((u) => rootDomain(u)).filter(Boolean))];
    let r;
    try {
      r = await runSerpQuery(m.label, { depth: 10 });
    } catch {
      summary.skipped += 1;
      continue;
    }
    // Only persist a verdict from a REAL SERP read (ok or cache hit), never a
    // dry-run/capped/disabled placeholder.
    if (r.status !== "ok" && r.status !== "cache_hit") {
      summary.skipped += 1;
      if (r.status === "capped") summary.capped = true;
      continue;
    }
    if (r.status === "cache_hit") summary.cached += 1;
    else summary.validated += 1;
    summary.costUsd += r.costUsd;

    for (const res of r.snapshot?.results.slice(0, 10) ?? []) {
      if (res.domain) allWinningDomains.add(res.domain);
    }
    pending.push({ m, profoundDomains, snapshot: r.snapshot, costUsd: r.costUsd });
  }

  // ── PASS 1.5: the three batched winnability reads for the WHOLE run (item 18).
  // Fail-soft: a dry-run/capped/error read just means the arithmetic layer sits
  // out for this run and every verdict below falls back to SERP-shape-only,
  // exactly like before item 18. ──
  const difficultyByKeyword = new Map<string, number | null>();
  const rankByDomain = new Map<string, number | null>();
  const backlinksByUrl = new Map<string, { referringDomains: number | null; backlinks: number | null }>();

  if (pending.length > 0) {
    const keywords = [...new Set(pending.map((p) => p.m.label))];
    const diffRes = await runBulkKeywordDifficulty(keywords).catch(() => null);
    if (diffRes) {
      summary.winnabilityCostUsd += diffRes.costUsd;
      for (const row of diffRes.rows) difficultyByKeyword.set(row.keyword.toLowerCase(), row.difficulty);
    }

    if (allWinningDomains.size > 0) {
      const ranksRes = await runBulkDomainRanks([...allWinningDomains]).catch(() => null);
      if (ranksRes) {
        summary.winnabilityCostUsd += ranksRes.costUsd;
        for (const row of ranksRes.rows) rankByDomain.set(row.domain, row.rank);
      }
    }

    // Bound the backlinks read to the top BACKLINKS_RUN_URL_LIMIT winning URLs
    // (rank 1 first, deduped) across the WHOLE run, plus the tenant's own
    // reference page - one small, cheap call, never one per candidate.
    const winningUrlsByRank = pending
      .flatMap((p) => p.snapshot?.results ?? [])
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.url)
      .filter(Boolean);
    const topWinningUrls = [...new Set(winningUrlsByRank)].slice(0, BACKLINKS_RUN_URL_LIMIT);
    const backlinkTargets = ownReferencePage ? [...topWinningUrls, ownReferencePage] : topWinningUrls;
    if (backlinkTargets.length > 0) {
      const backlinksRes = await runBacklinksSummary(backlinkTargets).catch(() => null);
      if (backlinksRes) {
        summary.winnabilityCostUsd += backlinksRes.costUsd;
        for (const row of backlinksRes.rows) backlinksByUrl.set(row.url, { referringDomains: row.referringDomains, backlinks: row.backlinks });
      }
    }
  }

  const ownBacklinks = ownReferencePage ? backlinksByUrl.get(ownReferencePage) ?? null : null;

  // ── PASS 2: validate + persist, now with the arithmetic layered on top of the
  // SERP-shape verdict (validateCreatePage only ever downgrades on winnability;
  // see serp-validation.ts). ──
  for (const { m, profoundDomains, snapshot, costUsd } of pending) {
    const difficulty = difficultyByKeyword.get(m.label.toLowerCase()) ?? null;
    const domainRanks: Array<number | null> = snapshot
      ? snapshot.results.slice(0, 10).map((res) => rankByDomain.get(res.domain) ?? null)
      : [];
    const winningUrls = snapshot ? [...snapshot.results].sort((a, b) => a.rank - b.rank).slice(0, BACKLINKS_RUN_URL_LIMIT).map((r) => r.url) : [];
    const theirBacklinkCounts = winningUrls.map((u) => backlinksByUrl.get(u)?.referringDomains ?? null).filter((n): n is number => typeof n === "number");
    const theirAvgReferringDomains = theirBacklinkCounts.length > 0 ? theirBacklinkCounts.reduce((s, n) => s + n, 0) / theirBacklinkCounts.length : null;
    const hasAnyWinnabilityRead = difficulty != null || domainRanks.some((r) => r != null) || (theirAvgReferringDomains != null && ownBacklinks?.referringDomains != null);

    const v = validateCreatePage({
      snapshot,
      ownDomain,
      profoundDomains,
      searchVolume: null,
      winnability: hasAnyWinnabilityRead
        ? {
            difficulty,
            domainRanks,
            backlinkGap: { theirAvgReferringDomains, ownReferringDomains: ownBacklinks?.referringDomains ?? null },
          }
        : undefined,
    });
    const winnability: Winnability | undefined = v.winnability;
    const compact: PreparedSerpVerdict = {
      verdict: v.verdict,
      confidence: v.confidence,
      intent: v.intent,
      contentDomainCount: v.contentDomainCount,
      marketplaceUgcCount: v.marketplaceUgcCount,
      profoundOverlapCount: v.profoundOverlapCount,
      ownAlreadyRanks: v.ownAlreadyRanks,
      topDomains: v.topDomains.slice(0, 5),
      // Unchanged when winnability did not run (reasons[0], exactly as before item
      // 18). When it did run, its sentence is the LAST reason pushed and carries
      // the concrete numbers, so it leads the persisted, single-line "reason".
      reason: (winnability ? v.reasons[v.reasons.length - 1] : v.reasons[0]) ?? "",
      generatedAt: now().toISOString(),
      costUsd,
      ...(winnability ? { winnability: { score: winnability.score, band: winnability.band, sentence: winnability.sentence } } : {}),
    };
    await saveMoveDraft(tenantId, m.demandKey, "serp_verdict", JSON.stringify(compact)).catch(() => false);

    // Also draft the full structured page brief (title/meta/opening/outline/FAQ/
    // schema) for BUILD/WAIT pages, so the New Pages card arrives WRITTEN, not just
    // verdicted. SKIP pages get no brief (don't spend LLM on a page we advise
    // against). Best-effort + budget-gated inside the drafter; fail-soft.
    const briefBudgetLeft = opts.maxBriefs == null || briefedCount < opts.maxBriefs;
    const alreadyBriefed = opts.skipExistingBrief && hasPassingBrief(m.demandKey, true);
    if (v.verdict !== "reject" && !opts.skipBriefs && briefBudgetLeft && !alreadyBriefed) {
      try {
        const brief = await draftCreatePageStructured({
          query: m.label,
          pageLabel: m.demandKey,
          competitorPages: [...new Set(m.competitorUrls)].slice(0, 6),
          fanoutQueries: m.aeoEvidence?.fanoutQueries ?? [],
          evidenceHints: [
            v.profoundOverlapCount > 0 ? "Google and AI cite the same competitors for this topic" : "",
            `${v.contentDomainCount} of 10 SERP results are beatable content pages`,
          ].filter(Boolean),
          // SERP winners are not automatically authorities, but this is the
          // broadest exact-page pool already paid for. The drafter chooses a
          // candidate and the existing fetch/authority/entailment gate still
          // rejects anything weak or irrelevant.
          referenceCandidates: [...new Set([
            ...(snapshot?.results ?? []).map((result) => result.url),
            ...m.competitorUrls,
          ])].slice(0, 12),
        }, {
          authoritativeSourceDomains: bizConfig.authoritativeSourceDomains,
        });
        if (brief.status === "drafted") {
          summary.briefs += 1;
          briefedCount += 1;
          summary.briefCostUsd += brief.costUsd;
          await saveMoveDraft(tenantId, m.demandKey, "create_page_brief", JSON.stringify(brief.value)).catch(() => false);
        } else if (brief.status === "validation_failed") {
          summary.briefCostUsd += brief.costUsd;
        }
      } catch {
        /* brief is best-effort; the verdict already persisted */
      }
    }
  }

  log.info("[prepare-verdicts] done", { tenantId, ...summary });
  return summary;
}

/** Parse a persisted serp_verdict draft back into a verdict (null on bad JSON). */
export function parsePreparedVerdict(content: string | null | undefined): PreparedSerpVerdict | null {
  if (!content) return null;
  try {
    const o = JSON.parse(content) as PreparedSerpVerdict;
    return o && typeof o.verdict === "string" ? o : null;
  } catch {
    return null;
  }
}
