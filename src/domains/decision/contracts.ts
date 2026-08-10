/** decision/contracts (CORE 100K decision kernel): the ONE input and the ONE output of the
 * recommendation-intelligence collapse. The kernel turns exactly one normalized `EvidenceInput` (a small
 * structural interface this module OWNS) into a ranked, exact, safe `ChangeProposal`: the page, the opportunity, the frozen evidence that grounds it, the exact change, why it matters,
 * effort/risk/confidence/limitations, the ranking receipt, and the proposal status. PUBLISHING AUTHORITY IS MANUAL. Nothing here writes to a live page; `publish: "manual"` is a structural
 * reminder carried on every proposal. PURE: types + Zod schema + pure derivations + (de)serialization only,
 * no I/O. Proposal PATHS (propose.ts) and PERSISTENCE (proposal-store.ts) are siblings.
 */

import { z } from "zod";
import type { AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
// TYPE ONLY (erased at compile, no runtime edge). The cause ladder owns the cause vocabulary; this contract carries it rather than keeping a second copy that could drift.
import type { CauseFinding } from "./diagnosis";

// ── EvidenceInput: the ONE normalized input the kernel consumes ───────────────

/** The demand + page context for one opportunity. Structural on purpose: the  evidence assembler owns HOW these are computed, the kernel only consumes them. */
export interface EvidenceInput {
  tenantId: string;
  /** The page the change lands on. `path` null = a brand-new page opportunity. */
  page: { path: string | null; url: string | null; label: string };
  opportunity: {
    /** The primary demand phrase behind this opportunity. */
    query: string;
    /** Which proposal path this evidence routes to. */
    kind: ProposalKind;
    /** Operator-facing label ("Capture clicks", "Win AI citations", ...). */
    opportunityType: string;
    /** For an existing-page edit: which field to rewrite, and its current value. */
    field?: "title" | "meta";
    currentValue?: string | null;
    /** The searcher's dominant intent (when/cost/how/where/who/list/compare). */
    intent?: string;
  };
  /** Everything that grounds a safe draft. All optional: the drafter and the  validator degrade honestly when a field is absent. */
  evidence: {
    /** Plain-English facts the team established (GSC demand, a tracked AI prompt). */
    hints?: string[];
    /** The target page's own stored body text: turns ON factual entailment. */
    pageBodyText?: string | null;
    /** The page's section outline (existing-page edit context). */
    outline?: string[];
    /** Dated, sourced facts on file, which back an allowed correction. */
    authoritativeFacts?: AuthoritativeFact[];
    /** This tenant's curated authoritative-source domains. */
    authoritativeSourceDomains?: string[];
    /** THE diagnosis that earned this action. No diagnosis, no drafter call. */
    diagnosis?: ActionDiagnosis;
  };
  /** Honest value sizing for the ranker: recoverable clicks and the honest monthly opportunity midpoint
   *  (never a raw impressions sum). A missing figure makes the ranking directional rather than inventing one. */
  sizing?: { impactScore?: number | null; upsidePerMonth?: number | null };
}

// ── Candidate diagnosis (decision truth replacement, 2026-07-27) ──────────────

/** What the evidence actually justifies for one page or topic, decided BEFORE any draft is written. Doing
 *  nothing is the default: a page is not a problem because it is big. Only the two `act_` outcomes may become
 *  a ChangeProposal; the rest are the honest answer and live in the run receipt, never manufactured work.  Internal to Decision: NOT persisted as its own record and never a public type. */
type CandidateAction =
  // No `act_new_page`: a page this account does not own is decided by the coverage ladder
  // over researched TOPICS, never by this per-page diagnosis over pages it already has.
  | "act_existing_page" | "consolidate"
  | "watch" | "research_needed" | "do_nothing";

/** The ONE action-specific gap that earns an action. Gross impressions are not here. */
type CandidateGap = "ctr_deficit" | "recent_decline" | "serp_mismatch" | "ai_gap" | "technical";

export type DecisionCandidate = {
  action: CandidateAction;
  /** Required for every `act_` outcome; absent means nothing was proven. */
  gap?: CandidateGap;
  pageUrl?: string | null;
  /** The EXACT query the gap was measured on (never a page total). */
  query?: string | null;
  /** Clicks a fix could plausibly recover, from exact query metrics. Ranks  opportunity: a huge page with no deficit ranks below a small real gap. */
  recoverableClicks: number;
  /** Plain-English why, carrying the exact numbers the receipt will show. */
  reason: string;
};

/** Action floors. A gap under ANY of these is not worth the operator's attention, so the honest answer is
 *  watch/do_nothing. Tuned against real data: a healthy page whose best gap was 23 clicks must not act. */
export const MIN_QUERY_IMPRESSIONS = 500;
export const MIN_CTR_DEFICIT = 0.02;
export const MIN_RECOVERABLE_CLICKS = 50;

/** EVIDENCE READINESS (evidence-qualified changes, 2026-07-27). A click gap proves something is WRONG. It
 *  never proves WHAT TO CHANGE: the same gap is explained by a weak title, a search feature eating the click,
 *  the wrong page ranking, an ambiguous query, or nothing at all. So a gap opens an INVESTIGATION, and only  the exact evidence below can close it into an action. */
export type EvidenceReadiness = {
  /** Exact GSC rows for this query on this page. */
  gsc: boolean;
  /** The page's current title and description, the thing an edit would replace. */
  ownedCopy: boolean;
  /** A live results page observed for the EXACT candidate query, not a neighbour. */
  serp: boolean;
  /** Inspectable extracts of pages that actually rank or are cited FOR that query. */
  winners: number;
  /** The page's own WORDS beyond its title, so a claim about it can be checked. No body  store exists yet, so this is false everywhere today and High confidence on an edit
   *  is currently unreachable. That is the truth, not a gap to paper over. */
  body: boolean;
};

/** EVIDENCE COMPLETENESS ONLY: do I hold the things a diagnosis would need to read? A precondition, NEVER a
 *  permission to act. Holding a results page is not knowing what it says (a live counterexample: Google
 *  already displayed this page's title with the searcher's exact words). ActionDiagnosis decides Ready. */
export function evidenceComplete(r: EvidenceReadiness): boolean { return r.gsc && r.ownedCopy && r.serp; }

/** WHY this page underperforms, in the vocabulary a diagnosis may conclude in. One cause  per candidate, chosen by reading the evidence, never by token containment. */
type DiagnosisCause =
  | "snippet_intent_mismatch" | "weak_value_promise" | "result_format_mismatch"
  | "wrong_page_ranking" | "cannibalization" | "content_coverage_gap" | "stale_or_inaccurate_copy"
  | "google_rewrite_already_matches" | "serp_market_mismatch" | "ambiguous_search_intent" | "unknown";

/** The single edit a diagnosed cause supports. `watch` and null are real answers. */
export type DiagnosedAction =
  | "title" | "meta" | "opening_answer" | "section"
  | "full_page" | "new_page" | "consolidate" | "watch";

/** THE reasoning step between "this page underperforms" and "change this", held inside the existing candidate
 *  and receipt path. `diagnosed` means the evidence NAMES a cause, the action follows from it, a competing
 *  explanation is ruled out with its own evidence, and every claim cites receipt keys. Anything else is  `inconclusive`: still under investigation, no draft spend. */
export type ActionDiagnosis = {
  status: "diagnosed" | "inconclusive";
  cause: DiagnosisCause;
  action: DiagnosedAction | null;
  /** Receipt item keys backing the cause. Empty = nothing may be claimed. */
  evidenceKeys: string[];
  alternativesRuledOut: Array<{ alternative: string; reason: string; evidenceKeys: string[] }>;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
};

/** A change is Ready only for a DIAGNOSED action naming a real edit. Completeness alone never earns it. */
export function readyForAction(d: ActionDiagnosis | null | undefined): boolean {
  return !!d && d.status === "diagnosed" && d.action != null && d.action !== "watch"
    && d.evidenceKeys.length > 0 && d.alternativesRuledOut.length > 0;
}

/** Confidence follows EVIDENCE COMPLETENESS, never how the draft reads: a proposal that admits it never saw  the results page cannot be high confidence. */
export function confidenceFor(r: EvidenceReadiness, d?: ActionDiagnosis | null): ChangeProposal["confidence"] {
  if (!evidenceComplete(r) || (d !== undefined && !readyForAction(d))) return "low";
  return r.winners >= 2 && r.body ? "high" : "medium";
}

// ── ChangeProposal: the ONE persisted output ──────────────────────────────────

/** `new_page` is earned: only the page by page comparison proves this account reaches none of what the winners share. */
export type ProposalKind = "existing_edit" | "new_page";

/** THE STORED LIFECYCLE, in the operator's own words. `needs_review` = I want a human look first, and it is
 *  also THE two-step hold a dangerous component routes through. `ready` = validated safe, exact copy, act
 *  now. `implemented_pending_verification` = they say they made the change and I have not read their page
 *  yet. `measuring` and `result` are DERIVED from the shipment ledger, never stored twice. A draft a safety
 *  gate refused never enters this lifecycle: it is withdrawn. A proposal is NEVER an auto-write. */
export type ProposalStatus = "needs_review" | "ready" | "implemented_pending_verification";

export type ProposalRisk = "low" | "medium" | "high";
export type ProposalConfidence = "high" | "medium" | "low";

/** The exact change: `existing_edit` carries a precise before/after field rewrite, `new_page` a build brief. */
export type RecommendedChange =
  | { kind: "existing_edit"; field: "title" | "meta" | "h1" | "answer_block" | "section";
      before: string | null; after: string }
  | { kind: "new_page"; proposedTitle: string; metaDescription: string; openingAnswer: string;
      outline: string[]; faqQuestions: string[]; schemaTypes: string[] };

/** A compact, frozen copy of what grounded this proposal, never a live handle: enough for the operator to
 *  see why Beacon recommends it and for the validator to re-run on load. `evidenceRefCount` is the draft's. */
export type ProposalEvidence = { query: string; hints: string[]; evidenceRefCount: number };

// ── ChangeBundle: the atomic components implemented together on one page ──────
// A bundle rides ON a ChangeProposal: the proposal stays the one persisted, ranked,
// validated record and the bundle is its deep, copy-ready form. Never a second
// pipeline, never a second status vocabulary.

/** THE COMPLETE CHANGE UNIVERSE (Phase 4): every lever Beacon may recommend on one page, named once. ADDITIVE
 *  ONLY, so every stored bundle still decodes, and never CMS-specific: WHAT to change and WHERE, not which editor. */
export type BundleComponentKind =
  | "title" | "meta" | "h1" | "opening_answer" | "section" | "internal_links" | "source_pack"
  | "paragraph_correction" | "section_add" | "section_remove" | "section_rewrite" | "restructure"
  | "full_rewrite" | "factual_correction" | "source_update" | "entity_expansion" | "table_or_list_add"
  | "internal_link_add" | "internal_link_remove" | "anchor_text" | "schema" | "canonical"
  | "redirect" | "noindex" | "consolidation" | "navigation" | "new_page";

/** The kinds that change where a page LIVES or whether it is findable at all. A mistake here costs traffic a  title rewrite never could, so each is `dangerous` and rides the hold below. */
export const DANGEROUS_COMPONENT_KINDS: ReadonlySet<BundleComponentKind> =
  new Set<BundleComponentKind>(["canonical", "redirect", "noindex", "consolidation"]);

/** Claims where being wrong hurts a reader, not a ranking. */
const HIGH_STAKES_CLAIM = /\b(law|legal|lawyer|attorney|court|statute|regulation|licen[cs]|liabilit|medical|medicine|doctor|clinical|diagnos|dosage|drug|symptom|treatment|patient|financial|finance|tax|taxes|loan|mortgage|interest rate|investment|insurance|refund|warrant)/i;

/** Kinds whose copy asserts something a reader could act on, so a source pack is owed. */
const FACTUAL_KINDS: ReadonlySet<BundleComponentKind> = new Set<BundleComponentKind>(
  ["factual_correction", "paragraph_correction", "source_update", "entity_expansion", "table_or_list_add"]);

/** One exact, copy-ready component. Every component cites the receipt items that justify it; a component
 * without evidence is never emitted. `before` is THE CURRENT STATE exactly as it stands, and null means I did
 * not capture it, never a value invented to fill the field. `after` is THE PROPOSAL: exact copy, or the exact
 * structural instruction when the change is not a sentence. The fields after `risk` are optional in the TYPE
 * so every persisted row still decodes, and REQUIRED by validate-proposal for every kind Phase 4 added.
 */
export type BundleComponent = {
  kind: BundleComponentKind;
  /** Operator-facing label ("Page title", "Opening answer", ...). */
  label: string;
  before: string | null;
  after: string;
  /** Keys into receipt.items that justify this component (>= 1). */
  evidenceKeys: string[];
  /** review = touches facts and deserves a human look. dangerous = moves or hides the page, held for confirmation. */
  risk: "safe" | "review" | "dangerous";
  /** WHERE on the page this lands. CMS-independent: a place on the page, never a field in an editor. */
  where?: string;
  /** What applying this one component achieves, in one sentence. */
  objective?: string;
  /** WHY this lever moves the diagnosed cause, in one sentence. */
  mechanism?: string;
  /** Required whenever this changes factual content: the shape the drafter emits and source_pack renders. */
  sourcePack?: { sourceRequirements: string[]; factRequirements: string[] };
  /** THE NEW WORDS ON A LINK (`anchor_text`) and THE ADDRESS A FORWARD MUST LAND ON (`redirect`): the live check needs both exactly, because reading the destination back out of the instruction found the address being MOVED and graded a correct forward as a wrong one. */
  anchorAfter?: string; redirectTo?: string;
  /** One sentence naming the metric and the window Beacon will read afterwards. */
  measurementPlan?: string;
  /** THE PRESERVATION MAP, owed by any component that REPLACES a page rather than adding to it (`full_rewrite`
   *  today). `keeps` are the held sections, facts and links that survive into the draft; `losses` are the
   *  named things it drops, each with the one sentence why. A rebuild that drops a held section and cannot
   *  name it is REJECTED by validate-proposal: no ranking section leaves without being named out loud. */
  preserves?: { keeps: string[]; losses: Array<{ what: string; why: string }> };
};

/** KEEP / CHANGE / ADD / REMOVE, for one existing page, in one place. A bundle used to hand over components
 *  and leave the operator to work out what the change LEFT ALONE, which is most of their page. Every planned
 *  component says whether it changes something that is there or adds something that is not; `keeps` names the
 *  held sections this change deliberately does not touch; `removes` exists only where a component genuinely
 *  replaces something. A new page has no plan: there is nothing yet to keep. */
export type ComponentPlan = {
  entries: Array<{ kind: BundleComponentKind; label: string; disposition: "change" | "add" }>;
  keeps: string[];
  removes: Array<{ what: string; why: string }>;
};

/** PURE: does this component change factual content, so a source pack is owed? */
export function needsSourcePack(c: BundleComponent): boolean { return FACTUAL_KINDS.has(c.kind); }

/** THE STABLE NAME OF ONE PIECE INSIDE ITS BUNDLE: position plus kind, derived from the stored bundle and
 *  nothing else, so no schema moves. Two pieces of one kind are ticked apart instead of sharing one state, and
 *  the server intersects what the operator says they applied against what it holds, never a list of kinds a
 *  hand-made request could invent. */
export const componentIdOf = (component: { kind: string }, index: number): string => `${index}:${component.kind}`;

/** THE TWO-STEP HOLD. There is no parallel confirmation flag in this product: `needs_review` means Beacon
 *  will not present the change as ready and the operator has to look and then act. */
export function dangerousComponents(components: readonly BundleComponent[]): BundleComponent[] {
  return components.filter((c) => c.risk === "dangerous" || DANGEROUS_COMPONENT_KINDS.has(c.kind)
    || (c.kind === "factual_correction" && HIGH_STAKES_CLAIM.test(`${c.before ?? ""} ${c.after}`)));
}

/** One piece of canonical evidence the bundle used, in plain English. `key` is stable within the bundle and cited by BundleComponent.evidenceKeys; `fact` carries no raw id; `observedAt` null = undated aggregate. */
export type BundleEvidenceItem = {
  key: string;
  kind: "gsc_demand" | "keyword" | "serp" | "ai_observation" | "winning_page" | "page_extract" | "competitor" | "internal_link" | "diagnosis";
  fact: string;
  observedAt: string | null;
  observationId?: string; // EXCLUSIVE with `observationIds`: the ONE stored observation a single-answer item was read from, so the chain back to the answer is a lookup
  observationIds?: string[]; // a fact SEVERAL answers stand behind names EVERY one of them, deduplicated and sorted where it is built, so no arbitrary member ever stands in for the set. Never both fields, so no reader picks which is true
};

export type ChangeBundle = {
  /** What applying this bundle achieves, in one sentence. */
  objective: string;
  /** The one metric Beacon will watch afterward. */
  metric: string;
  /** The demand scope: real queries and (when present) tracked prompt texts. */
  scope: { queries: string[]; prompts: string[] };
  /** >= 1 evidence-justified components with exact copy. */
  components: BundleComponent[];
  /** What this change keeps, changes, adds and removes on the page. Absent on a new page and on every
   *  pre-plan persisted row, which is honest: no plan is not an empty plan. */
  plan?: ComponentPlan;
  /** `missing` is evidence Beacon looked for and honestly does NOT have. */
  receipt: { items: BundleEvidenceItem[]; missing: string[]; freshestObservedAt: string | null };
  /** What else was considered and why it lost. */
  alternatives: { option: string; reason: string }[];
  /** Plain-English destructive/factual risk notes. */
  risks: string[];
  confidenceReasons: string[];
  /** What Beacon will measure once the operator applies the bundle. */
  measurementPlan: string;
};

export type ChangeProposal = {
  /** Stable identity: `${tenantId}::${pageKey}::${kind}::${field|new_page}`. */
  id: string;
  tenantId: string;
  kind: ProposalKind;
  /** Page identity. `pagePath` null exactly when kind === "new_page". */
  pagePath: string | null;
  pageUrl: string | null;
  pageLabel: string;
  /** The demand phrase behind this proposal. */
  primaryQuery: string;
  /** Operator-facing opportunity label. */
  opportunityType: string;
  /** Coarse change family (meta|title|h1|answer|new_page|...) for identity/UI. */
  changeFamily: string;
  status: ProposalStatus;
  /** The exact, cold-generated change. */
  recommendedChange: RecommendedChange;
  /** One plain-English sentence: why this matters. */
  whyItMatters: string;
  /** WHERE THIS HAPPENS AND WHAT TO DO, in order, so a copy-ready line is not a puzzle. Absent on a row nobody
   *  wrote steps for, which reads exactly as it always did: no steps is not an empty list of steps. */
  operatorSteps?: string[];
  estimatedEffortMinutes: number;
  riskLevel: ProposalRisk;
  confidence: ProposalConfidence;
  /** Honest caveats carried WITH the proposal: the draft's own risks, any validator caution, the "no baseline
   *  yet" note. */
  limitations: string[];
  evidence: ProposalEvidence;
  /** Honest value sizing for the ranker (may be null, never fabricated). */
  impactScore: number | null;
  upsidePerMonth: number | null;
  /** The deep copy-ready form (Slice 7). Absent on atomic proposals and pre-bundle rows; ONE decoder serves both. */
  bundle?: ChangeBundle;
  /** The onboarding/research basis this proposal was generated under. A proposal whose basis is not the
   *  account's CURRENT basis is WITHHELD at load, never deleted. Absent on pre-basis rows, which read stale. */
  basis?: string;
  /** THE CAUSE the ladder named, so the ranker can ask whether this change's levers address it. Absent when
   *  nothing was diagnosed; an unrecognised value on a hand-edited row matches no lever and is discounted nothing. */
  diagnosisCause?: CauseFinding["cause"];
  /** THE WHOLE REASONING STEP, carried so the operator can read it: the explanation, what it beat, what would
   *  disprove it, and every cause whose evidence is not on file. Absent on an unjudged row. */
  causeFinding?: CauseFinding;
  /** WHY THIS SITS WHERE IT SITS. Stamped by the ONE ranker at ranking time, never by a producer, and absent
   *  on a row nobody has ranked yet. Each factor names the input it read and contributes a bounded amount, so
   *  the order is inspectable and no factor can quietly dominate. `directional` is true when no proven click
   *  figure backed the value factor, and `basis` then says so out loud. */
  rankingReceipt?: {
    score: number;
    factors: Array<{ name: string; input: string; contribution: number; max: number }>;
    directional: boolean;
    basis: string;
  };
  /** One plain sentence comparing this proposal to the one ranked directly below it,
   *  naming the factor that actually separated them. Absent on the last row. */
  whyRankedAboveNext?: string;
  /** STRUCTURAL: this is a proposal. The kernel never writes a live page. */
  publish: "manual";
  createdAt: string;
};

// ── Zod schema (re-validate on every load; reject tampered/legacy rows) ────────

const RecommendedChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing_edit"), field: z.enum(["title", "meta", "h1", "answer_block", "section"]),
    before: z.string().nullable(), after: z.string().min(1) }),
  z.object({ kind: z.literal("new_page"), proposedTitle: z.string().min(1), metaDescription: z.string().min(1),
    openingAnswer: z.string().min(1), outline: z.array(z.string()), faqQuestions: z.array(z.string()),
    schemaTypes: z.array(z.string()) }),
]);

const KIND_SCHEMA = z.enum(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack",
  "paragraph_correction", "section_add", "section_remove", "section_rewrite", "restructure",
  "full_rewrite", "factual_correction", "source_update", "entity_expansion", "table_or_list_add",
  "internal_link_add", "internal_link_remove", "anchor_text", "schema", "canonical", "redirect",
  "noindex", "consolidation", "navigation", "new_page"]);
const NAMED_SCHEMA = z.array(z.object({ what: z.string().min(1), why: z.string().min(1) }));

const ChangeBundleSchema: z.ZodType<ChangeBundle> = z.object({
  objective: z.string().min(1),
  metric: z.string().min(1),
  scope: z.object({ queries: z.array(z.string()), prompts: z.array(z.string()) }),
  components: z.array(z.object({
    kind: KIND_SCHEMA,
    label: z.string().min(1),
    before: z.string().nullable(),
    after: z.string().min(1),
    evidenceKeys: z.array(z.string().min(1)).min(1),
    risk: z.enum(["safe", "review", "dangerous"]),
    where: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
    mechanism: z.string().min(1).optional(),
    sourcePack: z.object({ sourceRequirements: z.array(z.string()), factRequirements: z.array(z.string()) }).optional(),
    measurementPlan: z.string().min(1).optional(), redirectTo: z.string().min(1).optional(), anchorAfter: z.string().min(1).optional(),
    preserves: z.object({ keeps: z.array(z.string()), losses: NAMED_SCHEMA }).optional(),
  })).min(1),
  plan: z.object({ keeps: z.array(z.string()), removes: NAMED_SCHEMA,
    entries: z.array(z.object({ kind: KIND_SCHEMA, label: z.string().min(1), disposition: z.enum(["change", "add"]) })) }).optional(),
  receipt: z.object({
    items: z.array(z.object({ key: z.string().min(1), fact: z.string().min(1), observedAt: z.string().nullable(), observationId: z.string().optional(), observationIds: z.array(z.string().min(1)).min(1).optional(), // the WHOLE support survives the round trip, or persistence quietly turns an aggregate back into one answer's word
      kind: z.enum(["gsc_demand", "keyword", "serp", "ai_observation", "winning_page", "page_extract", "competitor", "internal_link", "diagnosis"]) }).refine((i) => !(i.observationId && i.observationIds), { message: "one_answer_or_several_never_both" })),
    missing: z.array(z.string()),
    freshestObservedAt: z.string().nullable(),
  }),
  alternatives: z.array(z.object({ option: z.string().min(1), reason: z.string().min(1) })),
  risks: z.array(z.string()),
  confidenceReasons: z.array(z.string()),
  measurementPlan: z.string().min(1),
}).superRefine((b, ctx) => {
  // Referential integrity: unproven copy is never served, so every component must cite receipt items that exist.
  const keys = new Set(b.receipt.items.map((i) => i.key));
  for (const c of b.components) for (const k of c.evidenceKeys) {
    if (!keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `component ${c.kind} cites missing evidence ${k}` });
  }
}) as z.ZodType<ChangeBundle>;

export const ChangeProposalSchema: z.ZodType<ChangeProposal> = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  kind: z.enum(["existing_edit", "new_page"]),
  pagePath: z.string().nullable(),
  pageUrl: z.string().nullable(),
  pageLabel: z.string(),
  primaryQuery: z.string(),
  opportunityType: z.string(),
  changeFamily: z.string(),
  status: z.enum(["needs_review", "ready", "implemented_pending_verification"]),
  recommendedChange: RecommendedChangeSchema,
  whyItMatters: z.string(),
  operatorSteps: z.array(z.string().min(1)).optional(),
  estimatedEffortMinutes: z.number(),
  riskLevel: z.enum(["low", "medium", "high"]),
  confidence: z.enum(["high", "medium", "low"]),
  limitations: z.array(z.string()),
  evidence: z.object({ query: z.string(), hints: z.array(z.string()), evidenceRefCount: z.number() }),
  impactScore: z.number().nullable(),
  upsidePerMonth: z.number().nullable(),
  bundle: ChangeBundleSchema.optional(),
  basis: z.string().optional(),
  diagnosisCause: z.string().min(1).optional(),
  causeFinding: z.object({ cause: z.string().min(1), action: z.string().nullable(), evidenceKeys: z.array(z.string()),
    // The reading the cause was decided from, kept whole. Carried opaquely here because the ladder OWNS the
    // per-cause shape; a second copy of that union in this schema is a second thing to keep in step.
    payload: z.unknown().optional(),
    // `fired` separates a second real accusation from a cause checked and ruled out; dropping it on the
    // way to the store turned every stored second accusation into a rejected one on reload.
    competingExplanations: z.array(z.object({ cause: z.string().min(1), reason: z.string().min(1), fired: z.boolean().optional() })),
    falsifier: z.string().min(1), explanation: z.string().min(1),
    notConsidered: z.array(z.object({ cause: z.string().min(1), missing: z.string().min(1) })) })
    .optional() as z.ZodType<CauseFinding | undefined>,
  rankingReceipt: z.object({ score: z.number(), directional: z.boolean(), basis: z.string().min(1),
    factors: z.array(z.object({ name: z.string().min(1), input: z.string().min(1), contribution: z.number(), max: z.number() })) }).optional(),
  whyRankedAboveNext: z.string().min(1).optional(),
  publish: z.literal("manual"),
  createdAt: z.string(),
}) as z.ZodType<ChangeProposal>;

const PERSIST_VERSION = 1 as const;

/** Serialize a proposal for the persistence layer (versioned envelope). */
export function serializeChangeProposal(proposal: ChangeProposal): string { return JSON.stringify({ v: PERSIST_VERSION, proposal }); }

/** Parse + RE-VALIDATE a persisted proposal: a hand-edited row that no longer satisfies the contract can
 *  never be served as a trusted proposal. Fail-soft to null. */
export function deserializeChangeProposal(content: string | null | undefined): ChangeProposal | null {
  try {
    const obj = content ? JSON.parse(content) as { v?: number; proposal?: unknown } : null;
    const res = obj && obj.v === PERSIST_VERSION ? ChangeProposalSchema.safeParse(obj.proposal) : null;
    return res?.success ? res.data : null;
  } catch { return null; }
}

// ── pure derivations (identity, family, effort) ───────────────────────────────

/** The coarse family used for identity + UI. */
export function proposalFamily(input: EvidenceInput): string {
  if (input.opportunity.kind === "new_page") return "new_page";
  const f = (input.opportunity.field ?? "").toLowerCase();
  return f === "title" ? "title" : f === "meta" ? "meta" : "other";
}

/** Stable proposal id from the evidence input. */
export function proposalId(input: EvidenceInput): string {
  const isNew = input.opportunity.kind === "new_page";
  const pageKey = isNew ? `new::${input.opportunity.query.toLowerCase().trim()}` : (input.page.path ?? input.page.url ?? input.page.label).toLowerCase().trim();
  return `${input.tenantId}::${pageKey}::${input.opportunity.kind}::${isNew ? "new_page" : (input.opportunity.field ?? "edit")}`;
}

/** Coarse effort minutes by family (a real per-move figure overrides this). */
export function effortForFamily(family: string): number {
  if (family === "title" || family === "meta" || family === "h1") return 1;
  return family === "answer" ? 3 : family === "new_page" ? 60 : 5;
}
/** WHAT A CHANGE WAS CHECKED AGAINST, in one countable line, readable before anybody opens the receipt. PURE;
 *  lives here rather than the bundle producer so a client card may import it without dragging server modules. */
const CLASS_OF: Record<string, string> = {
  gsc_demand: "your search data", page_extract: "the page as I last read it", keyword: "monthly search counts",
  serp: "the live results page", ai_observation: "AI answers I watched", winning_page: "winning pages I read",
  competitor: "the sites AI hands this to instead of you", internal_link: "links from your own pages",
  diagnosis: "what the results page told me about the cause" };
export const receiptComposition = (items: readonly { kind: string }[]): string => {
  const by = new Map<string, number>();
  for (const it of items) { const c = CLASS_OF[it.kind] ?? it.kind; by.set(c, (by.get(c) ?? 0) + 1); }
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => (n > 1 ? `${c} (${n})` : c));
  return items.length === 0 ? "nothing I can show you" : `${items.length} ${items.length === 1 ? "check" : "checks"}: ${parts.join(", ")}`;
};
