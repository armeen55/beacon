/**
 * Act 2 "Why this matters" narrative synthesis (2026-06-16).
 *
 * Ground-truth on the live dev server showed the recommendation detail
 * page's Act 2 ("Why this matters") was too thin: it rendered one short
 * `why` line plus a generic confidence hedge ("Some signals are present,
 * but the picture isn't fully clear yet."), even though the row ALREADY
 * carries rich grounded evidence that only surfaced as separate tiles in
 * Act 3 (the exact search query, the competitor's share, on-page
 * friction, the answer-engine gap).
 *
 * This module synthesizes a SPECIFIC, grounded, multi-sentence "why this
 * matters" from the evidence the row already has — so it reads like a
 * professional SEO's analysis, not a one-liner. It NEVER invents a number
 * or a claim: every clause is included only when its source data exists.
 *
 * HONESTY + WHITE-LABEL RAILS (mirror the rest of the app):
 *   • Never emit the answer-engine vendor name (says "AI assistants").
 *   • Never claim a number not present in the inputs.
 *   • When NO concrete evidence exists at all, return a single calm
 *     sentence rather than a confident-sounding narrative.
 *   • Never output the "picture isn't fully clear yet" hedge when ANY
 *     concrete evidence is present — the synthesized narrative carries
 *     the conviction; the render layer keeps the honest needs-review
 *     caution for the genuinely-thin case.
 *
 * PURE FUNCTION — no I/O, no React, no persistence, no network, no clock.
 * Same input → same output. The render layer (Act 2) calls this and
 * renders the returned sentences as short stacked paragraphs.
 *
 * INPUT CONTRACT — the caller passes a small explicit object built from
 * locals already in scope on the detail client, NOT the whole row. The
 * `why` field MUST be the value already run through `checkWhyDisplaySafe`
 * so this module introduces no new unguarded text.
 */

import type { ActionRowType } from "./recommendation-action-rows";
import type { EvidenceLine } from "@/domains/recommendation-intelligence/evidence-summary";

export type WhyThisMattersInput = {
  readonly actionType: ActionRowType;
  /** Clean target label ("Whole Home Remodel page" / "Homepage"). */
  readonly targetLabel: string;
  /** The ALREADY-GUARDED `why` string (post `checkWhyDisplaySafe`), or
   *  null. Used only as a fallback lead when no structured demand signal
   *  exists — never re-introduced on top of richer evidence. */
  readonly why: string | null;
  /** Actual tracked prompt queries (display-safe), up to a few. */
  readonly affectedPromptTexts: ReadonlyArray<string>;
  /** Top REAL competitor + their primary share (already display-safe). */
  readonly competitor: { name: string; primaryPct: number } | null;
  readonly gscEvidenceLines: ReadonlyArray<EvidenceLine>;
  readonly semrushEvidenceLines: ReadonlyArray<EvidenceLine>;
  readonly clarityEvidenceLines: ReadonlyArray<EvidenceLine>;
  readonly aeoEvidenceLines: ReadonlyArray<EvidenceLine>;
  readonly promptCount: number;
  readonly observationCount: number;
  readonly derivedConfidence:
    | "strong_evidence"
    | "moderate_evidence"
    | "needs_review";
};

/** Calm fallback when the row carries no concrete evidence at all. */
export const WHY_THIS_MATTERS_EMPTY =
  "Beacon needs more evidence before this should be shipped — use your judgment.";

/** Soft cap so each sentence stays scannable in the brief. */
const MAX_SENTENCE_LEN = 160;

/** Trim a phrase for embedding mid-sentence (e.g. a long search query).
 *  Breaks at the nearest preceding WORD boundary so we never chop a word
 *  in half ("expanding the f…"); only falls back to a hard cut when the
 *  first word alone already exceeds the budget. */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const hard = t.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(" ");
  // Back up to the last word boundary unless that throws away most of the
  // budget (a single very long word) — then hard-cut.
  const cut = lastSpace > Math.floor(max * 0.5) ? hard.slice(0, lastSpace) : hard;
  return cut.trimEnd() + "…";
}

/** Strip wrapping curly/straight quotes the evidence builders add to
 *  `EvidenceLine.value` (e.g. `“persian rugs”`) so we can re-quote the
 *  bare phrase consistently in prose. */
function unquote(value: string): string {
  return value.trim().replace(/^[“"']+/, "").replace(/[”"']+$/, "").trim();
}

/**
 * The specific gap clause an edit closes, derived from the action type +
 * target label. Honest: describes the missing/weak element, never a
 * fabricated metric. Returns null for action types that don't map to a
 * clean "this page is missing X" statement (the demand + competitive
 * clauses already carry those rows).
 */
function gapClauseForAction(
  actionType: ActionRowType,
  targetLabel: string,
): string | null {
  const page = targetLabel;
  switch (actionType) {
    case "add_faq":
      return `Your ${page} has no FAQ answering this directly, which is the format these answers tend to pull from.`;
    case "add_section":
      return `Your ${page} has no section addressing this, which is the angle these answers reward.`;
    case "add_comparison_table":
      return `Your ${page} has no side-by-side comparison for this, which is what buyers at this stage are looking for.`;
    case "edit_h2":
      return `The section heading on your ${page} doesn't speak to this, so it's easy to miss.`;
    case "edit_h1":
      return `The headline on your ${page} doesn't make this clear, so visitors and AI assistants can't tell it's the right page.`;
    case "edit_title":
      return `The title on your ${page} doesn't match how people ask for this, so it earns fewer clicks than it should.`;
    case "edit_meta":
      return `The search-result preview for your ${page} doesn't make the case to click, so demand leaks to other results.`;
    case "improve_copy":
      return `The copy on your ${page} is thin on this, so it doesn't stand out as the best answer.`;
    case "add_schema":
      return `Your ${page} is missing the structured details search engines use to understand and feature it.`;
    case "add_internal_links":
      return `Your ${page} isn't linked from the related pages that would point demand at it.`;
    case "create_page":
      return `You don't have a page built for this yet, so there's nothing for AI assistants to recommend.`;
    case "technical_fix":
    case "review_decision":
    case "regenerate_edit":
      return null;
  }
}

/** Push a sentence onto the list, clipped to the soft cap. Skips empties. */
function pushSentence(out: string[], sentence: string | null | undefined) {
  if (sentence == null) return;
  const s = sentence.trim();
  if (s.length === 0) return;
  out.push(clip(s, MAX_SENTENCE_LEN));
}

/**
 * Compose 1–4 ordered, plain-English sentences synthesizing the rec's
 * reasoning from the evidence it already carries.
 *
 * Compose order (a clause is included ONLY when its data exists):
 *   (a) demand / gap lead
 *       - GSC or SEMrush line present → lead with the search-demand fact.
 *       - else AEO line present → the white-label answer-engine gap fact.
 *       - else affected prompts present → "When AI assistants answer …".
 *       - else the already-guarded `why` string.
 *   (b) competitive pressure — when a competitor is present.
 *   (c) the specific gap the edit closes — from actionType + targetLabel.
 *   (d) behavior — on-page friction fact, when Clarity lines exist.
 *
 * Returns the calm fallback (one sentence) when no concrete evidence of
 * any kind is present.
 */
export function composeWhyThisMatters(input: WhyThisMattersInput): string[] {
  const out: string[] = [];

  const gsc = input.gscEvidenceLines[0] ?? null;
  const semrush = input.semrushEvidenceLines[0] ?? null;
  const aeo = input.aeoEvidenceLines[0] ?? null;
  const clarity = input.clarityEvidenceLines[0] ?? null;
  const hasPrompts = input.affectedPromptTexts.length > 0;

  // Whether any CONCRETE grounding exists — drives both the fallback
  // decision and (in the render layer) the hedge-suppression contract.
  const hasConcreteEvidence =
    gsc != null ||
    semrush != null ||
    aeo != null ||
    clarity != null ||
    hasPrompts ||
    input.competitor != null ||
    input.observationCount > 0 ||
    input.promptCount > 0;

  if (!hasConcreteEvidence) {
    // No grounding at all — one calm sentence. If a guarded `why` exists
    // it's still safe to surface (it's already been through the guard),
    // but the calm fallback is the honest default.
    const why = input.why?.trim();
    return [why && why.length > 0 ? clip(why, MAX_SENTENCE_LEN) : WHY_THIS_MATTERS_EMPTY];
  }

  // ── (a) demand / gap lead ──────────────────────────────────────────
  if (gsc != null) {
    // The GSC builder's `detail` is already a full "why now" sentence
    // (exact query + times shown + rank + click-through + recoverable).
    pushSentence(out, gsc.detail ?? `${unquote(gsc.value)} — ${gsc.label}.`);
  } else if (semrush != null) {
    pushSentence(out, semrush.detail ?? `${unquote(semrush.value)} — ${semrush.label}.`);
  } else if (aeo != null) {
    // White-label: the AEO builder's detail already says "AI assistants"
    // and never names the vendor.
    pushSentence(
      out,
      aeo.detail ??
        "AI assistants answer this topic citing a rival, and you're not cited yet.",
    );
  } else if (hasPrompts) {
    // Keep the embedded query short enough that the wrapper sentence
    // ("When AI assistants answer “…”, they don't currently recommend your
    // site.", ~71 chars of chrome) stays under MAX_SENTENCE_LEN without the
    // outer clip chopping the meaningful tail.
    const query = clip(input.affectedPromptTexts[0]!, 70);
    pushSentence(
      out,
      `When AI assistants answer “${query}”, they don't currently recommend your site.`,
    );
  } else if (input.why && input.why.trim().length > 0) {
    pushSentence(out, input.why);
  }

  // ── (b) competitive pressure ───────────────────────────────────────
  // Skip when the AEO line already carried the competitor narrative
  // (its detail says "citing a rival") to avoid a redundant clause.
  if (input.competitor != null && aeo == null) {
    const pct = Math.round(input.competitor.primaryPct * 100);
    if (hasPrompts || input.observationCount > 0) {
      pushSentence(
        out,
        `${input.competitor.name} shows up in ${pct}% of those answers.`,
      );
    } else {
      pushSentence(
        out,
        `${input.competitor.name} is cited in ${pct}% of the AI answers Beacon analyzed for this topic.`,
      );
    }
  }

  // ── (c) the specific gap the edit closes ───────────────────────────
  pushSentence(out, gapClauseForAction(input.actionType, input.targetLabel));

  // ── (d) behavior / on-page friction ────────────────────────────────
  if (clarity != null) {
    pushSentence(out, clarity.detail ?? `${clarity.value} ${clarity.label}.`);
  }

  // Cap at 4 sentences; preserve compose order.
  const sentences = out.slice(0, 4);

  // Defensive: if every clause turned out empty (shouldn't happen given
  // the hasConcreteEvidence gate), fall back to the calm sentence.
  if (sentences.length === 0) {
    return [WHY_THIS_MATTERS_EMPTY];
  }
  return sentences;
}
