import "server-only";
import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { getCompetitorAuditsForTenant, whatWins } from "@/domains/demand-graph/competitor-page-audit";
import { getLatestMoveDrafts, type MoveDraftRow } from "@/domains/demand-graph/move-draft-store";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { parsePreparedVerdict, type PreparedSerpVerdict } from "@/domains/serp/prepare-create-page-verdicts";
import { parsePreparedPack } from "@/domains/demand-graph/prepared-move-pack";
import type { CreatePageBrief } from "@/domains/llm/schemas";
import { evaluateCreatePageBriefQuality, evaluateDraftQuality, type DraftQualityResult } from "@/domains/drafts/draft-quality";
import { getBusinessConfig } from "@/lib/business-config";
import type { SourceRef } from "@/domains/llm/schemas";
import { readAllCachedKeywordDemand, type KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readKeywordGapResults, type StoredKeywordGaps } from "@/domains/serp/keyword-gap-store";
import { readWikiGapResults, type StoredWikiGaps } from "@/domains/wiki-gap/wiki-gap-store";
import { matchKeywordDemand } from "@/domains/demand/keyword-match";
import { cleanTopicLabel, isJunkTopic } from "@/domains/demand-graph/clean-topic-label";
import { deserializeFullPageDraft, reassembleFromPersisted, type AssembledDraftPage } from "@/domains/llm/draft-full-page";
import {
  clusterNewPageCandidates,
  applyNewPageFloor,
  rankNewPageClusters,
  deriveWinnability,
  deriveNewPageSignal,
  detectTrendSpike,
  detectSeasonalWindow,
  type NewPageSignal,
  type NewPageClusterCandidate,
} from "@/domains/demand-graph/intent-clustering";
import { seedQuestionsForTopic, type UniverseQuestionRow } from "@/domains/research/question-universe";
import { loadQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";
import { loadOwnedCoverageInputs } from "@/domains/demand-graph/owned-coverage-loader";
import {
  detectOwnedCoverageForCard,
  acknowledgeSentence,
  type OwnedCoverageBasis,
  type OwnedCoverageInput,
} from "@/domains/demand-graph/owned-coverage";
import { log } from "@/lib/logger";

/**
 * today-newpages-data (2026-06-24) — the loader behind the "New Pages to Build"
 * board: the demand-graph engine's create_page Moves (topics competitors own that
 * the tenant has no page for). These intentionally never enter the EDIT queue
 * (they're new pages, not edits) — this surface is their home. Read-only,
 * tenant-agnostic; empty → the section self-hides. Demand is an AI-attention proxy
 * (citation breadth × volume), NOT measured search volume, so it's shown as a
 * concrete "N competitor pages cited" + an honest interest tier, never a fake
 * search-volume number.
 */

export type NewPageOpportunity = {
  id: string;
  topic: string;
  competitorCount: number;
  topCompetitor: string | null;
  /** What the cited competitor page has (deterministic teardown), when audited. */
  whatWins: string | null;
  /** Real DataForSEO monthly search volume from the best cached keyword match (else
   *  null — never a fuzzy guess). Grounds the demand beyond the AI-attention proxy. */
  searchVolume: number | null;
  /** The matched cached keyword + how confident the topic↔keyword map is (2026-06-28
   *  deterministic matcher: exact/strong shown plainly, weak shown cautiously). Null
   *  when no DataForSEO keyword matched this topic. */
  keywordMatch?: { keyword: string; volume: number | null; confidence: "exact" | "strong" | "weak" } | null;
  /** Canonicalization (2026-06-29) — sibling topics this canonical card absorbed (the
   *  "Also covers: …" line), so the board shows ONE card per real opportunity. */
  alsoCovers?: string[];
  /** True when the displayed brief was inherited from a high-confidence sibling topic
   *  (the canonical had no passing brief of its own). */
  briefFromRelated?: boolean;
  /** D-33 (operator spec 2026-07-09) - Rising / Seasonal / Stable, derived from real
   *  trend evidence, each carrying its own evidence line. Replaced the meaningless
   *  Hot / Warm / Emerging tier. */
  signal: NewPageSignal;
  /** D-27 (operator spec 2026-07-09) - DEDUPLICATED demand for a merged cluster (MAX
   *  variant volume + 30% of the rest), shown on the "Also covers" line. null when this
   *  card absorbed no variants (nothing to deduplicate). */
  clusterVolume?: number | null;
  /** D-28 (operator spec 2026-07-09) - set only when the cluster is under the 50/mo
   *  floor but kept on a strategic signal; the plain reason to show on the card. */
  keptUnderFloorReason?: string | null;
  score: number;
  /** Previously-generated + persisted AI opening (move_drafts), so it survives reload. */
  savedOpening: string | null;
  /** Competitor domains AI cites for this topic — fed to the live-SERP validation
   *  as the "does Google rank the same competitors?" overlap check. */
  competitorDomains: string[];
  /** Precomputed DataForSEO verdict (from "Prepare top N"), so the card arrives
   *  "Google checked" with no operator click. null until prepared. */
  preparedVerdict: PreparedSerpVerdict | null;
  /** Full structured page brief from "Prepare top 10" (create_page_brief) — title,
   *  meta, opening answer, H2 outline, FAQ, schema. Present once the move is prepared,
   *  so the card arrives with the page already written (no operator click). */
  preparedBrief: {
    title: string;
    meta: string;
    opening: string;
    outline: string[];
    faqQuestions: string[];
    schemaTypes: string[];
    /** W5 (2026-07-09, J-69), the brief's own cited sources (SourceRef[]),
     *  when the drafter attached any. [] = none yet, never a fabricated pack.
     *  Replaces the card's old competitor-domain "source pack" proxy. */
    sources: import("@/domains/llm/schemas").SourceRef[];
  } | null;
  /** Deterministic quality verdict for the prepared brief — drives honest readiness
   *  (copy hidden + reason shown for generic/thin/off-topic briefs). null = no brief. */
  briefQuality: DraftQualityResult | null;
  /** Quality verdict for the saved "Draft the opening" answer block (the generic
   *  "A gift is…" failure mode lives here). null when no opening drafted. */
  openingQuality: DraftQualityResult | null;
  /** Profound AEO receipt — present ONLY when the underlying Move already carries
   *  strong cached `aeoEvidence` (confidence ≠ low AND ≥1 cited competitor). Lets
   *  the card say "AI is already asked this and cites competitors", not just "a
   *  keyword idea". Read from the durable cached evidence on the Move — NO live
   *  Profound call, NO fresh matching here. Absent → no badge. */
  aeoReceipt: {
    topPrompt: string;
    fanoutCount: number;
    citedDomains: string[];
    ownAbsent: boolean;
    /** Cached evidence the AEO-brief drafter needs (NO live read at draft time). */
    fanoutQueries: string[];
    competitorPages: string[];
    ownCitedUrls: string[];
  } | null;
  /** Competitor keyword gap named evidence (2026-07-02, item 16) - present only on
   *  cards sourced from the persisted gap engine ("X ranks 3 on Google for this,
   *  about 1,900 searches a month"). Undefined on graph-sourced cards. */
  gapEvidence?: string | null;
  /** Beat-Wikipedia evidence (2026-07-02, item 23) - present only on cards sourced
   *  from the persisted wiki-gap engine ("Wikipedia's article on this is 180 words
   *  and was last touched in 2019..."). Undefined on other cards. */
  wikiGapEvidence?: string | null;
  /** BEACON 500 item 55 - a previously-drafted + persisted full page (paste-ready
   *  sections + sources appendix + markdown), re-assembled from move_drafts
   *  (kind=full_page_draft) against the current preparedBrief. null until the
   *  operator clicks "Draft the full page". Only ever set when preparedBrief
   *  exists (the full-page walk drafts THIS brief's outline). */
  fullPageDraft: import("@/domains/llm/draft-full-page").AssembledDraftPage | null;
  /** N5 (2026-07-03) - the information-gain verdict attached by the pipeline's
   *  gate: what this page would ADD that the cited winners do not already say,
   *  as one plain sentence. null when unchecked (no brief or no teardown
   *  evidence yet - never a fabricated verdict). */
  infoGain?: { verdict: string; sentence: string } | null;
  /** N30 (2026-07-03) - the top demand-ranked universe questions for this
   *  topic that nothing of ours answers yet (max 3). Absent when the universe
   *  is empty or has no relevant uncovered question - the brief and the
   *  opening drafter both consume these. */
  universeQuestions?: string[];
  /** Owned-coverage verdict (2026-07-11) - set when an owned page already targets
   *  this cluster (GSC serving at ANY position, or a title/H1/slug content match),
   *  so the card must stop pitching a brand new page. "watching" demotes the card
   *  and prefers the owned page; "acknowledge" keeps a genuinely distinct create
   *  card but names the owned page it must not repeat. Absent = a real gap. */
  ownedCoverage?: {
    state: "watching" | "acknowledge";
    ownedUrl: string;
    ownedPath: string;
    basis: OwnedCoverageBasis;
    /** First-person sentence, safe to render (watching sentence or acknowledgment). */
    sentence: string;
    /** First-person detail explaining why it counts as covered. */
    detail: string;
  } | null;
};

export type NewPagesData = {
  opportunities: NewPageOpportunity[];
  totalCandidates: number;
  /** The tenant's own domain (so the SERP validator can detect "you already rank"). */
  ownDomain: string;
};

function domainOf(url: string): string | null {
  if (!url) return null;
  // Competitor URLs from the citation graph are often scheme-less
  // ("theknot.com/content/persian-wedding") — new URL() throws on those, which
  // was silently dropping the competitor's name from every New Page card.
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    return new URL(withScheme).hostname.replace(/^www\./, "");
  } catch {
    // Last-ditch: take the host token before the first slash.
    const host = url.replace(/^https?:\/\//i, "").split("/")[0]?.replace(/^www\./, "");
    return host && host.includes(".") ? host : null;
  }
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The tenant's own domain = the most common hostname across its owned pages. */
function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    const d = domainOf(p.url);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

/** Fail-fast guard so the heavy demand-graph compute can never hang the cockpit
 *  (the /today statement-timeout class) — on timeout the board self-hides. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** D-33 (operator spec 2026-07-09) - derive Rising / Seasonal / Stable for a card from
 *  the matched keyword's real 12-month DataForSEO trend. No match (or no trend rows) =
 *  Stable, honestly. `nowMonth` is 1-12 (injected so the seasonal window is honest and
 *  the function stays deterministic per call). */
function signalForKeyword(
  matchedKeyword: string | null,
  kwDemandRows: readonly KeywordDemand[],
  nowMonth: number,
): NewPageSignal {
  if (!matchedKeyword) return { kind: "stable", label: "Stable", evidence: null };
  const row = kwDemandRows.find((r) => r.keyword === matchedKeyword);
  const monthly = row?.monthlySearches ?? null;
  return deriveNewPageSignal({
    trend: detectTrendSpike(monthly),
    seasonal: detectSeasonalWindow(monthly, nowMonth),
  });
}

/** Tenant-explicit builder — shared by the request-cached loader AND the nightly
 *  precompute (which has no request context to derive the tenant from). */
export async function buildNewPagesData(tenantId: string): Promise<NewPagesData> {
  const nowMonth = new Date().getMonth() + 1;
  // W5 P1-3/P1-4 (2026-07-09): this tenant's source-authority allowlist +
  // first-mention rule, resolved ONCE, so the brief + opening quality gates see
  // this tenant's config (never another tenant's). Unset = byte-identical gate.
  const bizConfig = getBusinessConfig(tenantId);
  const authoritativeSourceDomains = bizConfig.authoritativeSourceDomains;
  const firstMentionConfig = bizConfig.firstMention ?? null;
  let moves;
  let audits: Awaited<ReturnType<typeof getCompetitorAuditsForTenant>> = new Map();
  let savedDrafts = new Map<string, MoveDraftRow>();
  let ownDomain = "";
  let ownedUrls: string[] = [];
  let kwDemandRows: KeywordDemand[] = [];
  let storedGaps: StoredKeywordGaps | null = null;
  let storedWikiGaps: StoredWikiGaps | null = null;
  try {
    const [graphRes, auditRes, draftRes, kwDemand, gapRes, wikiGapRes] = await Promise.all([
      withTimeout<Awaited<ReturnType<typeof loadDemandGraphForTenantCached>> | null>(
        loadDemandGraphForTenantCached(tenantId),
        // Was 8s — too tight for a cold graph, which made the whole New Pages board
        // silently vanish on first load. The graph is cached (the cockpit builds it
        // first), so this only guards a genuine stall now. Don't disappear.
        30000,
        null,
      ),
      getCompetitorAuditsForTenant().catch(() => new Map()),
      // Persisted AI openings (degrade-safe: empty map if the table isn't migrated).
      withTimeout(getLatestMoveDrafts(tenantId), 4000, new Map<string, MoveDraftRow>()),
      // Connectedness (2026-06-28) — real DataForSEO search volume from the cached
      // keyword-demand store (the same cache that powers /changes). Replaces the
      // permanently-null searchVolume left after SEMrush was removed. Degrade-safe.
      withTimeout(readAllCachedKeywordDemand(), 4000, [] as Awaited<ReturnType<typeof readAllCachedKeywordDemand>>),
      // Competitor keyword gap engine (2026-07-02, item 16) — the persisted gap
      // run ("what else the winners rank for"), read at $0. Degrade-safe.
      withTimeout(readKeywordGapResults(tenantId), 4000, null as StoredKeywordGaps | null),
      // Beat-Wikipedia finder (2026-07-02, item 23) — the persisted wiki-gap run
      // ("Wikipedia's article on this is thin/stale, you can be the better source"),
      // read at $0. Degrade-safe.
      withTimeout(readWikiGapResults(tenantId), 4000, null as StoredWikiGaps | null),
    ]);
    kwDemandRows = kwDemand;
    storedGaps = gapRes;
    storedWikiGaps = wikiGapRes;
    if (!graphRes) return { opportunities: [], totalCandidates: 0, ownDomain: "" };
    moves = graphRes.graph.moves;
    ownDomain = deriveOwnDomain(graphRes.graph.pageNodes);
    ownedUrls = graphRes.graph.pageNodes.filter((p) => p.isOwned && p.url).map((p) => p.url);
    audits = auditRes;
    savedDrafts = draftRes;
  } catch {
    return { opportunities: [], totalCandidates: 0, ownDomain: "" };
  }

  // Find a teardown audit by URL so a create_page opportunity can show what the
  // cited competitor page actually has (when we've torn it down).
  const canonLower = (u: string) => (canonicalizeCitationUrl(u) ?? u).toLowerCase();
  const findAudit = (url: string) => {
    const target = canonLower(url);
    for (const a of audits.values()) if (canonLower(a.url) === target) return a;
    return undefined;
  };

  const createMoves = moves
    .filter((m) => m.gap === "create_page")
    // New Pages quality gate (2026-06-28): drop scraped news/security fragments,
    // slug garbage, and too-generic one-word topics before they reach the board.
    .filter((m) => !isJunkTopic(m.label));

  // Match each candidate to cached DataForSEO keyword volume (deterministic, $0) +
  // read its SERP verdict, then RANK by demand with a bounded +15% lift when the page
  // is BUILD-validated AND has a strong/exact keyword match (operator: BUILD + strong
  // demand rises; WAIT/SKIP + weak are NOT boosted — mirrors the ±15% learned prior).
  const enriched = createMoves
    .map((m) => {
      const kwMatch = matchKeywordDemand(m.label, m.aeoEvidence?.prompts?.[0] ?? null, kwDemandRows);
      const verdict = parsePreparedVerdict(savedDrafts.get(`${m.demandKey}::serp_verdict`)?.content);
      const strong = kwMatch.confidence === "exact" || kwMatch.confidence === "strong";
      const boost = verdict?.verdict === "build" && strong ? 1.15 : 1;
      return { m, kwMatch, verdict, sortKey: m.components.demand * boost };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  // Canonicalization now happens UPSTREAM (2026-06-29): collapseCreatePageSiblings runs
  // as a load-graph post-pass, so `createMoves` already arrive de-duplicated — ONE
  // canonical move per opportunity, each carrying `canonicalGroup` (absorbed sibling
  // labels + an inheritable sibling brief). The board just reads that metadata; no
  // board-side grouping. (If the upstream pass fails-soft, siblings reappear as separate
  // cards with empty alsoCovers — graceful degradation, never a crash.)

  // Tier by rank within this tenant's own create-page set (relative, honest —
  // the underlying number is a proxy, so we bucket rather than print it).
  const opportunities: NewPageOpportunity[] = enriched
    .slice(0, 9)
    .map(({ m, kwMatch, verdict }) => {
      const meta = m.canonicalGroup;
      const briefSourceKey = meta?.inheritBriefFrom ?? m.demandKey;
    const topUrl = m.competitorUrls[0] ?? null;
    const audit = topUrl ? findAudit(topUrl) : undefined;
    const ww = audit && audit.fetchStatus === "ok" && audit.facts ? whatWins(audit.facts) : null;
    // AEO receipt: read the Move's ALREADY-ATTACHED cached evidence (no live call,
    // no fresh matching). Eligible only when confident AND a competitor is cited.
    const e = m.aeoEvidence;
    const aeoReceipt =
      e && e.confidence !== "low" && e.topCitedDomains.length > 0 && (e.prompts[0] ?? "").length > 0
        ? {
            topPrompt: e.prompts[0]!,
            fanoutCount: e.fanoutQueries.length,
            citedDomains: e.topCitedDomains.slice(0, 3).map((d) => d.hostname),
            ownAbsent: e.ownCitationCount === 0,
            fanoutQueries: e.fanoutQueries.slice(0, 12),
            competitorPages: e.topCitedPages.filter((p) => !p.isOwned).map((p) => p.url).slice(0, 10),
            ownCitedUrls: e.topCitedPages.filter((p) => p.isOwned).map((p) => p.url).slice(0, 10),
          }
        : null;
    // Full structured page brief from "Prepare" (create_page_brief), if prepared.
    // Primary: the standalone brief the New Pages prepare persists; fallback: the
    // worklist prepare's prepared_pack (if a create_page move ever ranks top-N there).
    // Read the brief from the canonical's OWN key, or — when it has none — inherit a
    // high-confidence sibling's passing brief (briefSourceKey).
    let briefVal: CreatePageBrief | undefined;
    const briefRaw = savedDrafts.get(`${briefSourceKey}::create_page_brief`)?.content;
    if (briefRaw) {
      try {
        briefVal = JSON.parse(briefRaw) as CreatePageBrief;
      } catch {
        /* ignore malformed */
      }
    }
    if (!briefVal) {
      const sd = parsePreparedPack(savedDrafts.get(`${briefSourceKey}::prepared_pack`)?.content)?.structuredDraft;
      if (sd && sd.kind === "create_page_brief") briefVal = sd.value as CreatePageBrief | undefined;
    }
    const briefFromRelated = briefSourceKey !== m.demandKey && !!briefVal;
    const preparedBrief =
      briefVal && briefVal.proposedTitle
        ? {
            title: briefVal.proposedTitle,
            meta: briefVal.metaDescription,
            opening: briefVal.openingAnswer,
            outline: Array.isArray(briefVal.outline) ? briefVal.outline.slice(0, 16) : [],
            faqQuestions: Array.isArray(briefVal.faqQuestions) ? briefVal.faqQuestions.slice(0, 8) : [],
            schemaTypes: Array.isArray(briefVal.schemaTypes) ? briefVal.schemaTypes.slice(0, 8) : [],
            // W5 (J-69), real cited sources, when the drafter attached any.
            sources: Array.isArray(briefVal.sources) ? briefVal.sources.slice(0, 6) : [],
          }
        : null;
    // Deterministic quality verdict (only when a brief exists). hasSerpVerdict is true
    // when DataForSEO has been run for this topic (verdict persisted alongside).
    const briefQuality = briefVal
      ? evaluateCreatePageBriefQuality({
          title: briefVal.proposedTitle,
          meta: briefVal.metaDescription,
          opening: briefVal.openingAnswer,
          outline: briefVal.outline,
          faqQuestions: briefVal.faqQuestions,
          schemaTypes: briefVal.schemaTypes,
          hasSerpVerdict: !!savedDrafts.get(`${briefSourceKey}::serp_verdict`),
          // W5 P1-4: the brief's OWN cited sources drive its openingAnswer gate.
          sources: Array.isArray(briefVal.sources) ? briefVal.sources : undefined,
          authoritativeSourceDomains,
        })
      : null;
    // BEACON 500 item 55 - a previously-drafted full page, re-assembled from its
    // compact persisted sections against the CURRENT preparedBrief (title/meta/faq
    // are not re-persisted). Only meaningful once a brief exists.
    let fullPageDraft: AssembledDraftPage | null = null;
    if (preparedBrief) {
      const persisted = deserializeFullPageDraft(savedDrafts.get(`${m.demandKey}::full_page_draft`)?.content);
      if (persisted) {
        fullPageDraft = reassembleFromPersisted(
          {
            proposedTitle: preparedBrief.title,
            metaDescription: preparedBrief.meta,
            openingAnswer: preparedBrief.opening,
            outline: preparedBrief.outline,
            faqQuestions: preparedBrief.faqQuestions,
          },
          persisted,
        );
      }
    }
    // Quality of the saved "Draft the opening" answer block (raw text or {answer}).
    const savedOpening = savedDrafts.get(`${m.demandKey}::answer_block`)?.content ?? null;
    let openingQuality: DraftQualityResult | null = null;
    if (savedOpening) {
      let answerText = savedOpening;
      // W5 P1-5 (2026-07-09): parse the saved draft's OWN cited sources instead
      // of dropping them (the old evidenceRefs:0-only call made every sourced
      // answer read as "Needs a source"). A raw-text draft has none, an
      // honest empty list.
      let answerSources: SourceRef[] | undefined;
      try {
        const p = JSON.parse(savedOpening) as { answer?: unknown; sources?: unknown };
        if (p && typeof p.answer === "string") answerText = p.answer;
        if (p && Array.isArray(p.sources)) answerSources = p.sources as SourceRef[];
      } catch {
        /* raw text - use as-is */
      }
      openingQuality = evaluateDraftQuality({
        answer: answerText,
        evidenceRefs: 0,
        sources: answerSources,
        authoritativeSourceDomains,
        firstMentionConfig,
      });
    }
    return {
      id: m.demandKey,
      topic: cleanTopicLabel(m.label),
      competitorCount: m.competitorUrls.length,
      topCompetitor: topUrl ? domainOf(topUrl) : null,
      whatWins: ww && ww !== "—" ? ww : null,
      // Real DataForSEO volume via the deterministic matcher (null when no match — honest).
      searchVolume: kwMatch.confidence === "none" ? null : kwMatch.searchVolume,
      keywordMatch:
        kwMatch.confidence === "none" || !kwMatch.keyword
          ? null
          : { keyword: kwMatch.keyword, volume: kwMatch.searchVolume, confidence: kwMatch.confidence },
      signal: signalForKeyword(kwMatch.confidence === "none" ? null : kwMatch.keyword, kwDemandRows, nowMonth),
      score: Math.round(m.score),
      savedOpening,
      competitorDomains: [...new Set(m.competitorUrls.map((u) => domainOf(u)).filter((d): d is string => !!d))].slice(0, 6),
      preparedVerdict: verdict,
      preparedBrief,
      fullPageDraft,
      briefQuality,
      openingQuality,
      aeoReceipt,
      alsoCovers: meta?.alsoCovers ?? [],
      briefFromRelated,
      infoGain: m.infoGain ? { verdict: m.infoGain.verdict, sentence: m.infoGain.sentence } : null,
    };
  });

  // Competitor keyword gap cards (2026-07-02, item 16) — ADDITIVE: topics the gap
  // engine found (competitor ranks top 20 on Google, tenant absent) that no
  // graph-sourced card already covers. Persisted-store read only ($0 render);
  // capped at 3 so the board stays a board, not a keyword dump.
  const gapCards = buildGapOpportunities(storedGaps, [
    ...opportunities.map((o) => o.topic),
    ...createMoves.map((m) => m.label),
  ]);

  // Beat-Wikipedia cards (2026-07-02, item 23) — ADDITIVE: Wikipedia articles AI
  // cites in this tenant's space that the finder scored thin/stale/generic enough
  // to beat. Persisted-store read only ($0 render); capped at 3 so the board
  // stays a board, not a Wikipedia dump. Non-overlapping with existing cards.
  const wikiGapCards = buildWikiGapOpportunities(storedWikiGaps, [
    ...opportunities.map((o) => o.topic),
    ...createMoves.map((m) => m.label),
    ...gapCards.map((c) => c.topic),
  ]);

  // D-27..D-29 (operator spec 2026-07-09) - the board's SEMANTIC clustering, floor, and
  // opportunity ranking. This replaces the older topic-string dedup: it not only
  // collapses near-duplicate phrasings ("kashan rug" ≡ "kashan rugs", "iranian director"
  // ≡ "iranian directors") into ONE canonical card, it reports DEDUPLICATED demand
  // (never a blind sum), drops sub-50/mo ideas that carry no strategic signal (D-28),
  // and orders by clusterVolume x winnability x intent fit (D-29), never alphabetical.
  const combined = [...opportunities, ...gapCards, ...wikiGapCards];
  const byId = new Map(combined.map((o) => [o.id, o]));
  const clusterInput: NewPageClusterCandidate[] = combined.map((o) => ({
    id: o.id,
    label: o.topic,
    volume: o.searchVolume,
    aiValidated: !!o.aeoReceipt,
    competitorCited: o.competitorCount > 0 || o.competitorDomains.length > 0,
    winnability: deriveWinnability(o.preparedVerdict),
    intentFit: 1,
  }));
  const clusters = clusterNewPageCandidates(clusterInput);
  const { kept: keptClusters, dropped } = applyNewPageFloor(clusters);
  if (dropped.length > 0) {
    log.info("[new-pages] clustered + floored New Pages board", {
      tenantId,
      dropped: dropped.map((d) => `${d.label} (${d.reason})`),
    });
  }
  const ranked = rankNewPageClusters(keptClusters);
  // Map each surviving cluster back to its canonical card, folding in the absorbed
  // variants ("Also covers …" + deduplicated demand) and any strategic keep-reason.
  const deduped: NewPageOpportunity[] = ranked
    .map((c): NewPageOpportunity | null => {
      const canonical = byId.get(c.canonicalId);
      if (!canonical) return null;
      const boardVariants = c.variants.filter((v) => v.id !== c.canonicalId).map((v) => v.label);
      // Merge the board-level variants with any siblings the upstream graph collapse
      // already absorbed (canonicalGroup.alsoCovers), de-duplicated for display.
      const alsoCovers = [...new Set([...(canonical.alsoCovers ?? []), ...boardVariants])];
      return {
        ...canonical,
        alsoCovers,
        clusterVolume: boardVariants.length > 0 && c.clusterVolume > 0 ? c.clusterVolume : null,
        keptUnderFloorReason: c.keptUnderFloorReason,
      };
    })
    .filter((o): o is NewPageOpportunity => o !== null);

  // N30 (2026-07-03) - attach the top 3 uncovered universe questions per topic
  // to the brief. Degrade-safe read; an empty universe (not built yet) attaches
  // NOTHING, so the board payload stays byte-identical to before this feature
  // (seedQuestionsForTopic returns [] and the field stays absent - pinned).
  let universeRows: UniverseQuestionRow[] = [];
  try {
    universeRows = await withTimeout(loadQuestionUniverseForTenant(tenantId), 4000, [] as UniverseQuestionRow[]);
  } catch {
    universeRows = [];
  }
  const withQuestions =
    universeRows.length === 0
      ? deduped
      : deduped.map((o) => {
          const seeds = seedQuestionsForTopic(universeRows, o.topic, { limit: 3 });
          return seeds.length > 0 ? { ...o, universeQuestions: seeds } : o;
        });

  // Owned-coverage gate (2026-07-11) - the LAST pass, so it sees each card's final
  // topic + "Also covers" cluster. An owned page that already targets a card's core
  // topic (its headline or its demand-driving keyword) demotes the card to watching;
  // an owned page that only covers an "Also covers" topic gets that topic dropped and
  // acknowledged. Degrade-safe: if the reads come back empty NOTHING is gated, so the
  // board is byte-identical to before this feature when the tenant has no GSC/snapshot
  // data to check against.
  let coverageInputs: OwnedCoverageInput = { serving: [], ownedPages: [] };
  try {
    coverageInputs = await withTimeout(loadOwnedCoverageInputs(tenantId, ownedUrls), 5000, {
      serving: [],
      ownedPages: [],
    });
  } catch {
    coverageInputs = { serving: [], ownedPages: [] };
  }
  const withCoverage =
    coverageInputs.serving.length === 0 && coverageInputs.ownedPages.length === 0
      ? withQuestions
      : withQuestions.map((o) => applyOwnedCoverage(o, coverageInputs));

  return {
    opportunities: withCoverage,
    totalCandidates: createMoves.length,
    ownDomain,
  };
}

/** Run the owned-coverage detector for one card and fold the verdict in: demote to
 *  watching when a core topic is owned, else drop + acknowledge any owned "Also
 *  covers" topic. Never widens the card; leaves it untouched when nothing is owned. */
function applyOwnedCoverage(o: NewPageOpportunity, input: OwnedCoverageInput): NewPageOpportunity {
  const coreTopics = [o.topic, o.keywordMatch?.keyword ?? ""].filter((t): t is string => !!t && t.trim().length > 0);
  const verdict = detectOwnedCoverageForCard({
    coreTopics,
    alsoCovers: o.alsoCovers ?? [],
    serving: input.serving,
    ownedPages: input.ownedPages,
  });

  if (verdict.primary) {
    const m = verdict.primary;
    return {
      ...o,
      ownedCoverage: {
        state: "watching",
        ownedUrl: m.ownedUrl,
        ownedPath: m.ownedPath,
        basis: m.basis,
        sentence: m.sentence,
        detail: m.detail,
      },
    };
  }

  if (verdict.coveredAlsoCovers.length > 0) {
    const coveredTopics = verdict.coveredAlsoCovers.map((c) => c.topic);
    const coveredSet = new Set(coveredTopics);
    const m = verdict.coveredAlsoCovers[0]!.match;
    return {
      ...o,
      alsoCovers: (o.alsoCovers ?? []).filter((t) => !coveredSet.has(t)),
      ownedCoverage: {
        state: "acknowledge",
        ownedUrl: m.ownedUrl,
        ownedPath: m.ownedPath,
        basis: m.basis,
        sentence: acknowledgeSentence(m, coveredTopics),
        detail: m.detail,
      },
    };
  }

  return o;
}

const MAX_GAP_CARDS = 3;

/** Map the persisted keyword-gap run to New Page cards, skipping topics an existing
 *  card/move already covers (simple containment on normalized labels). */
function buildGapOpportunities(
  stored: StoredKeywordGaps | null,
  existingLabels: string[],
): NewPageOpportunity[] {
  if (!stored || stored.gaps.length === 0) return [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const existing = existingLabels.map(norm).filter(Boolean);
  const out: NewPageOpportunity[] = [];
  for (const g of stored.gaps) {
    if (out.length >= MAX_GAP_CARDS) break;
    const kw = norm(g.keyword);
    if (!kw || isJunkTopic(kw)) continue;
    if (existing.some((e) => e.includes(kw) || kw.includes(e))) continue;
    out.push({
      id: `kwgap::${kw.replace(/\s+/g, "-")}`,
      topic: cleanTopicLabel(titleCase(kw)),
      competitorCount: 0, // Google-rank evidence, not AI-citation counts — stay honest
      topCompetitor: g.competitorDomain,
      whatWins: null,
      searchVolume: g.volume,
      keywordMatch: g.volume != null ? { keyword: kw, volume: g.volume, confidence: "exact" } : null,
      // Gap cards have no 12-month trend to read - Stable, honestly.
      signal: { kind: "stable", label: "Stable", evidence: null },
      score: g.score,
      savedOpening: null,
      competitorDomains: [g.competitorDomain, ...g.alsoWonBy].slice(0, 6),
      preparedVerdict: null,
      preparedBrief: null,
      fullPageDraft: null,
      briefQuality: null,
      openingQuality: null,
      aeoReceipt: null,
      alsoCovers: [],
      briefFromRelated: false,
      gapEvidence: g.evidence,
    });
  }
  return out;
}

export const MAX_WIKI_GAP_CARDS = 3;

/** Map the persisted wiki-gap run to New Page cards, skipping topics an existing
 *  card/move already covers (simple containment on normalized labels) and any
 *  article the finder scored "low" beatability (not worth a card yet). Exported
 *  for the feed-bounding unit test (today-newpages-wiki-gap.test.ts). */
export function buildWikiGapOpportunities(stored: StoredWikiGaps | null, existingLabels: string[]): NewPageOpportunity[] {
  if (!stored || stored.gaps.length === 0) return [];
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const existing = existingLabels.map(norm).filter(Boolean);
  const out: NewPageOpportunity[] = [];
  for (const g of stored.gaps) {
    if (out.length >= MAX_WIKI_GAP_CARDS) break;
    if (g.band === "low") continue;
    const topic = norm(g.displayTitle);
    if (!topic || isJunkTopic(topic)) continue;
    if (existing.some((e) => e.includes(topic) || topic.includes(e))) continue;
    out.push({
      id: `wikigap::${topic.replace(/\s+/g, "-")}`,
      topic: cleanTopicLabel(titleCase(topic)),
      competitorCount: 0, // Wikipedia citation evidence, not AI-attention counts — stay honest
      topCompetitor: "wikipedia.org",
      whatWins: null,
      searchVolume: g.demand,
      keywordMatch: g.demand != null ? { keyword: topic, volume: g.demand, confidence: "exact" } : null,
      // Wiki-gap cards have no 12-month trend to read - Stable, honestly. The beatability
      // band (high/medium) still drives ranking via `score`, not a visible trend label.
      signal: { kind: "stable", label: "Stable", evidence: null },
      score: g.score,
      savedOpening: null,
      competitorDomains: ["wikipedia.org"],
      preparedVerdict: null,
      preparedBrief: null,
      fullPageDraft: null,
      briefQuality: null,
      openingQuality: null,
      aeoReceipt: null,
      alsoCovers: [],
      briefFromRelated: false,
      wikiGapEvidence: g.evidenceSentence,
    });
  }
  return out;
}

export const loadNewPagesData = cache(
  async (): Promise<NewPagesData> => buildNewPagesData(await currentTenantId()),
);
