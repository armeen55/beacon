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

import type { BundleComponent, BundleComponentKind, EvidenceReadiness } from "../contracts";
// The cause ladder OWNS the cause vocabulary and its finding shape (contracts.ts carries it the same way,
// by type import), so this file holds no second copy that could drift.
import type { CauseFinding } from "../diagnosis";
import type { WinningPattern } from "../winning-pattern";

/** WHAT A COMPONENT BECOMES ON THE PERSISTED ROW: the ONE field vocabulary a stored change carries, and what
 *  that kind of change actually costs the operator. Every change that was not a reworded line used to be
 *  priced at fifteen minutes, so merging two pages, redirecting one, and rebuilding a page end to end all
 *  read as a quarter of an hour on the screen they plan their morning from. A line is a minute, a section or
 *  a link or a source is a sitting, a section rewrite is half an hour, moving or hiding a page is an
 *  afternoon's care, a full rebuild is a couple of hours. */
type ChangeField = "title" | "meta" | "h1" | "answer_block" | "section";
const FIELD_OF: Partial<Record<BundleComponentKind, ChangeField>> = { title: "title", meta: "meta", h1: "h1",
  opening_answer: "answer_block", section: "section", section_add: "section", section_rewrite: "section" };
const EFFORT_MINUTES: Partial<Record<BundleComponentKind, number>> = { title: 1, meta: 1, h1: 1, anchor_text: 1,
  section_rewrite: 30, restructure: 30, consolidation: 90, redirect: 90, noindex: 90, canonical: 90,
  full_rewrite: 120, new_page: 120 };

/** PURE: the persisted change field one component kind writes into. Anything structural is a section. */
export const fieldForComponent = (kind: BundleComponentKind): ChangeField => FIELD_OF[kind] ?? "section";
/** PURE: the honest minutes one component kind costs the operator. */
export const effortMinutesFor = (kind: BundleComponentKind): number => EFFORT_MINUTES[kind] ?? 15;

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
  /** THE ACCOUNT'S OWN PAGE INVENTORY, minus the page under work, bounded by the caller. A producer that has
   *  to name somewhere for a reader to GO NEXT picks from pages this account demonstrably has; picking from
   *  the links the page already carries could only ever propose a second link to a place it already sends
   *  people. Empty is a real answer and the honest refusal that follows it. */
  ownedPages: { url: string; title: string | null; h1: string | null }[];
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
