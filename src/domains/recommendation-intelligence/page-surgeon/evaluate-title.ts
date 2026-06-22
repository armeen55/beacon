/**
 * Page Surgeon — TITLE evaluator orchestrator (W1a, deterministic core).
 *
 * Pipeline: generate candidates → score each against structured evidence →
 * drop vetoed → rank → decide (a candidate COMPARISON, never a fixed rule).
 * Produces the full EvaluatorDecision + the operator's exact titleStrategy
 * output. Confidence reflects evidence strength + the margin between the top
 * candidates. Publishability here is a DETERMINISTIC provisional value; the
 * real authority (`enforceExpertConfidence`) is applied at integration and may
 * only LOWER it. The LLM judge (next sub-slice) layers on top and falls back to
 * this deterministic decision verbatim.
 *
 * Pure. Deterministic. No I/O.
 */

import type {
  CandidateOption,
  CandidateScore,
  EvaluatorDecision,
  EvidenceConfidence,
  EvidencePacket,
  Publishability,
  TitleStrategyOutput,
} from "./contract";
import { tokenSet } from "./contract";
import { generateTitleCandidates, type BrandConfig } from "./title-candidates";
import { scoreTitleCandidate } from "./title-scorers";

const HIGH_MARGIN = 0.15;
const MED_MARGIN = 0.05;
/** Scores within this band are a "tie" → broken by focus (fewer boilerplate
 *  tokens) then brevity. Keeps selection evidence-first, tiebreak second. */
const TIE_EPSILON = 0.02;

/** Count of the tenant's own boilerplate tokens carried by a candidate's text. */
function boilerplateLoad(text: string | null, boilerplate: Set<string>): number {
  if (!text || boilerplate.size === 0) return 0;
  let n = 0;
  for (const t of tokenSet(text)) if (boilerplate.has(t)) n += 1;
  return n;
}

function weakestDimension(score: CandidateScore): string {
  let worst: { dim: string; v: number } | null = null;
  for (const d of score.dimensions) {
    if (!d.available) continue;
    if (worst == null || d.score < worst.v) worst = { dim: d.dimension, v: d.score };
  }
  return worst?.dim ?? "insufficient_evidence";
}

function rejectionReason(
  cand: CandidateOption,
  score: CandidateScore,
  bestTotal: number,
): string {
  if (score.vetoes.length > 0) return `Disqualified: ${score.vetoes.join(", ")}.`;
  return `Lower evidence score (${score.weightedTotal.toFixed(2)} vs ${bestTotal.toFixed(
    2,
  )}); weakest on ${weakestDimension(score)}.`;
}

export type EvaluateTitleArgs = {
  packet: EvidencePacket;
  brand: BrandConfig;
};

export function evaluateTitle(args: EvaluateTitleArgs): EvaluatorDecision {
  const { packet, brand } = args;
  const current = packet.current.currentText?.trim() || null;
  const topQuery = packet.gsc?.topQueries?.[0]?.query ?? "";

  const candidates = generateTitleCandidates(packet, brand);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const scored = candidates.map((c) => scoreTitleCandidate(c, packet, brand));

  // Viable = not hard-vetoed. keep_current is always viable (the safe baseline).
  const viable = scored.filter(
    (s) => s.vetoes.length === 0 || byId.get(s.candidateId)?.strategy === "keep_current",
  );
  const boilerplate = new Set((packet.boilerplateTerms ?? []).map((t) => t.toLowerCase()));
  const textOf = (id: string) => {
    const c = byId.get(id)!;
    return c.strategy === "keep_current" ? current : c.proposedText;
  };
  const ranked = [...viable].sort((a, b) => {
    const d = b.weightedTotal - a.weightedTotal;
    if (Math.abs(d) > TIE_EPSILON) return d;
    // Tie: prefer the more focused title (fewer boilerplate tokens), then shorter.
    const ta = textOf(a.candidateId);
    const tb = textOf(b.candidateId);
    const bl = boilerplateLoad(ta, boilerplate) - boilerplateLoad(tb, boilerplate);
    if (bl !== 0) return bl;
    return (ta?.length ?? 0) - (tb?.length ?? 0);
  });

  const keepScore = scored.find(
    (s) => byId.get(s.candidateId)?.strategy === "keep_current",
  );
  const best = ranked[0] ?? keepScore!;
  const second = ranked[1] ?? null;
  const bestCand = byId.get(best.candidateId)!;
  const margin = second ? best.weightedTotal - second.weightedTotal : 1;

  // Evidence strength gates confidence. No GSC demand ⇒ we cannot judge a title
  // change on evidence ⇒ needs_more_evidence + keep current.
  const hasDemand = !!packet.gsc && topQuery.length > 0;
  let confidence: EvidenceConfidence;
  if (!hasDemand) confidence = "needs_more_evidence";
  else if (margin >= HIGH_MARGIN) confidence = "high";
  else if (margin >= MED_MARGIN) confidence = "medium";
  else confidence = "low";

  // When evidence is thin, force the safe baseline (keep current).
  const effectiveBest = !hasDemand ? keepScore! : best;
  const effectiveCand = byId.get(effectiveBest.candidateId)!;
  const keepCurrent =
    effectiveCand.strategy === "keep_current" || !hasDemand;

  const recommendedText = keepCurrent
    ? null
    : effectiveCand.strategy === "create_new_page"
      ? null
      : effectiveCand.proposedText;

  const evidenceUsed = Array.from(
    new Set(
      effectiveBest.dimensions
        .filter((d) => d.available)
        .flatMap((d) => d.evidenceUsed),
    ),
  );
  const evidenceGaps = effectiveBest.dimensions
    .filter((d) => !d.available)
    .map((d) => d.dimension);

  const rejected = ranked
    .filter((s) => s.candidateId !== effectiveBest.candidateId)
    .map((s) => {
      const c = byId.get(s.candidateId)!;
      return {
        candidateId: s.candidateId,
        title: c.proposedText,
        reason: rejectionReason(c, s, effectiveBest.weightedTotal),
      };
    });

  const hypothesis = keepCurrent
    ? hasDemand
      ? `The current title already serves "${topQuery}"; changing it risks losing terms without CTR upside.`
      : `Not enough search-demand evidence to judge a title change for this page.`
    : effectiveCand.strategy === "create_new_page"
      ? `"${topQuery}" is a different topic than this page; a dedicated page should outrank a re-title.`
      : `Re-titling to "${recommendedText}" better matches the page's top search demand ("${topQuery}") and should lift CTR at its current rank.`;

  const risks: string[] = [];
  if (effectiveCand.removedTerms.length > 0)
    risks.push(`Drops terms: ${effectiveCand.removedTerms.join(", ")}.`);
  const rewriteRisk = effectiveBest.dimensions.find(
    (d) => d.dimension === "google_title_rewrite_risk",
  );
  // Only assert the rewrite risk when the dimension was actually scored — a
  // present-but-unavailable dimension defaults low and would falsely warn.
  if (rewriteRisk?.available && rewriteRisk.score < 0.5)
    risks.push("Google may rewrite the displayed title.");
  if (!packet.current.cmsFieldMapped)
    risks.push("No CMS field mapping yet — review-only until mapped.");

  // Provisional deterministic publishability (the real gate may only lower it).
  let publishability: Publishability = "review_only";
  if (!keepCurrent && (confidence === "high" || confidence === "medium")) {
    publishability = packet.current.cmsFieldMapped ? "staged" : "review_only";
  }

  const titleStrategy: TitleStrategyOutput = {
    recommended_strategy: effectiveCand.strategy,
    recommended_title: recommendedText,
    keep_current_title: keepCurrent,
    brand_suffix_decision: effectiveCand.brandSuffixDecision,
    preserved_terms: effectiveCand.preservedTerms,
    removed_terms: effectiveCand.removedTerms,
    rejected_candidates: rejected.map((r) => ({ title: r.title, reason: r.reason })),
    confidence,
    evidence_used: evidenceUsed,
    risks,
  };

  return {
    changeType: "title",
    pageUrl: packet.current.pageUrl,
    recommendedCandidateId: keepCurrent ? null : effectiveBest.candidateId,
    recommendedText,
    keepCurrent,
    rejectedCandidates: rejected,
    confidence,
    evidenceUsed,
    evidenceGaps,
    hypothesis,
    risks,
    beforeAfterDiff: { before: current, after: recommendedText },
    measurementPlan: hasDemand
      ? `Track this page's Google CTR for "${topQuery}" (impressions, clicks, avg position) on the next data refresh; expect CTR to rise if the new title matches intent.`
      : `Connect/refresh Google Search Console so a title decision can be grounded in real demand.`,
    rollbackPlan:
      current != null
        ? `Restore the previous title: "${current}".`
        : `Remove the added title to revert.`,
    publishability,
    decidedBy: "deterministic",
    titleStrategy,
  };
}
