/**
 * decision/validate-proposal (CORE 100K decision kernel): the ONE
 * validator every ChangeProposal passes through before it can be shown as
 * actionable. It composes the existing, battle-tested safety gates into a
 * single verdict, so there is exactly one place that decides "is this draft
 * safe to put in front of a paying operator":
 *
 *   - draft-quality.ts (evaluateTitleMetaQuality)
 *     covers generic/thin/off-topic/relevance/missing-source/source-authority.
 *   - factual-entailment.ts (checkFactualEntailment): an invented number or
 *     entity with no grounding is a VIOLATION and rejects the draft; a dated,
 *     sourced contradiction of the page is an allowed CORRECTION (surfaced, not
 *     blocked).
 *   - placeholder-detection.ts (looksLikePlaceholder): "[insert X]" / lorem.
 *   - copy-sanitize.ts (containsUuid, plus the SHARED host, autopublish and written-out
 *     proportion nets this file used to keep a smaller private copy of: it knew thirteen public
 *     suffixes where the drafter knew thirty-three, so an invented .wiki address passed both).
 *   - dash ban: no em or en dash ever reaches operator-facing copy.
 *   - destructive-change guard: an "edit" that guts the current value (empties
 *     it or truncates it to a fraction) is never presented as a safe rewrite.
 *
 * The verdict maps to the proposal lifecycle: `ready` becomes proposed, `needs_review`
 * to needs_review, `rejected` to rejected (never shown as ready). PURE, no I/O.
 */

import {
  evaluateTitleMetaQuality,
  type DraftQualityResult,
  type DraftQualityStatus,
} from "@/domains/decision/drafts/draft-quality";
import { checkFactualEntailment, type AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import type { ClassifiableSource } from "@/domains/decision/drafts/source-authority";
import { looksLikePlaceholder } from "./placeholder-detection";
import { containsUuid, AUTOPUBLISH_RE, CODE_SUFFIX, HOST_RE, SPELLED_PROPORTION_RE } from "./copy-sanitize";
import type { BundleComponent, BundleComponentKind, ChangeProposal, ProposalStatus, RecommendedChange } from "./contracts";
import { dangerousComponents, needsSourcePack } from "./contracts";

/** Quality statuses that are HARD failures, never actionable and always rejected.
 *  These are inventions / garbage / off-topic / malformed drafts: unsafe copy.
 *  NOTE the source HOLDS (`missing_source`, `needs_source_check`) are deliberately
 *  NOT here: a factual claim that just needs a citation is a `needs_review` hold
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
  /** Sourced corrections, surfaced WITH the proposal and never blocking. */
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

const NUMBER_RE = /\d[\d,.]*/g;
/** The proposal must say out loud that the operator is the one who publishes it. */
const MANUAL_RE = /\byou\b[^.]{0,80}\bpublish/i;
const digits = (s: string): string => s.replace(/,/g, "").replace(/\.$/, "");

/**
 * THE new-page gate (N4, 2026-07-28). A page brief is not quality-checked like a title
 * rewrite: there is no current value to compare it against and no page body to entail it
 * from. What CAN be checked is that it is a researched page rather than an idea somebody
 * had, so this asks exactly that and rejects everything that cannot show it: the earned
 * verdict it was built from, copy that is about this topic, an outline that is real and not
 * repeated, every component tracing to a receipt item, and no number, address or promise the
 * evidence does not carry. HISTORY FAILS HERE BY CONSTRUCTION: a brief drafted before this
 * contract carries no bundle, so it can never be shown as work. PURE.
 */
function evaluateNewPageBrief(
  proposal: ChangeProposal,
  change: Extract<RecommendedChange, { kind: "new_page" }>,
  evidenceText: string | null,
): DraftQualityResult {
  const bad = (reason: string): DraftQualityResult =>
    ({ status: "malformed", reasons: [reason], copyAllowed: false, canRegenerate: false, confidence: "low" });
  const bundle = proposal.bundle;
  const items = bundle?.receipt.items ?? [];
  // The earned verdict itself, carried as inspectable evidence beside the pages it compared.
  if (!bundle || !items.some((i) => i.key === "verdict" && i.kind === "diagnosis") || bundle.alternatives.length === 0) {
    return bad("I cannot show you the research that proved this page is missing, so I am not putting it in front of you.");
  }
  const keys = new Set(items.map((i) => i.key));
  if (bundle.components.some((c) => c.evidenceKeys.length === 0 || c.evidenceKeys.some((k) => !keys.has(k)))) {
    return bad("Part of this page cannot be traced back to anything I checked, so I am not putting it in front of you.");
  }
  const headings = change.outline.map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (headings.length < 3 || new Set(headings).size !== headings.length) {
    return bad("This page's sections are too thin or repeat each other, so I am not putting it in front of you.");
  }
  const topic = new Set(proposal.primaryQuery.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const about = (t: string): boolean => topic.size === 0 || t.toLowerCase().split(/[^a-z0-9]+/).some((w) => topic.has(w));
  if (![change.proposedTitle, change.metaDescription, change.openingAnswer].every((t) => t.trim().length > 0 && about(t))) {
    return bad("This page's title, description or opening does not say what the page is about, so I am not putting it in front of you.");
  }
  const grounding = [evidenceText ?? "", ...items.map((i) => i.fact), ...proposal.evidence.hints].join(" ").toLowerCase();
  const copy = [...operatorFacingText(proposal), ...bundle.components.map((c) => c.after)].join(" ");
  if (AUTOPUBLISH_RE.test(copy) || SPELLED_PROPORTION_RE.test(copy) || proposal.publish !== "manual" || !MANUAL_RE.test([proposal.whyItMatters, ...bundle.risks].join(" "))) {
    return bad("This page does not say plainly that you are the one who publishes it, so I am not putting it in front of you.");
  }
  const grounded = new Set((grounding.match(NUMBER_RE) ?? []).map(digits));
  const stray = (copy.match(NUMBER_RE) ?? []).map(digits).find((n) => !grounded.has(n));
  if (stray) return bad(`This page quotes ${stray}, which is not a figure I actually hold, so I am not putting it in front of you.`);
  const strayHost = (copy.match(HOST_RE) ?? []).map((h) => h.toLowerCase()).filter((h) => !CODE_SUFFIX.test(h)).find((h) => !grounding.includes(h));
  if (strayHost) return bad(`This page names ${strayHost}, which is not a site I actually looked at, so I am not putting it in front of you.`);
  // Everything this gate can check is checked. The caution a brand new page deserves rides
  // on the bundle's own risks, where the operator reads it, not as a held status.
  return { status: "ready", reasons: [], copyAllowed: true, canRegenerate: true, confidence: "medium" };
}

/**
 * THE COMPONENT GATE (Phase 4). The seven original kinds are grandfathered exactly as
 * they stand, so every persisted bundle still validates. Every kind the complete change
 * universe added has to answer for itself before it can be shown as work:
 *   - it cites at least one receipt item (a component with no evidence is never emitted);
 *   - it says WHERE on the page it lands, WHAT it achieves, WHY that lever moves the
 *     diagnosed cause, and WHAT I will measure afterwards;
 *   - a change to factual content carries a source pack, because a corrected fact with
 *     nothing behind it is worse than the stale one it replaced;
 *   - a dangerous kind is marked dangerous, so it cannot slip through as a safe paste.
 * Returns operator-facing reasons, never validator vocabulary. PURE.
 */
const LEGACY_KINDS: ReadonlySet<BundleComponentKind> =
  new Set<BundleComponentKind>(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack"]);

function componentFailures(components: readonly BundleComponent[]): string[] {
  const out: string[] = [];
  const marked = new Set(components.filter((c) => c.risk === "dangerous"));
  for (const c of components) {
    const what = c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ");
    if (c.evidenceKeys.length === 0) { out.push(`I cannot show you anything behind the ${what}, so I am not putting it in front of you.`); continue; }
    if (needsSourcePack(c) && !c.sourcePack) out.push(`The ${what} changes a fact and carries no sources to check it against, so I am not putting it in front of you.`);
    if (!LEGACY_KINDS.has(c.kind)) {
      const owed = [!c.where && "where on the page it goes", !c.objective && "what it is meant to achieve",
        !c.mechanism && "why it fixes what I diagnosed", !c.measurementPlan && "what I will measure afterwards"].filter((x): x is string => !!x);
      if (owed.length > 0) out.push(`I cannot tell you ${owed.join(", ")} for the ${what}, so I am not putting it in front of you.`);
    }
  }
  // A dangerous lever that was not marked dangerous is a mislabelled change, and a
  // mislabelled change is exactly the one that gets pasted without a second look.
  for (const c of dangerousComponents(components)) {
    if (!marked.has(c)) out.push(`The ${c.label.trim().toLowerCase() || c.kind.replace(/_/g, " ")} changes where this page lives or whether people can find it, and it is not marked as one that needs your confirmation, so I am not putting it in front of you.`);
  }
  return out;
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
  /** The target page's own body text, which turns ON factual entailment. */
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

  // ── factual entailment (an invented number or entity is a violation) ────────
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
    quality = evaluateNewPageBrief(proposal, change, opts.evidenceText ?? null);
  }

  // ── the component gate + the two-step hold ──────────────────────────────────
  const components = proposal.bundle?.components ?? [];
  const componentFails = componentFailures(components);
  // THE TWO-STEP CONFIRMATION, in the one vocabulary this product already has: a
  // dangerous component can never read as ready, it is held for the operator to look at
  // and then act. There is no second flag and no second lifecycle.
  const dangerous = dangerousComponents(components);

  // ── compose the single verdict ──────────────────────────────────────────────
  // The two-step note is carried WHATEVER else the verdict turns out to be: the operator
  // has to read it before acting, and burying it behind another hold is how it gets missed.
  const reasons: string[] = [...quality.reasons, ...dangerous.map((c) =>
    `${c.label.trim() || c.kind.replace(/_/g, " ")}: this one changes where the page lives or whether people can find it, so read it once and confirm it before you make the change.`)];
  const factViolations = entail.violations;
  const corrections = entail.corrections;

  let verdict: ProposalVerdict;
  if (safetyFlags.length > 0 || factViolations.length > 0 || componentFails.length > 0 || REJECT_STATUSES.has(quality.status)) {
    verdict = "rejected";
    reasons.push(...safetyFlags, ...factViolations, ...componentFails);
  } else if (dangerous.length > 0) {
    verdict = "needs_review";
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
