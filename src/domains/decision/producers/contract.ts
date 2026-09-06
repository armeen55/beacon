/**
 * decision/producers/contract (V1 Closure, launch blocker 9): THE ONE SHAPE a cause producer speaks.
 *
 * Beacon names fifteen reasons a page loses a click and, until this directory existed, it could write copy
 * for exactly one of them. Every other cause reached the operator as a sentence and a shrug. A producer is
 * the missing half: it is handed the ladder's finding, the page, its own words, the winners' pattern and a drafter, and it hands back the exact components that fix THAT cause, or an honest refusal.
 *
 * PURE CONTRACT: types only. No I/O, no imports of a store, no model call. Both the core producers and the extended ones speak this and nothing else, so the dispatcher never learns a second vocabulary.
 */

import type { BundleComponent, BundleComponentKind, ChangeBundle, EvidenceReadiness } from "../contracts";
import type { OwnedPageBody } from "@/domains/evidence/pages/owned-context";
// The cause ladder OWNS the cause vocabulary and its finding shape (contracts.ts carries it the same way, by type import), so this file holds no second copy that could drift.
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

/** The drafting jobs a producer may buy, already sanitized, budgeted and cached by the caller. Each
 *  returns null when the model refused, went over budget, or wrote something the gates would not pass:
 *  null is a complete answer and a producer refuses on it rather than shipping an empty component.
 *  A LINK DOOR STOOD HERE AND NOTHING COULD EVER KNOCK ON IT (reviewer, 2026-09-06): `internal_link_weakness` mints no producer at all (producers/core.ts), so the wire in produce-bundle.ts had no caller anywhere in src and still carried an attempt, a refund and a pin for a call nobody could make. The ranked link lane owns that cause and drafts each link through the atomic editor. */
export type ProducerDraft = {
  /** A SECTION IS WRITTEN BY THE ONE CANONICAL EDITOR NOW (2026-08-30), so what comes back is copy that has already declared its claims, named the evidence id behind each one and been ruled on claim by claim; the caller keeps that authorization beside the piece. The old `sources` and `containsNumber` are gone with the second drafter that produced them: a self-declared source label is not provenance and nothing ever read it. */
  section: (input: { query: string; pageLabel: string; heading: string | null; brief: string; outline: string[]; evidenceHints: string[] }) => Promise<{ heading: string; body: string } | null>;
  /** The page's first lines, written through the atomic-edit drafter under its `answer_block` field. OPTIONAL
   *  so a caller that cannot buy one is a refusal rather than a compile error. */
  openingAnswer?: (input: { query: string; pageLabel: string; currentValue: string | null; outline: string[]; evidenceHints: string[] }) => Promise<string | null>;
  /** THE EDITOR, ASKED FOR ONE FIELD ON ONE NAMED PAGE OF THIS ACCOUNT. A change that tells sibling pages apart
   *  writes on every one of their addresses, so each is drafted against ITS OWN stored body and read back by the
   *  same deterministic checks and the same judge. OPTIONAL, so a caller that cannot wire it refuses. */
  pageField?: (input: { field: "title" | "h1" | "answer_block"; body: OwnedPageBody; query: string; brief: string;
    evidenceHints: string[]; minutes: number }) => Promise<{ before: string | null; after: string; anchor: string; heading: string | null; minutes: number } | null>;
};

/** EVERY cause the ladder can name. A producer registry keyed by this is total by construction, so a new
 *  cause cannot be added without somebody deciding, in code, what it produces or why it produces nothing. */
export type CauseKey = CauseFinding["cause"];

/** THE ONE EVIDENCE-REQUIREMENT SHAPE, declared once and imported everywhere (it was structurally redeclared in
 *  three files, which is exactly how two of its kinds shipped with no buyer and the compiler never said so).
 *  `kind` says what to buy, `query` or `url` says exactly which one. Runtime's acquireEvidence must execute every
 *  member of this union: its switch is exhaustive, so adding a kind without an acquisition handler fails typecheck. */
/** `semantic_review` is the one member that buys no new reading: it is the paid evaluator reading copy that is ALREADY final against the sources already banked beside it. It exists because a review that was owed was filed as a `factual_source` acquisition, so the runtime went and bought facts while the reading nobody had taken stayed untaken. */
export type EvidenceRequirement = { kind: "serp" | "page_source" | "competitor_page" | "factual_source" | "semantic_review"; query: string; url?: string; reasonCode: string;
  /** THE MISSING INFORMATION ITSELF, for a factual_source born from a rival comparison: the topic or question the owned page cannot answer today, phrased as the proposition to research. Acquisition researches THIS, never the page's existing claims, and only a checked fact banked for this topic satisfies the requirement; an unrelated stored fact does not. */
  missingTopic?: string;
  /** Where a rival treats that topic, as BRIEFING provenance only: it says why the topic was judged missing, and its copy may never support a claim. */
  rivalUrl?: string;
  /** THE EXACT CHANGE THIS READING IS ABOUT, where the requirement is about one row rather than one search. `semantic_review` reads the words on ONE stored change, so naming it here is what lets the runtime load that single row instead of the whole account's queue. */
  proposalId?: string;
  /** WHAT THIS PURCHASE UNLOCKS: the exact row the money is for and the rung that row is blocked at once the reading lands, in the obligation ladder's own vocabulary. A need travels to the runtime detached from its row, so without this a receipt can say what was bought and never what it was bought FOR, and a landed reading costs a whole re-walk to find the one row it moved. Written where the owed list is minted and a row is in hand, never by the ladder, which is persisted and would rewrite every stored row carrying an evidence need. Absent on a need filed before it existed, and absent is never an excuse to guess. */
  unlocks?: { proposalId: string; step: "draft" | "sections" | "redraft" | "review" | "settle" }; };

/** THE ONE RESOLUTION VOCABULARY for a refused draft, produced by BOTH refusal producers: the deterministic
 *  drafting gates (which run before any model call and often refuse without one) and the model evaluator reading
 *  a finished draft. Cheapest defensible first is the caller's rule, not this type's. `none` is what a PASSING
 *  read carries; a refusal carrying `none` falls to the deterministic ladder rather than being trusted. */
export type DraftResolution = "none" | "structural_synthesis" | "use_stored_verified_evidence"
  | "acquire_serp" | "acquire_page_source" | "acquire_competitor_page" | "acquire_factual_source" | "no_valid_treatment";

/** Everything one producer is allowed to read, all of it already paid for by the pass that called it. */
export type ProducerCtx = {
  finding: CauseFinding;
  primary: string;
  tenantId: string;
  page: { url: string; title: string | null; h1: string | null; outline: string[]; internalLinkCount: number | null };
  /** The page's OWN words, whole. Narrowing this to an opening sample is what left five causes with their
   *  structure computed and thrown away, so nothing here is dropped on the way in. */
  /** The page's held content, whole: headings and passages AS STORED, with the completeness verdict.
   *  A producer asking "does this page already carry X" must ask pageContains, never scan a sample. */
  body: OwnedPageBody | null;
  /** THE ACCOUNT'S OWN PAGE INVENTORY, minus the page under work, bounded by the caller. A producer that has
   *  to name somewhere for a reader to GO NEXT picks from pages this account demonstrably has; picking from
   *  the links the page already carries could only ever propose a second link to a place it already sends
   *  people. Empty is a real answer and the honest refusal that follows it. */
  ownedPages: { url: string; title: string | null; h1: string | null }[];
  /** THE PAGES WHOSE CURRENT WORDS I HOLD, by canonical address. A change that moves content off another page
   *  of this account may name only what it can read there; absent means I hold none but the page under work. */
  heldBodies?: ReadonlyMap<string, OwnedPageBody>;
  /** THE HEADINGS THIS SITE PRINTS ON NEARLY EVERY PAGE: a menu rail, a shop strip, a footer brand line. Furniture
   *  is not content, so a change that moves sections off another page may never name one. Computed by the caller
   *  off the whole inventory (evidence/relevance-gate), because only the whole site can say what is repeated. */
  templateHeadings?: ReadonlySet<string>;
  pattern: WinningPattern | null;
  /** WHO IS ABOVE THIS PAGE on the results page for its own search, in rank order, each carrying its words when
   *  they are on file and nulls when they are not. A fall is explained by what moved past it, so a page nobody
   *  has read is a NAMED, buyable hole rather than a shrug. Empty means no results page for that exact search. */
  ahead?: readonly { url: string; domain: string; rank: number; wordCount: number | null; headings: string[]; openingSample: string | null;
    /** The read of this page was refused with an answer that is FINAL (the publisher's robots said no). A hole that can never be filled is not a reading to require: the requirement mint skips it, or an unreadable winner at position 2 re-mints the same impossible acquisition on every pass forever. */ unreadable?: boolean }[];
  /** The receipt facts, in plain English, as the drafter's grounding. */
  receiptFacts: string[];
  readiness: EvidenceReadiness;
  draft: ProducerDraft;
};

/** What one producer hands back: components that survive the caller's own gates, or one honest sentence
 *  saying why it wrote nothing. Both empty is impossible by construction: no components means a refusal. */
export type Produced = { components: BundleComponent[]; refusal: string | null;
  /** THE EXACT READING THIS CAUSE CANNOT BE TREATED WITHOUT, as data (Codex, 2026-08-23). The refusal sentence beside it is for a person; this is for the runtime, which used to recognise "No results page for X is on file" with a regex and therefore never fetched the one thing that would finish the account's strongest page. */
  requirement?: EvidenceRequirement;
  /** ONE VERDICT PER PAGE THE FINDING NAMED, stamped before any drafting so an address cannot leave the change
   *  by simply failing to appear in `components`. Carried onto the bundle, where completeness reads it. */
  dispositions?: ChangeBundle["dispositions"];
  /** WHAT TO DO, IN ORDER, when the change is a job rather than a paste. A component's `after` is the thing an
   *  operator copies, so instructions inside it become copied text; a change that cannot be pasted puts its
   *  instructions here instead and the surface renders them as steps with no copy button. */
  operatorSteps?: string[];
  /** EVERY LEVER THIS PRODUCER WEIGHED AND DID NOT PICK, in its own words. A producer that can reach for more
   *  than one fix owes the rejections as loudly as the pick, or "add a section" reads as the only thing it
   *  ever considered. They join the change's alternatives, and a refusal carries them to the research card. */
  considered?: { option: string; reason: string }[];
};

export type Producer = (ctx: ProducerCtx) => Promise<Produced>;
