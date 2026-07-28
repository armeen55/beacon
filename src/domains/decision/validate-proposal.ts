/**
 * decision/validate-proposal (CORE 100K decision kernel, 2026-07-22) — the ONE
 * validator every ChangeProposal passes through before it can be shown as
 * actionable. It composes the existing, battle-tested safety gates into a
 * single verdict, so there is exactly one place that decides "is this draft
 * safe to put in front of a paying operator":
 *
 *   - draft-quality.ts (evaluateTitleMetaQuality)
 *     — generic/thin/off-topic/relevance/missing-source/source-authority.
 *   - factual-entailment.ts (checkFactualEntailment) — an invented number or
 *     entity with no grounding is a VIOLATION and rejects the draft; a dated,
 *     sourced contradiction of the page is an allowed CORRECTION (surfaced, not
 *     blocked).
 *   - placeholder-detection.ts (looksLikePlaceholder) — "[insert X]" / lorem.
 *   - copy-sanitize.ts (containsUuid) — a raw id leaking into operator copy.
 *   - dash ban — no em/en dash ever reaches operator-facing copy.
 *   - destructive-change guard — an "edit" that guts the current value (empties
 *     it or truncates it to a fraction) is never presented as a safe rewrite.
 *
 * The verdict maps to the proposal lifecycle: `ready` → proposed, `needs_review`
 * → needs_review, `rejected` → rejected (never shown as ready). PURE — no I/O.
 */

import {
  evaluateTitleMetaQuality,
  type DraftQualityResult,
  type DraftQualityStatus,
} from "@/domains/decision/drafts/draft-quality";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import type { ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { looksLikePlaceholder } from "./placeholder-detection";
import { containsUuid } from "./copy-sanitize";
import type { ChangeProposal, ProposalStatus } from "./contracts";

/** Quality statuses that are HARD failures — never actionable, always rejected.
 *  These are inventions / garbage / off-topic / malformed drafts: unsafe copy.
 *  NOTE the source HOLDS (`missing_source`, `needs_source_check`) are deliberately
 *  NOT here — a factual claim that just needs a citation is a `needs_review` hold
 *  ("add a source"), never presented as ready, but not the same as an invention. */
const REJECT_STATUSES: ReadonlySet<DraftQualityStatus> = new Set<DraftQualityStatus>([
  "generic_rejected",
  "relevance_rejected",
  "fact_risk",
  "unsupported_claim",
  "too_thin",
  "malformed",
  "unverified_claim",
]);

const DASH_RE = /[–—]/; // en-dash, em-dash

export type ProposalVerdict = "ready" | "needs_review" | "rejected";

export type ProposalValidation = {
  verdict: ProposalVerdict;
  /** The mapped proposal lifecycle status. */
  status: Extract<ProposalStatus, "proposed" | "needs_review" | "rejected">;
  /** The underlying draft-quality status (for debugging + UI notes). */
  qualityStatus: DraftQualityStatus;
  /** Plain-English reasons (why it was held or rejected). */
  reasons: string[];
  /** Unsupported-invention findings from factual entailment. Non-empty rejects. */
  factViolations: string[];
  /** Sourced corrections — surfaced WITH the proposal, never blocking. */
  corrections: string[];
  /** The hard-safety checks that tripped (placeholder/dash/uuid/destructive). */
  safetyFlags: string[];
  confidence: "high" | "medium" | "low";
};

/** Text fields the hard-safety scanners run over, per proposal kind. */
function operatorFacingText(proposal: ChangeProposal): string[] {
  const c = proposal.recommendedChange;
  if (c.kind === "existing_edit") return [c.after];
  return [c.proposedTitle, c.metaDescription, c.openingAnswer, ...c.outline, ...c.faqQuestions];
}

/** Destructive-change guard: an existing-page edit that empties or guts the
 *  current value. A rewrite should improve the field, never delete it. */
function isDestructiveEdit(before: string | null, after: string): boolean {
  const b = (before ?? "").trim();
  const a = after.trim();
  if (!a) return true; // nothing left
  if (!b) return false; // no prior value to destroy
  // Truncating a substantial field to under a third of its length is a gut,
  // not a rewrite (title/meta rewrites stay in the same ballpark of length).
  if (b.length >= 30 && a.length < b.length * 0.34) return true;
  return false;
}

export type ValidateProposalOptions = {
  /** The target page's own body text — turns ON factual entailment. */
  pageBodyText?: string | null;
  /** Flattened evidence text the draft may cite (numbers/facts). */
  evidenceText?: string | null;
  /** Dated, sourced facts on file (allow a correction). */
  authoritativeFacts?: readonly AuthoritativeFact[];
  /** The draft's own cited sources (authority re-derived by the gate). */
  sources?: readonly ClassifiableSource[];
  /** This tenant's curated authoritative-domain allowlist. */
  authoritativeSourceDomains?: readonly string[];
  /** Content-context vocabulary override (defaults to the gate's own). */
  contextTokens?: string[];
  now?: Date;
};

/**
 * Validate one ChangeProposal. Returns the verdict + the mapped lifecycle
 * status. A hard-safety trip or a factual violation ALWAYS rejects; a clean
 * quality "ready" draft is `proposed`; anything in between is `needs_review`.
 */
export function validateProposal(
  proposal: ChangeProposal,
  opts: ValidateProposalOptions = {},
): ProposalValidation {
  const change = proposal.recommendedChange;
  const texts = operatorFacingText(proposal);
  const query = proposal.primaryQuery;

  // ── hard-safety scanners (deterministic, no LLM) ────────────────────────────
  const safetyFlags: string[] = [];
  for (const t of texts) {
    if (looksLikePlaceholder(t)) safetyFlags.push("Contains a placeholder / template stub.");
    if (DASH_RE.test(t)) safetyFlags.push("Contains an em or en dash (banned in operator copy).");
    if (containsUuid(t)) safetyFlags.push("Leaks a raw id into operator copy.");
  }
  if (change.kind === "existing_edit" && isDestructiveEdit(change.before, change.after)) {
    safetyFlags.push("Rewrite deletes or guts the current value (destructive edit).");
  }

  // ── factual entailment (invented numbers/entities → violation) ──────────────
  // Only the EXISTING-page edit path runs entity-level entailment: it has a real
  // page body / current value to check a new claim against, so an invented
  // number or entity is a genuine violation (or a dated, sourced correction). A
  // brand-NEW page inherently introduces entities that are not yet on any page,
  // so entity-entailment there is pure noise; its ungrounded-NUMBER protection
  // is already enforced upstream by the drafter's numeric-fidelity firewall at
  // generation, so a persisted brief cannot carry an invented number.
  const entail = change.kind === "existing_edit"
    ? checkFactualEntailment({
        draftText: change.after,
        query,
        pageBodyText: opts.pageBodyText ?? null,
        evidenceText: opts.evidenceText ?? proposal.evidence.hints.join(" "),
        authoritativeFacts: opts.authoritativeFacts,
        nowYear: (opts.now ?? new Date()).getFullYear(),
      })
    : { entailed: true, violations: [], corrections: [], findings: [] };

  // ── draft-quality gate (generic/thin/relevance/source-authority) ────────────
  let quality: DraftQualityResult;
  if (change.kind === "existing_edit") {
    quality = evaluateTitleMetaQuality({
      before: change.before,
      after: change.after,
      field: change.field,
      query,
      contextTokens: opts.contextTokens,
      pageBodyText: opts.pageBodyText,
      evidenceText: opts.evidenceText,
      authoritativeFacts: opts.authoritativeFacts,
      sources: opts.sources,
      authoritativeSourceDomains: opts.authoritativeSourceDomains,
    });
  } else {
    // UNREACHABLE at decision generation 5: nothing proposes a new page, and the
    // drafter that wrote page briefs is deleted. A brief arriving here would be a bug,
    // so it fails closed instead of being quality-checked into the queue. The variant
    // itself stays on the contract because stored rows must still decode.
    quality = { status: "malformed", reasons: ["I do not draft new pages right now, so I am not putting this in front of you."],
      copyAllowed: false, canRegenerate: false, confidence: "high" };
  }

  // ── compose the single verdict ──────────────────────────────────────────────
  const reasons: string[] = [...quality.reasons];
  const factViolations = entail.violations;
  const corrections = entail.corrections;

  let verdict: ProposalVerdict;
  if (safetyFlags.length > 0 || factViolations.length > 0 || REJECT_STATUSES.has(quality.status)) {
    verdict = "rejected";
    reasons.push(...safetyFlags, ...factViolations);
  } else if (quality.status === "ready" && quality.copyAllowed) {
    verdict = "ready";
  } else {
    // useful_but_needs_review / needs_source_check / not_quotable / stale_data_changed
    verdict = "needs_review";
  }

  const status: ProposalValidation["status"] =
    verdict === "ready" ? "proposed" : verdict === "needs_review" ? "needs_review" : "rejected";

  return {
    verdict,
    status,
    qualityStatus: quality.status,
    reasons: [...new Set(reasons)],
    factViolations,
    corrections,
    safetyFlags,
    confidence: quality.confidence,
  };
}
