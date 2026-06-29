/**
 * collapse-create-page-siblings (2026-06-29) — UPSTREAM canonicalization of near-
 * duplicate create_page moves, applied as a load-graph post-pass (OUTSIDE the pure
 * buildDemandGraph, beside applyExperimentPriorToMoves / attachProfoundEvidenceToMoves).
 *
 * WHY here, not at the board: the demand graph seeds one create_page candidate per
 * unmatched-competitor topic-token slice (load-graph "gap:<tokens>" grouping), so the
 * 3 nowruz labels / persian+iranian wedding become SEPARATE moves with distinct
 * demandKeys. Collapsing once on graph.moves means EVERY consumer — the New Pages
 * board, the ActionPack worklist (one pack per move), prepare-create-page-verdicts
 * (SERP + briefs per move) — gets ONE canonical candidate, instead of each re-deduping.
 *
 * It reuses the same conservative grouper as the board (groupCreatePageCandidates):
 * merge only on same matched keyword OR identical distinguishing-token set; weak-keyword
 * merges collapse the card but don't inherit a brief; etiquette/literature stay separate.
 * The canonical KEEPS its demandKey (proof/experiment/draft joins stay valid) and ABSORBS
 * its siblings' competitor URLs + fanout seeds (teardown coverage is never lost). Siblings
 * are dropped from the move list. PURE — all I/O (keyword cache, drafts) is passed in.
 *
 * Pinned by collapse-create-page-siblings.test.ts.
 */

import type { MoveCandidate } from "./build-graph";
import { groupCreatePageCandidates, type CanonCandidate } from "@/domains/demand/canonical-create-page";
import { matchKeywordDemand, topicDistinguishingTokens } from "@/domains/demand/keyword-match";
import { cleanTopicLabel } from "./clean-topic-label";
import { evaluateCreatePageBriefQuality } from "@/domains/drafts/draft-quality";
import type { KeywordDemand } from "@/domains/serp/dataforseo-keywords";

/** Read the verdict out of a persisted serp_verdict draft. Inlined (not imported from
 *  prepare-create-page-verdicts) to avoid a load-graph → collapse → prepare → load-graph
 *  import cycle — that module imports loadDemandGraphForTenant. */
function verdictOf(content: string | undefined): "build" | "wait" | "reject" | null {
  if (!content) return null;
  try {
    const o = JSON.parse(content) as { verdict?: unknown };
    return o && (o.verdict === "build" || o.verdict === "wait" || o.verdict === "reject") ? o.verdict : null;
  } catch {
    return null;
  }
}

/** Sibling-cluster metadata attached to a canonical create_page move. */
export type CanonicalGroupMeta = {
  /** Absorbed sibling labels — the card's "Also covers: …" line. */
  alsoCovers: string[];
  /** A high-confidence sibling's demandKey whose passing brief the canonical may show
   *  (its create_page_brief draft persists even though the sibling move was dropped). */
  inheritBriefFrom: string | null;
  reason: string;
  confidence: "high" | "medium";
};

export type CollapseContext = {
  /** Cached DataForSEO keyword-volume rows (any confidence anchors grouping). */
  keywords: readonly KeywordDemand[];
  /** Latest move drafts (demandKey::kind → {content}) for verdict + brief signals. */
  drafts: Map<string, { content: string }>;
};

const FRESH_BRIEF = (drafts: CollapseContext["drafts"], demandKey: string): boolean => {
  const raw = drafts.get(`${demandKey}::create_page_brief`)?.content;
  if (!raw) return false;
  try {
    const b = JSON.parse(raw);
    return evaluateCreatePageBriefQuality({
      title: b.proposedTitle, meta: b.metaDescription, opening: b.openingAnswer,
      outline: b.outline, faqQuestions: b.faqQuestions, schemaTypes: b.schemaTypes,
      hasSerpVerdict: !!drafts.get(`${demandKey}::serp_verdict`),
    }).copyAllowed;
  } catch {
    return false;
  }
};

/**
 * Collapse near-duplicate create_page moves into canonical representatives. Returns a
 * NEW moves array: non-create moves untouched (original order), one canonical per
 * cluster (siblings dropped), absorbed siblings' competitorUrls + fanoutSeeds merged
 * into the canonical, and canonicalGroup metadata attached. PURE. Fail-soft callers
 * should fall back to the input on throw.
 */
export function collapseCreatePageSiblings(
  moves: readonly MoveCandidate[],
  ctx: CollapseContext,
): MoveCandidate[] {
  const createMoves = moves.filter((m) => m.gap === "create_page");
  if (createMoves.length < 2) return [...moves];

  const cands: CanonCandidate[] = createMoves.map((m) => {
    const mt = matchKeywordDemand(m.label, m.aeoEvidence?.prompts?.[0] ?? null, ctx.keywords);
    const v = verdictOf(ctx.drafts.get(`${m.demandKey}::serp_verdict`)?.content);
    return {
      demandKey: m.demandKey,
      label: cleanTopicLabel(m.label),
      distinctTokens: topicDistinguishingTokens(m.label),
      keyword: mt.confidence !== "none" ? mt.keyword : null,
      strongKeyword: mt.confidence === "exact" || mt.confidence === "strong",
      volume: mt.searchVolume ?? 0,
      verdict: v,
      hasPassingBrief: FRESH_BRIEF(ctx.drafts, m.demandKey),
      priority: m.score,
    };
  });

  const groups = groupCreatePageCandidates(cands);
  const absorbed = new Set<string>();
  const metaByKey = new Map<string, { meta: CanonicalGroupMeta; siblingKeys: string[] }>();
  for (const g of groups) {
    if (g.siblings.length === 0) continue;
    for (const s of g.siblings) absorbed.add(s.demandKey);
    metaByKey.set(g.canonical.demandKey, {
      meta: {
        alsoCovers: g.siblings.map((s) => s.label),
        inheritBriefFrom: g.inheritBriefFrom,
        reason: g.reason,
        confidence: g.confidence,
      },
      siblingKeys: g.siblings.map((s) => s.demandKey),
    });
  }
  if (absorbed.size === 0) return [...moves];

  const createByKey = new Map(createMoves.map((m) => [m.demandKey, m]));
  return moves
    .filter((m) => !absorbed.has(m.demandKey))
    .map((m) => {
      const entry = metaByKey.get(m.demandKey);
      if (!entry) return m;
      const sibs = entry.siblingKeys.map((k) => createByKey.get(k)).filter((x): x is MoveCandidate => !!x);
      // Preserve teardown coverage + sub-questions across the merged opportunity.
      const competitorUrls = [...new Set([...m.competitorUrls, ...sibs.flatMap((s) => s.competitorUrls)])].slice(0, 8);
      const fanoutSeeds = [...new Set([...m.fanoutSeeds, ...sibs.flatMap((s) => s.fanoutSeeds)])].slice(0, 12);
      return { ...m, competitorUrls, fanoutSeeds, canonicalGroup: entry.meta };
    });
}
