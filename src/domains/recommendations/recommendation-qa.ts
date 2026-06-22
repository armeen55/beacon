/**
 * Expert-rec-engine GQA (2026-06-16) — GENERATION-TIME recommendation QA.
 *
 * Operator directive: "I do not want a smarter explanation attached to a bad
 * recommendation. Prevent bad recommendations from being shown as high
 * confidence in the first place." So this pure verdict runs INSIDE
 * `buildRecommendationActionRows` (every row, no LLM, no I/O) and is what
 * downgrades a bad query/page match BEFORE it reaches the customer list.
 *
 * It composes the deterministic pieces already built — and the deterministic
 * gate (`enforceExpertConfidence`) is the FINAL AUTHORITY:
 *   • intent fit      — `deriveRowTopicFit` (Slice 3): is this even the right
 *     page for the query? A confident mismatch → rejected.
 *   • evidence        — which source families back the rec; high confidence
 *     REQUIRES a core evidence family.
 *   • safe copy       — `detectCopyArtifact` (Slice 2): proposed copy must be
 *     clean publishable copy (no instruction-text / "Add Add" / dup brand).
 *   • push readiness  — paste-ready vs manual vs review-only (coarse; the push
 *     surface refines live-pushable / needs-mapping with the live config).
 *
 * NO hardcoded vertical/keyword/brand rules: brand + locale terms are passed
 * in from tenant config; the fit is generic semantic analysis over evidence.
 *
 * PURE / deterministic. Pinned by tests/domains/recommendations/recommendation-qa.test.ts.
 */

import { deriveRowTopicFit } from "./topic-fit-from-evidence";
import { enforceExpertConfidence, type FinalConfidence } from "./expert-verdict";
import { detectCopyArtifact, exceedsPublishLengthLimit } from "./copy-artifact-guard";
import type { ActionRowType, RecommendationActionRow } from "./recommendation-action-rows";
import { INTENT_FIT_FLOOR, type PageTopicFit } from "./page-topic-fit";

/**
 * The generation-time downgrade is CONSERVATIVE — it rejects only a CONFIDENT
 * mismatch, NOT the scorer's weaker `shouldUseQueryForOptimization` floor
 * (topic < 45), because the row-only inputs (no page body snapshot) under-score
 * legitimate pages. A confident mismatch is either near-zero topical overlap
 * (the "wrong page entirely" case: a time query on a wildlife page) OR a clear
 * intent-class conflict (a transactional query on an informational page). A
 * city page that merely shares its core entity with its query cluster
 * ("tehran travel guide" on the Tehran page) is NOT a confident mismatch and is
 * banded by fit, never rejected. The richer detail-page strategist keeps the
 * scorer's full nuance; the LIST stays conservative to avoid demoting real recs.
 */
const SEVERE_TOPIC_FLOOR = 20;

function isConfidentMismatch(fit: PageTopicFit | null): boolean {
  if (fit == null) return false;
  return fit.topicMatchScore < SEVERE_TOPIC_FLOOR || fit.intentMatchScore < INTENT_FIT_FLOOR;
}

export type RecPushReadiness = "paste_ready" | "manual" | "review_only";

/**
 * Normalized evidence receipt (2026-06-16 trust audit, fix A) — the rec's
 * evidence families distilled from its raw signals at BUILD time, so the QA
 * doesn't have to re-derive them from display-shaped fields. The bug this
 * closes: `hasCoreEvidence` previously read ONLY `gscEvidenceLines` (the
 * per-query low-CTR/striking-distance lines), which are EMPTY when a page has
 * real Google demand but no single qualifying query — so a page with 8,465
 * impressions was falsely flagged "No core evidence family is present" and
 * capped to needs-more-evidence. Page-level GSC demand IS core evidence.
 *
 * Every field is "this family genuinely backs this rec," derived from the live
 * signals (gscSignal/semrushSignal/claritySignal/observations/competitor), not
 * from whether a display line happened to render.
 */
export type RecEvidenceReceipt = {
  /** The page has Google Search demand (impressions), even without a per-query line. */
  gscDemand: boolean;
  /** The page has GA4 traffic / page value. */
  ga4Traffic: boolean;
  /** SEMrush ranked-keyword data exists for the page. */
  semrush: boolean;
  /** Microsoft Clarity behavioral data exists for the page. */
  clarity: boolean;
  /** Answer-engine evidence (AEO lines or sampled AI observations). */
  aeo: boolean;
  /** A competitor is winning the answer/SERP for this topic. */
  competitor: boolean;
};

export type RecQaVerdict = {
  /** Page-topic intent-fit (Slice 3), or null when no quotable query. */
  intentFit: PageTopicFit | null;
  /** The DETERMINISTIC confidence — the LLM cannot raise past this. */
  confidence: FinalConfidence;
  /** Whether the rec may be presented as actionable. */
  approve: boolean;
  /** Why this recommendation exists (the motive). */
  whyExists: string;
  /** Why the chosen query/page match is valid, when scored. */
  whyMatchValid: string | null;
  /** Source families that back this rec (customer-readable). */
  evidenceSupports: string[];
  /** Informative families NOT present (honest about gaps). */
  evidenceMissing: string[];
  /** One-line reason for the confidence verdict. */
  confidenceReason: string;
  /** Coarse push readiness from the action type. */
  pushReadiness: RecPushReadiness;
  /** Proposed copy is artifact-free (clean publishable copy). */
  copySafe: boolean;
};

/**
 * RENDER ENFORCEMENT (2026-06-16) — derive the customer-visible status pill +
 * primary CTA + pushability from the deterministic QA verdict, so the card +
 * detail can't show "Suggested" / "Accept" / "High" on a rec the gate capped
 * or rejected. Pure; consumed by the v2 card + the detail page.
 */
export type RecQaDisplay = {
  /** Overrides the "Suggested" status pill when the gate isn't clean; null = use the normal status label. */
  statusOverride: string | null;
  /** Whether the primary CTA may be "Accept". */
  actionable: boolean;
  /** Primary CTA label. */
  primaryCtaLabel: "Accept" | "Review only";
  /** Honest pushability label for the list/detail. */
  pushLabel: "Paste-ready" | "Not publishable" | "Manual build";
};

export function deriveRecQaDisplay(args: {
  qaVerdict?: RecQaVerdict | null;
  /** True when the row is a fresh suggestion (new/needs_review bucket). */
  isSuggestion: boolean;
}): RecQaDisplay {
  const v = args.qaVerdict ?? null;
  const pushLabel: RecQaDisplay["pushLabel"] =
    v?.pushReadiness === "manual"
      ? "Manual build"
      : v?.pushReadiness === "review_only"
        ? "Not publishable"
        : "Paste-ready";
  // Only gate fresh suggestions; an accepted/shipped row keeps its real status.
  if (!args.isSuggestion || v == null) {
    return { statusOverride: null, actionable: true, primaryCtaLabel: "Accept", pushLabel };
  }
  const statusOverride =
    v.confidence === "rejected"
      ? "Rejected by QA"
      : v.confidence === "needs_more_evidence"
        ? "Needs more evidence"
        : v.confidence === "low"
          ? "Needs review"
          : null; // high / medium → normal "Suggested"
  const actionable = v.approve;
  return {
    statusOverride,
    actionable,
    primaryCtaLabel: actionable ? "Accept" : "Review only",
    pushLabel,
  };
}

const PUSH_READINESS_BY_ACTION: Record<ActionRowType, RecPushReadiness> = {
  edit_title: "paste_ready",
  edit_h1: "paste_ready",
  edit_h2: "paste_ready",
  edit_meta: "paste_ready",
  add_schema: "paste_ready",
  add_faq: "paste_ready",
  add_section: "paste_ready",
  improve_copy: "paste_ready",
  add_internal_links: "paste_ready",
  add_comparison_table: "paste_ready",
  create_page: "manual",
  technical_fix: "review_only",
  review_decision: "review_only",
  regenerate_edit: "review_only",
};

/** A fallback "why this exists" when the resolver attached no motive label. */
function whyExistsFallback(actionType: ActionRowType, targetLabel: string): string {
  switch (actionType) {
    case "create_page":
      return `No page targets this topic yet, so there's nothing for search or AI assistants to surface.`;
    case "technical_fix":
      return `A technical issue on ${targetLabel} is holding back how it's crawled or rendered.`;
    case "add_schema":
      return `${targetLabel} is missing structured data that helps engines understand and feature it.`;
    default:
      return `${targetLabel} has demand or a gap Beacon thinks is worth acting on.`;
  }
}

export function buildRecommendationQaVerdict(args: {
  row: RecommendationActionRow;
  affectedPromptTexts: ReadonlyArray<string>;
  brandTerms?: ReadonlyArray<string>;
  localeTerms?: ReadonlyArray<string>;
  /** An upstream deterministic safety gate already rejected this rec. */
  deterministicReject?: boolean;
  /**
   * GQA-4 — the GENERATION-TIME page/query fit (scored against the full page
   * snapshot in resolvePageIntent). When present it is the PREFERRED authority:
   * the QA uses it instead of the row-evidence proxy, because it had the
   * richest page context. Falls back to `deriveRowTopicFit` only when absent.
   */
  preferredTopicFit?: PageTopicFit | null;
  /**
   * Normalized evidence receipt from the rec's live signals (trust audit fix
   * A). When present it is the AUTHORITY for which evidence families back this
   * rec — page-level GSC demand counts as core evidence even when no per-query
   * display line rendered. Falls back to the display-line detection when
   * absent (legacy callers / tests).
   */
  evidence?: RecEvidenceReceipt | null;
}): RecQaVerdict {
  const { row } = args;
  const d = row.detail;

  const intentFit =
    args.preferredTopicFit ??
    deriveRowTopicFit(row, args.affectedPromptTexts, {
      brandTerms: args.brandTerms,
      localeTerms: args.localeTerms,
    });

  // Trust audit fix A (2026-06-16): an evidence family backs this rec if its
  // display LINE rendered OR the normalized receipt says the page genuinely has
  // that signal. Page-level GSC demand (impressions) counts as core evidence
  // even when there's no per-query low-CTR/striking-distance headline line —
  // the bug that nuked every GSC-grounded rec to "no core evidence".
  const r = args.evidence ?? null;
  const gsc = (d.gscEvidenceLines ?? []).length > 0 || (r?.gscDemand ?? false);
  const semrush = (d.semrushEvidenceLines ?? []).length > 0 || (r?.semrush ?? false);
  const clarity = (d.clarityEvidenceLines ?? []).length > 0 || (r?.clarity ?? false);
  const aeo =
    (d.aeoEvidenceLines ?? []).length > 0 ||
    (r?.aeo ?? false) ||
    d.observationCount > 0;
  const ga4 = r?.ga4Traffic ?? false;
  const competitor = d.topCompetitor != null || (r?.competitor ?? false);
  const hasCoreEvidence = gsc || ga4 || semrush || clarity || aeo || competitor;

  const proposed = d.proposedText?.trim();
  const copySafe = proposed ? detectCopyArtifact(proposed) == null : true;

  // The QA uses its own conservative severe-mismatch reject (see above), NOT
  // the scorer's weaker floor — so `shouldUseQueryForOptimization` is folded
  // into `deterministicReject` only when the mismatch is confident, and the
  // real scores still band the non-severe cases (weak fit → low, not rejected).
  const verdict = enforceExpertConfidence({
    deterministicReject: args.deterministicReject === true || isConfidentMismatch(intentFit),
    shouldUseQueryForOptimization: null,
    hasCoreEvidence,
    topicMatchScore: intentFit?.topicMatchScore ?? null,
    intentMatchScore: intentFit?.intentMatchScore ?? null,
    copySafe,
  });

  const evidenceSupports: string[] = [];
  if (gsc) evidenceSupports.push("Google Search demand");
  if (ga4) evidenceSupports.push("Website traffic");
  if (semrush) evidenceSupports.push("Keyword rankings");
  if (competitor) evidenceSupports.push("Competitor pressure");
  if (aeo) evidenceSupports.push("AI-answer gap");
  if (clarity) evidenceSupports.push("On-page behaviour");

  const evidenceMissing: string[] = [];
  if (!gsc && !semrush) {
    evidenceMissing.push("Search demand (connect Google Search Console or SEMrush)");
  }
  if (!aeo && d.observationCount === 0) {
    evidenceMissing.push("AI-answer tracking (connect an answer-engine source)");
  }
  if (!clarity && evidenceMissing.length < 3) {
    evidenceMissing.push("On-page behaviour (connect Microsoft Clarity)");
  }

  const whyExists = d.motiveLabel ?? whyExistsFallback(row.actionType, row.targetLabel);
  const whyMatchValid = intentFit ? intentFit.matchExplanation : null;

  const confidenceParts: string[] = [verdict.gateNotes[0] ?? ""];
  if (!copySafe) {
    confidenceParts.push("The proposed copy needs review before it's paste-ready.");
  }
  const confidenceReason = confidenceParts.filter((p) => p.length > 0).join(" ");

  // audit-3 #11: an over-limit title/meta is NOT paste-ready — the push service
  // would refuse it un-trimmed (same PUSH_*_MAX_CHARS ceiling), so the QA layer
  // must agree and demote it to review_only instead of advertising one-tap
  // publish. Length stays a QUALITY signal for confidence (unchanged); this only
  // affects pushability.
  const basePushReadiness = PUSH_READINESS_BY_ACTION[row.actionType] ?? "review_only";
  const pushReadiness: RecPushReadiness =
    basePushReadiness === "paste_ready" &&
    exceedsPublishLengthLimit(row.actionType, proposed)
      ? "review_only"
      : basePushReadiness;

  return {
    intentFit,
    confidence: verdict.enforcedConfidence,
    approve: verdict.enforcedApprove,
    whyExists,
    whyMatchValid,
    evidenceSupports,
    evidenceMissing,
    confidenceReason,
    pushReadiness,
    copySafe,
  };
}
