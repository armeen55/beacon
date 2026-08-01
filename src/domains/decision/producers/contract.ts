/**
 * decision/producers/contract (V1 Closure, launch blocker 9): THE ONE SHAPE a cause producer speaks.
 *
 * Beacon names fifteen reasons a page loses a click and, until this directory existed, it could write copy
 * for exactly one of them. Every other cause reached the operator as a sentence and a shrug. A producer is
 * the missing half: it is handed the ladder's finding, the page, its own words, the winners' pattern and a
 * drafter, and it hands back the exact components that fix THAT cause, or an honest refusal.
 *
 * PURE CONTRACT: types only. No I/O, no imports of a store, no model call. Both the core producers and the
 * extended ones speak this and nothing else, so the dispatcher never learns a second vocabulary.
 */

import type { BundleComponent, EvidenceReadiness } from "../contracts";
// The cause ladder OWNS the cause vocabulary and its finding shape (contracts.ts carries it the same way,
// by type import), so this file holds no second copy that could drift.
import type { CauseFinding } from "../diagnosis";
import type { WinningPattern } from "../winning-pattern";

/** The two drafting jobs a producer may buy, already sanitized, budgeted and cached by the caller. Each
 *  returns null when the model refused, went over budget, or wrote something the gates would not pass:
 *  null is a complete answer and a producer refuses on it rather than shipping an empty component. */
export type ProducerDraft = {
  section: (input: { query: string; pageLabel: string; heading: string | null; brief: string; outline: string[]; evidenceHints: string[] }) => Promise<{ heading: string; body: string; sources: { kind: string; detail: string }[]; containsNumber: boolean } | null>;
  internalLink: (input: { query: string; sourcePage: string; targetPage: string; topic: string; evidenceHints: string[] }) => Promise<{ anchorText: string; linkSentence: string; reason: string } | null>;
  /** The page's first lines, written through the atomic-edit drafter under its `answer_block` field. OPTIONAL
   *  so a caller that cannot buy one is a refusal rather than a compile error. */
  openingAnswer?: (input: { query: string; pageLabel: string; currentValue: string | null; outline: string[]; evidenceHints: string[] }) => Promise<string | null>;
};

/** EVERY cause the ladder can name. A producer registry keyed by this is total by construction, so a new
 *  cause cannot be added without somebody deciding, in code, what it produces or why it produces nothing. */
export type CauseKey = CauseFinding["cause"];

/** Everything one producer is allowed to read, all of it already paid for by the pass that called it. */
export type ProducerCtx = {
  finding: CauseFinding;
  primary: string;
  tenantId: string;
  page: { url: string; title: string | null; h1: string | null; outline: string[]; internalLinkCount: number | null };
  /** The page's OWN words, whole. Narrowing this to an opening sample is what left five causes with their
   *  structure computed and thrown away, so nothing here is dropped on the way in. */
  body: { openingSample: string | null; cardTexts: string[]; entityNames: string[]; internalLinks: { href: string; anchorText: string }[]; metaDescription: string | null } | null;
  pattern: WinningPattern | null;
  /** The receipt facts, in plain English, as the drafter's grounding. */
  receiptFacts: string[];
  readiness: EvidenceReadiness;
  draft: ProducerDraft;
};

/** What one producer hands back: components that survive the caller's own gates, or one honest sentence
 *  saying why it wrote nothing. Both empty is impossible by construction: no components means a refusal. */
export type Produced = { components: BundleComponent[]; refusal: string | null };

export type Producer = (ctx: ProducerCtx) => Promise<Produced>;
