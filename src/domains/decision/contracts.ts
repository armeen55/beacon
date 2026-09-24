/** decision/contracts: the ONE input and the ONE output of the decision kernel. It turns exactly one normalized `EvidenceInput` into a ranked, exact, safe `ChangeProposal`: the page, the opportunity, the frozen evidence, the exact change, why it matters, effort/risk/confidence/limitations, the ranking receipt and the status. PUBLISHING AUTHORITY IS MANUAL. PURE: types, Zod schema, derivations, no I/O. */
import { z } from "zod";
import { COPY_RULES } from "./copy-sanitize";
import type { AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";
import type { CauseFinding } from "./diagnosis";
import type { Obligation } from "./obligation";
import type { DraftResolution } from "./producers/contract";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
export const EditorAcceptanceSchema = z.object({ pageFit: z.boolean(), usefulAndNatural: z.boolean(), placementCorrect: z.boolean(), resolvesDiagnosis: z.boolean(), implementableNow: z.boolean(), improvesPage: z.boolean(), wouldHandToCustomer: z.boolean(), contested: z.boolean().optional(), notes: z.string().min(1).max(300),
  preservation: z.array(z.object({ text: z.string().min(1), disposition: z.enum(["kept", "corrected", "removed", "moved"]), verified: z.boolean(), reason: z.string().min(1), after: z.string().min(1).nullable(), by: z.array(z.string().min(1)), to: z.string().min(1).nullable(), of: z.string().min(1).optional() })).optional(),
});
const ReviewReceiptSchema = z.object({ editor: EditorAcceptanceSchema.optional(), of: z.string().min(1), version: z.number().int(), claims: z.array(z.object({ i: z.number().int().min(0), by: z.array(z.string()), entailed: z.boolean() })), materialChange: z.boolean().optional(), inputKey: z.string().min(1).optional() });
type ReviewReceipt = Omit<z.infer<typeof ReviewReceiptSchema>, "claims"> & { claims: readonly { i: number; by: readonly string[]; entailed: boolean }[] };
export const PublicationUnitsSchema = z.array(z.union([
  z.object({ kind: z.literal("paragraph"), text: z.string().min(1) }),
  z.object({ kind: z.literal("heading"), level: z.number().int().min(1).max(6), text: z.string().min(1) }),
  z.object({ kind: z.literal("ordered_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("unordered_list"), items: z.array(z.string().min(1)).min(1) }),
  z.object({ kind: z.literal("table"), columns: z.array(z.string().min(1)).min(2).max(8), rows: z.array(z.array(z.string().min(1)).min(2).max(8)).min(1).max(30) }),
])).min(1).superRefine((units, ctx) => { for (const [i, unit] of units.entries()) if (unit.kind === "table") for (const [r, row] of unit.rows.entries()) if (row.length !== unit.columns.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, "rows", r], message: "table rows must match the declared columns" }); });
type PublicationUnits = z.infer<typeof PublicationUnitsSchema>;
const PublicationTargetSchema = z.union([
  z.object({ mode: z.enum(["opening", "whole_body"]), anchorKind: z.null(), anchor: z.null() }),
  z.object({ mode: z.enum(["after_block", "after_section", "under_heading", "replace"]), anchorKind: z.enum(["heading", "passage"]), anchor: z.string().min(1) }),
]).refine((t) => !["after_section", "under_heading"].includes(t.mode) || t.anchorKind === "heading", "Section targets require a heading anchor.");
type PublicationTarget = z.infer<typeof PublicationTargetSchema>;
export interface EvidenceInput {
  tenantId: string;
  page: { path: string | null; url: string | null; label: string };
  opportunity: {
    query: string;
    kind: ProposalKind;
    opportunityType: string;
    field?: "title" | "meta";
    currentValue?: string | null;
    intent?: string;
  };
  evidence: {
    hints?: string[];
    pageBodyText?: string | null;
    outline?: string[];
    authoritativeFacts?: AuthoritativeFact[];
    authoritativeSourceDomains?: string[];
    diagnosis?: ActionDiagnosis;
  };
  sizing?: { impactScore?: number | null; upsidePerMonth?: number | null };
}

/** What the evidence actually justifies for one page or topic, decided BEFORE any draft is written. Doing  nothing is the default: a page is not a problem because it is big. Only the two `act_` outcomes may become a ChangeProposal; the rest are the honest answer and live in the run receipt, never manufactured work.  Internal to Decision: NOT persisted as its own record and never a public type. */
// No `act_new_page`: a page this account does not own is decided by the coverage ladder over researched TOPICS, never by this per-page diagnosis over pages it already has.
type CandidateAction = "act_existing_page" | "consolidate" | "watch" | "research_needed" | "do_nothing";

type CandidateGap = "ctr_deficit" | "recent_decline" | "serp_mismatch" | "ai_gap" | "technical";
export type DecisionCandidate = {
  action: CandidateAction;
  /** Required for every `act_` outcome; absent means nothing was proven. */
  gap?: CandidateGap;
  pageUrl?: string | null;
  query?: string | null;
  /** Clicks a fix could plausibly recover, from exact query metrics. Ranks  opportunity: a huge page with no deficit ranks below a small real gap. */
  recoverableClicks: number;
  reason: string;
};

/** Action floors. A gap under ANY of these is not worth the operator's attention, so the honest answer is watch/do_nothing. Tuned against real data: a healthy page whose best gap was 23 clicks must not act. */
export const MIN_QUERY_IMPRESSIONS = 500;
export const MIN_RECOVERABLE_CLICKS = 16;
/** HOW FAR UNDER ITS OWN CURVE A SEARCH HAS TO SIT, as a share of what that position earns ON THIS ACCOUNT. A flat 0.02 of click rate is a floor only an account near the industry table can  clear: fitted to a site whose best position pays 0.9 percent, a search earning ZERO clicks on 60,000 views sits 0.0035 under its curve, fails a 0.02 bar, and a page that never earns a click is reported as a page with nothing wrong. A share asks the one question that survives both worlds: is this search missing most of what its own position pays? */
export const CTR_DEFICIT_SHARE = 0.4;

/** EVIDENCE READINESS (evidence-qualified changes, 2026-07-27). A click gap proves something is WRONG. It  never proves WHAT TO CHANGE: the same gap is explained by a weak title, a search feature eating the click, the wrong page ranking, an ambiguous query, or nothing at all. So a gap opens an INVESTIGATION, and only  the exact evidence below can close it into an action. */
export type EvidenceReadiness = {
  gsc: boolean;
  ownedCopy: boolean;
  serp: boolean;
  winners: number;
  body: boolean;
};

/** EVIDENCE COMPLETENESS ONLY: do I hold the things a diagnosis would need to read? A precondition, NEVER a  permission to act. Holding a results page is not knowing what it says (a live counterexample: Google already displayed this page's title with the searcher's exact words). ActionDiagnosis decides Ready. */
export function evidenceComplete(r: EvidenceReadiness): boolean { return r.gsc && r.ownedCopy && r.serp; }

/** WHY this page underperforms, in the vocabulary a diagnosis may conclude in. One cause  per candidate, chosen by reading the evidence, never by token containment. */
type DiagnosisCause =
  | "snippet_intent_mismatch" | "weak_value_promise" | "result_format_mismatch"
  | "wrong_page_ranking" | "cannibalization" | "content_coverage_gap" | "stale_or_inaccurate_copy"
  | "google_rewrite_already_matches" | "serp_market_mismatch" | "ambiguous_search_intent" | "unknown";

/** The single edit a diagnosed cause supports. `watch` and null are real answers. */
export type DiagnosedAction = "title" | "meta" | "opening_answer" | "section" | "full_page" | "new_page" | "consolidate" | "watch";

/** THE reasoning step between "this page underperforms" and "change this", held inside the existing candidate  and receipt path. `diagnosed` means the evidence NAMES a cause, the action follows from it, a competing explanation is ruled out with its own evidence, and every claim cites receipt keys. Anything else is  `inconclusive`: still under investigation, no draft spend. */
export type ActionDiagnosis = {
  status: "diagnosed" | "inconclusive";
  cause: DiagnosisCause;
  action: DiagnosedAction | null;
  evidenceKeys: string[];
  alternativesRuledOut: Array<{ alternative: string; reason: string; evidenceKeys: string[] }>;
  /** One plain first-person sentence the operator reads. No lab words. */
  explanation: string;
};

/** A change is Ready only for a DIAGNOSED action naming a real edit. Completeness alone never earns it. */
export function readyForAction(d: ActionDiagnosis | null | undefined): boolean {
  return !!d && d.status === "diagnosed" && d.action != null && d.action !== "watch"
    && d.evidenceKeys.length > 0 && d.alternativesRuledOut.length > 0; }

/** Confidence follows EVIDENCE COMPLETENESS, never how the draft reads: a proposal that admits it never saw  the results page cannot be high confidence. */
export function confidenceFor(r: EvidenceReadiness, d?: ActionDiagnosis | null): ChangeProposal["confidence"] {
  if (!evidenceComplete(r) || (d !== undefined && !readyForAction(d))) return "low";
  return r.winners >= 2 && r.body ? "high" : "medium"; }
/** `new_page` is earned: only the page by page comparison proves this account reaches none of what the winners share. */
type ProposalKind = "existing_edit" | "new_page";

/** THE STORED LIFECYCLE. `needs_review` = a human look is owed first, and it is also THE two-step hold a  dangerous component routes through. `ready` = validated safe, exact copy, act now.  `implemented_pending_verification` = the operator says it shipped and the page has not been read back yet. `measuring` and `result` are DERIVED from the shipment ledger. A refused draft is withdrawn, never stored. */
type ProposalStatus = "needs_review" | "ready" | "implemented_pending_verification";

type ProposalRisk = "low" | "medium" | "high";
type ProposalConfidence = "high" | "medium" | "low";

/** The exact change: `existing_edit` carries a precise before/after field rewrite, `new_page` a build brief. */
export type RecommendedChange =
  | { kind: "existing_edit"; field: "title" | "meta" | "h1" | "answer_block" | "section" | "schema"; before: string | null; after: string; units?: PublicationUnits; target?: PublicationTarget; where?: string | null; linkTo?: string | null; anchorText?: string | null; linkMode?: "in_place"; linkSourceHash?: string }
  | { kind: "new_page"; proposedTitle: string; metaDescription: string; openingAnswer: string; outline: string[]; faqQuestions: string[]; schemaTypes: string[] };

/** A compact, frozen copy of what grounded this proposal, never a live handle: enough for the operator to see why Beacon recommends it and for the validator to re-run on load. `evidenceRefCount` is the draft's. */
type ProposalEvidence = { query: string; hints: string[]; evidenceRefCount: number };
/** THE COMPLETE CHANGE UNIVERSE (Phase 4): every lever Beacon may recommend on one page, named once. ADDITIVE ONLY, so every stored bundle still decodes, and never CMS-specific: WHAT to change and WHERE, not which editor. */
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

/** One exact, copy-ready component citing the receipt items that justify it. `before` is THE CURRENT STATE as it stands and null means it was never captured. `after` is THE PROPOSAL. The fields after `risk` are optional in the TYPE so every persisted row decodes, and REQUIRED by validate-proposal for the newer kinds. */
export type BundleComponent = {
  kind: BundleComponentKind;
  /** Operator-facing label ("Page title", "Opening answer", ...). */
  label: string;
  before: string | null;
  after: string;
  units?: PublicationUnits; target?: PublicationTarget;
  /** Keys into receipt.items that justify this component (>= 1). */
  evidenceKeys: string[];
  /** review = touches facts and deserves a human look. dangerous = moves or hides the page, held for confirmation. */
  risk: "safe" | "review" | "dangerous";
  /** WHERE on the page this lands. CMS-independent: a place on the page, never a field in an editor. */
  where?: string;
  /** WHICH PAGE THIS PIECE IS ON, when the change spans more than one. Differentiating four sibling pages against each other is ONE decision on several addresses, so the bundle carries them rather than the queue growing a second kind of card. Absent = the card's own page. */
  page?: string;
  /** What applying this one component achieves, in one sentence. */
  objective?: string;
  /** WHY this lever moves the diagnosed cause, in one sentence. */
  mechanism?: string;
  /** Sources and claims already checked for this exact publication copy. Historical packs without
   * `resolved: true` are unfinished research and cannot authorize Copy. */
  sourcePack?: { sourceRequirements: string[]; factRequirements: string[]; resolved?: boolean };
  /** THE NEW WORDS ON A LINK (`anchor_text`) and THE ADDRESS A FORWARD MUST LAND ON (`redirect`): the live check needs both exactly, because reading the destination back out of the instruction found the address being MOVED and graded a correct forward as a wrong one. */
  anchorAfter?: string; redirectTo?: string;
  /** One sentence naming the metric and the window Beacon will read afterwards. */
  measurementPlan?: string;
  /** THE PRESERVATION MAP, owed by any component that REPLACES a page rather than adding to it (`full_rewrite` today). `keeps` are the held sections, facts and links that survive into the draft; `losses` are the named things it drops, each with the one sentence why. A rebuild that drops a held section and cannot name it is REJECTED by validate-proposal: no ranking section leaves without being named out loud. */
  preserves?: { keeps: string[]; losses: Array<{ what: string; why: string }> }; derivation?: { rule: "visible_faq_pairs_v1"; operation: "add" | "replace" | "remove"; source: { pageKey: string; contentHash: string; schemaHash: string; visibleFaqHash: string; captureRevision: string }; dependsOn: Array<{ componentId: string; revision: string }>; projectedVisibleFaqHash: string };
};

/** KEEP / CHANGE / ADD / REMOVE, for one existing page, in one place. A bundle used to hand over components and leave the operator to work out what the change LEFT ALONE, which is most of their page. Every planned component says whether it changes something that is there or adds something that is not; `keeps` names the held sections this change deliberately does not touch; `removes` exists only where a component genuinely replaces something. A new page has no plan: there is nothing yet to keep. */
export type ComponentPlan = {
  entries: Array<{ kind: BundleComponentKind; label: string; disposition: "change" | "add" }>;
  keeps: string[];
  removes: Array<{ what: string; why: string }>;
};

export function needsSourcePack(c: BundleComponent): boolean { return FACTUAL_KINDS.has(c.kind); }

/** Stable browser copy selectors; recorded delivery additionally compares exact mutation material, never a fingerprint alone. */
const contentFingerprint = (text: string): string => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
export const componentIdOf = (component: { kind: string; after?: string | null; units?: PublicationUnits | null; target?: PublicationTarget | null }, index: number): string => `${index}:${component.kind}:${contentFingerprint(component.units || component.target ? JSON.stringify([component.after ?? "", component.units ?? null, component.target ?? null]) : component.after ?? "")}`;
export const sameComponentId = (a: string, b: string, pieces?: readonly Partial<{ [K in "after" | "before" | "page" | "where" | "redirectTo" | "anchorAfter" | "units" | "target"]: BundleComponent[K] | null }>[]): boolean => {
  const [ai, ak, af] = a.split(":"), [bi, bk, bf] = b.split(":");
  const material = pieces?.map((c) => JSON.stringify([c.after ?? null, c.before ?? null, c.page ?? null, c.where ?? null, c.redirectTo ?? null, c.anchorAfter ?? null, ...(c.units ? [c.units] : []), ...(c.target ? [c.target] : [])]));
  return (a === b || (ai === bi && ak === bk && (af === undefined || bf === undefined))) && (!material || (material.length === 2 && material[0] === material[1]));
};

export function dangerousComponents(components: readonly BundleComponent[]): BundleComponent[] {
  return components.filter((c) => c.risk === "dangerous" || DANGEROUS_COMPONENT_KINDS.has(c.kind)
    || (c.kind === "factual_correction" && HIGH_STAKES_CLAIM.test(`${c.before ?? ""} ${c.after}`))); }

/** One piece of canonical evidence the bundle used, in plain English. `key` is stable within the bundle and cited by BundleComponent.evidenceKeys; `fact` carries no raw id; `observedAt` null = undated aggregate. */
export type BundleEvidenceItem = {
  key: string;
  // `independent_source` is evidence from OUTSIDE this account: a dictionary, an encyclopedia, a scholarly reference. It exists because a factual correction stands on the source that contradicts the page, and filing that under `page_extract` told the operator the check came from the page being corrected.
  kind: "gsc_demand" | "keyword" | "serp" | "ai_observation" | "winning_page" | "page_extract" | "competitor" | "internal_link" | "diagnosis" | "independent_source";
  fact: string;
  observedAt: string | null;
  observationId?: string; // EXCLUSIVE with `observationIds`: the ONE stored observation a single-answer item was read from, so the chain back to the answer is a lookup
  observationIds?: string[]; // a fact SEVERAL answers stand behind names EVERY one of them, deduplicated and sorted where it is built, so no arbitrary member ever stands in for the set. Never both fields, so no reader picks which is true
  sources?: { url: string; publisher: string; passage?: string; channel: "seo" | "aeo"; rank?: number | null; recurrence?: number | null }[];
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
  /** WHAT IS BEING DONE ABOUT EVERY PAGE THE DIAGNOSIS NAMED, including the pages nothing is being done about. A three-page split that came back with work on one page silently DROPPED the other two: the component list is the only record of a named page, so a page whose drafting refused simply vanished and completeness only ever checked the survivors. The producer stamps one entry per named address BEFORE it drafts, so an address can only leave with a stated verdict, and `deliverableGaps` refuses a bundle that owes work on one and wrote none. Absent on a change that names a single page: there is nothing to drop. */
  dispositions?: readonly { page: string; verdict: "differentiate" | "keep_as_is" | "merge" | "redirect" | "no_change"; because: string }[];
  /** What this change keeps, changes, adds and removes on the page. Absent on a new page and on every pre-plan persisted row, which is honest: no plan is not an empty plan. */
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
  changeFamily: string; /** Stable body identity chosen at mint: query-derived work owns its topic through drafting; an exact correction owns one point. */ mutationScope?: "topic" | "point";
  status: ProposalStatus;
  /** The exact, cold-generated change. */
  recommendedChange: RecommendedChange;
  /** One plain-English sentence: why this matters. */
  whyItMatters: string;
  /** WHERE THIS HAPPENS AND WHAT TO DO, in order, so a copy-ready line is not a puzzle. Absent on a row nobody wrote steps for, which reads exactly as it always did: no steps is not an empty list of steps. */
  operatorSteps?: string[];
  estimatedEffortMinutes: number;
  riskLevel: ProposalRisk;
  confidence: ProposalConfidence;
  /** Honest caveats carried WITH the proposal: the draft's own risks, any validator caution, the "no baseline yet" note. */
  limitations: string[];
  /** WHAT BEACON'S OWN GATES SAID IS WRONG WITH THIS COPY, typed and separate from the caveats that merely ride along. Whose problem a held row is must never be guessed from the shape of an English sentence: a reworded refusal would silently change the owner. Absent on a row stored before this field existed, which reads honestly as "nothing typed" rather than "nothing wrong". */ faults?: readonly string[];
  evidence: ProposalEvidence;
  /** Honest value sizing for the ranker (may be null, never fabricated). */
  impactScore: number | null;
  impactAttribution?: { page: string; query: string; members: string[]; clicks28d: number; impressions90d: number; sourceDay: string };
  upsidePerMonth: number | null;
  /** HOW BIG THE AUDIENCE BEHIND THIS CHANGE IS: views its page earned in Google over 90 days, off the account's own rows. An audience size and never a proven recovery, so the ranker reads it ONLY where both proven figures are empty, at a third of the ceiling, and says so. Absent on a pre-field row. */
  demandImpressions90d?: number | null;
  /** THE AI SIDE OF THIS CHANGE, IN ITS OWN UNITS, never converted into pretend clicks: how many stored answers to its question exist, the share that credit this site, how many rival domains those answers cite instead, and the Google audience of the page the work lands on as the honest weight. Absent on a card no stored answer is behind. */
  aiImpact?: { answers: number; mentionRate: number; citedRivals: number; audienceWeight: number | null;
    /** RECURRENCE, never row totals: distinct reporting days, engines and parent questions behind the claim, the answers that actually reported sources (the honest denominator), how often this site was read and passed over, and the AI stage the case is in. Absent on rows minted before 2026-08-19. */
    days?: number; engines?: number; prompts?: number; reportedAnswers?: number; retrievedNotCited?: number;
    stage?: "owned_retrieved_not_cited" | "rivals_cited_own_not_retrieved" | "own_not_in_reported_sources" | "owned_mentioned_not_cited" | "citations_unreported"; };
  /** THE EXACT AI SCOPE a shipment must remeasure: prompt ids, engines and the fan-out cluster this change targets, preserved through Mark implemented instead of flattened into ten strings. `caseKey` is the CANONICAL CASE IDENTITY ("fanout:<key>" or "prompt:<id>"): every surface joins a search to its Change on this and never on wording that merely resembles it. `fanouts` carries every exact variant. `observationIds` is durable membership: the answers this claim was actually minted from, so a retired or reworded question cannot strand its own measurement. Added fields are optional so every row already on file still decodes. */
  aiScope?: { caseKey?: string; promptIds: string[]; promptVersions?: number[]; engines: string[];
    models?: string[]; modes?: string[]; fanoutKey?: string; fanouts: string[]; observationIds?: string[]; stage: string };
  /** The deep copy-ready form (Slice 7). Absent on atomic proposals and pre-bundle rows; ONE decoder serves both. */
  bundle?: ChangeBundle;
  /** The onboarding/research basis this proposal was generated under. A proposal whose basis is not the account's CURRENT basis is WITHHELD at load, never deleted. Absent on pre-basis rows, which read stale. */
  basis?: string;
  /** THIS CARD IS A READ, NOT AN EDIT: nothing on it is written, so no surface offers it as copy and the server refuses to record it done. Set where such a card is minted (decision/authorization). It was read off a substring of customer-facing prose until 2026-08-14, so rewording that line handed out a Copy button and a Mark done. Absent on a pre-field row, which reads as an edit. */
  researchOnly?: boolean; research?: { missing: string; next: string };
  /** Banked pieces and copy-bound repair work for the same unpublished page. */
  newPageDraft?: { brief: Record<string, unknown>; repair?: { of: string; resolution: DraftResolution; targets: readonly { component: number; instruction: string }[] }; metadata?: readonly { component: number; piece: NewPagePiece }[]; pieces: readonly NewPagePiece[] };
  /** THE IDENTITY OF THE WORK ITSELF, not of the page it lands on (Codex, 2026-08-23): reuse compared the broad cause alone, so an incomplete title bundle and a newly selected rewrite both read as "cannibalization" and the writer was skipped for a page worth 312 recoverable clicks. Two pieces of work are the same only when the page, the evidence, the family, the treatment, the cause and the search all match. */ workKey?: string;
  treatment?: "rewrite_existing_section" | "add_answer_section" | "title_or_h1" | "meta_description" | "internal_link_or_navigation" | "technical_reachability" | "consolidate_or_differentiate" | "factual_correction_batch" | "new_page"; // `research`: WHAT THE MINTING PRODUCER ALREADY KNOWS, typed so the feed never re-guesses it from `recommendedChange.after` or the last string in `operatorSteps`; absent on a row minted before this field existed, said honestly rather than guessed.
  /** THE CAUSE the ladder named, so the ranker can ask whether this change's levers address it. Absent when nothing was diagnosed; an unrecognised value on a hand-edited row matches no lever and is discounted nothing. */
  diagnosisCause?: CauseFinding["cause"]; /** WHAT IS ON FILE FOR THIS ROW'S OWN SEARCH GROUP, TYPED BECAUSE THE LADDER HOLDS NO SNAPSHOT (production 09:03:46Z, 2026-09-06). `read` means at least one page winning some phrasing of the group has been read whole; `unread` means a results page for the group is on file and no winner off it has been read; `none` means no results page has ever been bought for any phrasing and no winner is on file at all. Stamped where the card is minted from the demand and refreshed by every re-mint through the SAME comparison, so the one question "has anybody read what wins this search" is answered once and read by the store's obligation recompute, by the release sweep and by the walk. Without it four hub rows were re-saved `terminal: no substantive gap named` every pass on searches whose winners nobody had ever read. Absent on a row no producer stamped, and absent decides nothing. */ winnersOnFile?: "none" | "unread" | "read";
  /** THE WHOLE REASONING STEP, carried so the operator can read it: the explanation, what it beat, what would disprove it, and every cause whose evidence is not on file. Absent on an unjudged row. */
  causeFinding?: CauseFinding;
  /** WHY THIS SITS WHERE IT SITS. Stamped by the ONE ranker at ranking time, never by a producer, and absent on a row nobody has ranked yet. Each factor names the input it read and contributes a bounded amount, so the order is inspectable and no factor can quietly dominate. `directional` is true when no proven click figure backed the value factor, and `basis` then says so out loud. */
  rankingReceipt?: { score: number; factors: Array<{ name: string; input: string; contribution: number; max: number }>; directional: boolean; basis: string };
  /** THE ONE TYPED NEXT STEP THIS ROW OWES, derived by decision/obligation at the one persistence door and stored beside the words. Absent means nothing is owed; it was read out of English before this field existed, so a reworded caveat silently changed what the machine went and did next. */
  obligation?: Obligation;
  /** THE ONE ENVELOPE EVERY DOOR READS FOR THIS ROW (operator, 2026-09-02). The writer, the evaluator, the promotion door, the banked re-read and the replay each rebuilt their own picture of the job from whatever they happened to hold, so three doors read three envelopes and a redraft was marked against a target nobody had shown it. Normalized once where the copy is written, stored beside the words, and re-read rather than re-derived. Optional and additive: a row banked before this field existed carries none and every door falls back exactly as it did. `propositions` is what a reader must know afterwards; `briefing` lines are shape only and no claim may ever cite them; `forbidden` names the propositions no fact on file supports, which may not be stated at all. */
  factIdentity?: string; assignment?: { page: string; basis?: string; pageHash?: string; checkedGroups?: string[]; informationNeed?: { question: string; requiredAtomKeys: string[]; polarity: "supports"; voice: "publisher"; deliveryMode: "inline" | "headed" | "replacement" | "whole_page" }; deliveryMode?: "inline" | "headed" | "replacement" | "whole_page"; /** THE ONE EDITORIAL STANDARD THIS WORK IS JUDGED BY, TYPED AND PERSISTED (operator, 2026-09-05). The writer, the evaluator, the banked reading, the re-read and the serving door each worked out for themselves what kind of edit this was, and one of them worked it out from which evidence ids happened to be in the packet, so a row with no checked fact on file was judged as a different kind of work than the row the writer was briefed for. It is decided ONCE, where the assignment is built, and read everywhere after (proof `editorialStandard`). AND IT IS COPY-OWNED, which is where it belongs and where it was missing: `completeness.ts` COPY_OWNED carries `assignment` so this object rides the words it was written for through every later preservation merge, and a re-mint's brief is dropped wherever the preserved copy carries none of its own. Measured on the production store before that landed: 0 of the 451 stored rows on the one account that table holds carried one. */ standard?: "summary" | "missing_answer" | "restructuring" | "repositioning" | "correction" | "internal_link" | "structured_data"; treatment: "answer_block" | "section" | "replacement" | "restructure" | "field"; gapKind: string; propositions: string[]; diagnosedGap: string; mustLeadWith: string; opening: string; format: string; intent: string[]; supportingFacts?: string[]; /** THE CHECKED STATEMENTS THIS COPY MAY STATE, EACH WITH THE SENTENCE BEHIND ITS ID (campaign, 2026-09-05): the ids alone told a writer what it could cite and never what those ids say, so the sentences arrived separately in `mustLeadWith` and the two halves of one thing could drift. `supportingFacts` is the id list every row banked before this and is read as a fallback, never written beside it. AND WHAT THE PAGES WINNING THIS SEARCH CARRY THAT THIS PAGE DOES NOT, in their own words with the publisher and what that publisher is, so the brief the writer reads is the comparison the evidence layer made rather than a sentence rebuilt from it. AND THE OWNED MATERIAL THAT STAYS, plus the exact passage a replacement replaces, so nothing that already answers the reader is lost to an edit. */ facts?: { id: string; says: string }[]; atomBindings?: { key: string; evidenceId: string; hash: string }[]; observations?: { publisher: string; publisherClass: string; kind: string; text: string; quote: string }[]; keep?: string[]; replaces?: string; pageContext: string[]; /** CONTRADICTED BY A SOURCE ON FILE, or (for a correction or a replacement) carried by nothing checked: never stated. */ forbidden: string[]; /** NAMED BY THE DIAGNOSIS AND CARRIED BY NOTHING CHECKED, on additive work only (operator, write first): stated where the page already states it, under a page-copy id, with one caveat line. Absent on every other kind of work. */ unbacked?: string[]; rivals: string[]; briefing: string[]; mayReuse: string; mustPreserve: string; mustNotRepeat: string; placement: "additive" | "replacement" | "field"; completionTest: string; owed?: string; /** THE SMALLEST COMPLETE TREATMENT THIS GAP TAKES, TYPED (operator, 2026-09-02). One fixed format string told every body row to write "a heading, then complete sentences", so a page whose only defect was one missing sentence was answered with a headed block plus a second sentence summarising the page, and the evaluator rightly refused it. The shape is derived from the gap, the backed propositions and the page's own passages; `anchor` is the exact stored sentence or heading the copy lands after, and the finished shape records how the reader task was delivered. `maxSentences` is retained for historical decoding only, never a current editorial limit. Absent on a summary field and on every row banked before this existed, and every door then falls back exactly as it did. */ shape?: "inline_addition" | "exact_replacement" | "direct_answer" | "section" | "no_change"; anchor?: string | null; maxSentences?: number; /** Conversion actions observed in the page extract, not an exhaustive inventory. */ sells?: string[] };
  /** One plain sentence comparing this proposal to the one ranked directly below it, naming the factor that actually separated them. Absent on the last row. */
  whyRankedAboveNext?: string;
  /** WHERE THE SHAPE OF THIS COPY CAME FROM, when it came from somewhere better than a guess: the stored results page for this exact search, whose top titles agreed on the shape this one is written in. Absent means nothing was imitated, which is the normal answer, and a surface must not chip what is absent. */
  modeledOn?: string;
  /** THE TARGET PAGE AS IT READ WHEN THIS ROW'S COPY WAS WRITTEN: its stored title, heading, description and outline, banked beside the words. Finished copy is expensive and survives passes that never reach it, so something has to say when it stopped describing its page; this is that something (decision/completeness's `copyIdentity`). Absent on a row minted before the stamp existed, which is decided on everything else. */
  copyStamp?: string;
  /** WHAT THE COPY ASSERTS AND WHAT CARRIES EACH ASSERTION, banked with the words. Every claim was checked against this page's own evidence before the copy was accepted, and then thrown away, so nothing on the stored row could answer "what supports this line" afterwards. Ids point into the same page evidence the editor read. Absent on a row whose copy no editor wrote. */
  /** `of` NAMES THE PIECE THIS CLAIM ANSWERS FOR, as `componentIdOf` names it, so a deep bundle's authorization is per component and never pooled: an authorized title could otherwise bless an unauthorized body section, and one section's ruling could be read as another's. Absent on every atomic row and every row banked before it existed, which is why decision/proof's copyKey folds it only where it is present: a stored reading must not be retired by a field its own row never carried. */
  claims?: readonly { text: string; supportedBy: readonly string[]; of?: string }[];
  /** THE EXACT WORDS EACH SUPPORT ID CARRIES, banked with the claims that name it. A claim pointing at "page-copy-1" is a symbol, not a fact: the operator, and any later re-check, could not read what page-copy-1 says, so provenance was unreadable on the one screen where the copy gets pasted. These are the editor's own evidence map values, bounded per fact. Absent on a row banked before this existed. */
  supportFacts?: readonly { id: string; fact: string; finding?: z.infer<typeof FindingSchema>; sources?: readonly { url: string; kind: string }[] }[];
  /** THE OPERATOR'S OWN YES TO ONE EXACT VERSION of a change that moves or hides a page. Product Truth holds such a change behind two steps: it is minted `needs_review`, and it reaches `ready` only when a person has read its components, its addresses, its destination, its copy and its risks and confirmed THAT version (decision/completeness's `confirmedVersion`). Stored so the yes survives the request that gave it and so a later pass cannot inherit it: any edit to the copy, the pieces, the destination, the evidence or the basis mints a different version and this stamp stops matching, which refuses the stale confirmation. Absent on everything that never needed one. */
  confirmedVersion?: string;
  /** THE PERSON WHO SAID YES TO AN IMPERFECT DRAFT, AND WHEN. Editorial judgement is the one hold a human may answer: a draft whose exact words passed every deterministic check and that nothing has read for sense is promoted by a named person reading it (decision/completeness's `openHold`, soft side). A hard hold is a fact about the work and no stamp here overrides one. Absent on everything nobody had to approve. */
  approval?: { by: string; at: string };
  /** THE OPERATOR ASKED FOR BETTER WORDS. Banked copy is preserved for ever while its material identity holds, which is exactly right until a person reads it and wants it rewritten; this is that ask, stamped on the row so the next funded pass writes over it instead of preserving it. A nudge, never a queue and never a second pipeline. */
  redraftRequested?: string;
  /** THE RETIREMENT RECEIPT for finished copy a later pass genuinely replaced (operator, 2026-08-22): the exact words that were retired and the material fact that retired them, so a replacement is inspectable and never the silent loss of the only record of the finished version. Stamped only when finished copy is really discarded for a material change; a pass that merely reworded its own prose preserves the copy and stamps nothing. */
  previousCopy?: { after: string; /** Planned piece identity when retirement belongs to one compound component. */ of?: string; retiredBecause: string; at: string; /** HOW MANY CORRECTIVE REDRAFTS THIS ROW HAS CONSUMED. Two attempts at the same gates is settled work, not a queue position, and nothing on the row could count them before. */ attempts?: number }; draftNotes?: readonly string[]; /** THE CAVEATS THE PASS THAT WROTE THE CURRENT COPY OWNS (operator, 2026-09-01): the next finish replaces exactly them, never the producer's lines. Absent before this existed. */
  /** WHAT BEACON'S OWN PAID REVIEWER RULED, CLAIM BY CLAIM. An exact identity string stood here: it proved a receipt could not ride other words and proved NOTHING about whether the cited facts SUPPORT the claim, because the producer computed it about its own output and the store then approved that description, so "Noor means light" could stand on a fact reading "Tehran is the capital of Iran" (Codex, 2026-08-28). `of` is decision/proof's `copyKey`; `version` is the review contract it was made under. */
  semanticReview?: ReviewReceipt & { scope?: "whole_page"; parts?: readonly { key: string; review: ReviewReceipt }[] };
  /** WHAT A READER GAINS, AND THE PAGE STATE IT WAS JUDGED AGAINST. `bodyHash` is the normalized fingerprint of the owned body the evaluator actually read, and `pageWhole` is a claim ABOUT that whole body, so when the stored page moves under it the absence ruling is stale and the row goes back for a look; `targetHash` names the exact passage a replacement was aimed at, so an unrelated edit elsewhere on the page leaves it standing. Both optional so every stored row decodes byte for byte. */
  informationGain?: { adds: string; by: readonly string[]; pageWhole: boolean; bodyHash?: string; targetHash?: string };
  preservationNotes?: BundleComponent["preserves"]; preservation?: readonly { text: string; disposition: "kept" | "corrected" | "removed" | "moved"; why?: string; to?: string; of?: string;
    basis?: "duplicate_of" | "replaced_by" | "unsupported" | "obsolete" | "owner_confirmed"; by?: readonly string[] }[];
  /** STRUCTURAL: this is a proposal. The kernel never writes a live page. */
  publish: "manual";
  createdAt: string;
};
const FindingSchema = z.object({ tenantId: z.string().min(1), page: z.string().min(1), statementKey: z.string().min(1) });
const SupportFactSchema = z.object({ id: z.string().min(1), fact: z.string().min(1), finding: FindingSchema.optional(), sources: z.array(z.object({ url: z.string().min(1), kind: z.string().min(1) })).optional() });
const RecommendedChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing_edit"), field: z.enum(["title", "meta", "h1", "answer_block", "section", "schema"]),
    before: z.string().nullable(), after: z.string().min(1), units: PublicationUnitsSchema.optional(), target: PublicationTargetSchema.optional(), where: z.string().nullable().optional(), linkTo: z.string().nullable().optional(), anchorText: z.string().nullable().optional(), linkMode: z.literal("in_place").optional(), linkSourceHash: z.string().optional() }),
  z.object({ kind: z.literal("new_page"), proposedTitle: z.string().min(1), metaDescription: z.string().min(1),
    openingAnswer: z.string().min(1), outline: z.array(z.string()), faqQuestions: z.array(z.string()),
    schemaTypes: z.array(z.string()) }),
]);

/** THE OBLIGATION, AS A CLOSED UNION ON `kind`. The zod side lives here rather than beside the type so decision/obligation exports only what a caller needs (the type and the derivation) and this file stays the one place a stored row is validated. `evidence.need` mirrors producers/contract's EvidenceRequirement, which is the vocabulary the runtime's acquisition already executes. */
const ObligationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("draft") }), z.object({ kind: z.literal("sections"), owed: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("redraft"), attempt: z.number().int().min(1), instruction: z.string().min(1) }),
  z.object({ kind: z.literal("evidence"), need: z.object({ kind: z.enum(["serp", "page_source", "competitor_page", "factual_source", "semantic_review"]),
    finding: FindingSchema.optional(), query: z.string(), url: z.string().optional(), reasonCode: z.string().min(1), delivery: z.enum(["existing_page_edit", "whole_page"]).optional(), ownerVersion: z.string().optional(), missingTopic: z.string().optional(), topic: z.object({ key: z.string().regex(/^topic:.+/), label: z.string().min(1) }).optional(), rivalUrl: z.string().optional(), rivalUrls: z.array(z.string()).optional(), proposalId: z.string().optional(), unlocks: z.object({ beforeMicros: z.literal(true).optional(), proposalId: z.string().min(1), step: z.enum(["draft", "sections", "redraft", "review", "settle"]) }).optional() }) }),
  z.object({ kind: z.literal("review") }), z.object({ kind: z.literal("operator"), decision: z.literal("safety_confirmation") }),
  z.object({ kind: z.literal("terminal"), reason: z.string().min(1), holdCode: z.enum(["bank_reconciliation", "settled_invalid_output"]).optional(), materialKey: z.string().min(1).optional(), sourceMaterialHash: z.string().min(1).optional() })]) as z.ZodType<Obligation>;
const KIND_SCHEMA = z.enum(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack",
  "paragraph_correction", "section_add", "section_remove", "section_rewrite", "restructure",
  "full_rewrite", "factual_correction", "source_update", "entity_expansion", "table_or_list_add",
  "internal_link_add", "internal_link_remove", "anchor_text", "schema", "canonical", "redirect",
  "noindex", "consolidation", "navigation", "new_page"]);
const NAMED_SCHEMA = z.array(z.object({ what: z.string().min(1), why: z.string().min(1) }));
const PRESERVATION_NOTES_SCHEMA = z.object({ keeps: z.array(z.string()), losses: NAMED_SCHEMA });
const SCHEMA_DERIVATION = z.object({ rule: z.literal("visible_faq_pairs_v1"), operation: z.enum(["add", "replace", "remove"]), source: z.object({ pageKey: z.string().min(1), contentHash: z.string().min(1), schemaHash: z.string().min(1), visibleFaqHash: z.string().min(1), captureRevision: z.string().regex(/^[a-f0-9]{64}$/) }), dependsOn: z.array(z.object({ componentId: z.string().min(1), revision: z.string().regex(/^[a-f0-9]{64}$/) })).min(1), projectedVisibleFaqHash: z.string().regex(/^[a-f0-9]{64}$/) });

const ChangeBundleSchema: z.ZodType<ChangeBundle> = z.object({
  objective: z.string().min(1),
  metric: z.string().min(1),
  scope: z.object({ queries: z.array(z.string()), prompts: z.array(z.string()) }),
  components: z.array(z.object({
    kind: KIND_SCHEMA,
    label: z.string().min(1),
    before: z.string().nullable(),
    after: z.string(),
    units: PublicationUnitsSchema.optional(), target: PublicationTargetSchema.optional(),
    evidenceKeys: z.array(z.string().min(1)).min(1),
    risk: z.enum(["safe", "review", "dangerous"]),
    where: z.string().min(1).optional(), page: z.string().min(1).optional(),
    objective: z.string().min(1).optional(),
    mechanism: z.string().min(1).optional(),
    sourcePack: z.object({ sourceRequirements: z.array(z.string()), factRequirements: z.array(z.string()), resolved: z.boolean().optional() }).optional(),
    measurementPlan: z.string().min(1).optional(), redirectTo: z.string().min(1).optional(), anchorAfter: z.string().min(1).optional(),
    preserves: PRESERVATION_NOTES_SCHEMA.optional(), derivation: SCHEMA_DERIVATION.optional(),
  })).min(1),
  dispositions: z.array(z.object({ page: z.string().min(1), because: z.string().min(1),
    verdict: z.enum(["differentiate", "keep_as_is", "merge", "redirect", "no_change"]) })).optional(),
  plan: z.object({ keeps: z.array(z.string()), removes: NAMED_SCHEMA,
    entries: z.array(z.object({ kind: KIND_SCHEMA, label: z.string().min(1), disposition: z.enum(["change", "add"]) })) }).optional(),
  receipt: z.object({
    items: z.array(z.object({ key: z.string().min(1), fact: z.string().min(1), observedAt: z.string().nullable(), observationId: z.string().optional(), observationIds: z.array(z.string().min(1)).min(1).optional(), sources: z.array(z.object({ url: z.string().min(1), publisher: z.string().min(1), passage: z.string().min(1).optional(), channel: z.enum(["seo", "aeo"]), rank: z.number().nullable().optional(), recurrence: z.number().nullable().optional() })).optional(), // the WHOLE support survives the round trip, or persistence quietly turns an aggregate back into one answer's word
      kind: z.enum(["gsc_demand", "keyword", "serp", "ai_observation", "winning_page", "page_extract", "competitor", "internal_link", "diagnosis", "independent_source"]) }).refine((i) => !(i.observationId && i.observationIds), { message: "one_answer_or_several_never_both" })),
    missing: z.array(z.string()),
    freshestObservedAt: z.string().nullable(),
  }),
  alternatives: z.array(z.object({ option: z.string().min(1), reason: z.string().min(1) })),
  risks: z.array(z.string()),
  confidenceReasons: z.array(z.string()),
  measurementPlan: z.string().min(1),
}).superRefine((b, ctx) => {
  // Referential integrity: unproven copy is never served, so every component must cite receipt items that exist.
  const keys = new Set(b.receipt.items.map((i) => i.key)), ids = new Set(b.components.map(componentIdOf));
  for (const c of b.components) {
    for (const k of c.evidenceKeys) if (!keys.has(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `component ${c.kind} cites missing evidence ${k}` }); if (!c.after.trim() && !(c.kind === "schema" && c.derivation?.operation === "remove")) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `component ${c.kind} has no replacement` }); if (c.derivation && (c.kind !== "schema" || c.derivation.dependsOn.some((d) => !ids.has(d.componentId)))) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "derived schema must depend on components in its own bundle" });
  }
}) as z.ZodType<ChangeBundle>;
const AssignmentSchema: z.ZodType<NonNullable<ChangeProposal["assignment"]>> = z.object({ page: z.string(), basis: z.string().optional(), pageHash: z.string().regex(/^[a-f0-9]{16}$/).optional(), checkedGroups: z.array(z.string()).optional(), informationNeed: z.object({ question: z.string(), requiredAtomKeys: z.array(z.string()), polarity: z.literal("supports"), voice: z.literal("publisher"), deliveryMode: z.enum(["inline", "headed", "replacement", "whole_page"]) }).optional(), deliveryMode: z.enum(["inline", "headed", "replacement", "whole_page"]).optional(), standard: z.enum(["summary", "missing_answer", "restructuring", "repositioning", "correction", "internal_link", "structured_data"]).optional(), treatment: z.enum(["answer_block", "section", "replacement", "restructure", "field"]), gapKind: z.string(), propositions: z.array(z.string()), diagnosedGap: z.string(), mustLeadWith: z.string(), opening: z.string(), format: z.string(), intent: z.array(z.string()), supportingFacts: z.array(z.string()).optional(), facts: z.array(z.object({ id: z.string(), says: z.string() })).max(8).optional(), atomBindings: z.array(z.object({ key: z.string().min(1), evidenceId: z.string().min(1), hash: z.string().regex(/^[a-f0-9]{64}$/) })).optional(), observations: z.array(z.object({ publisher: z.string(), publisherClass: z.string(), kind: z.string(), text: z.string(), quote: z.string() })).max(12).optional(), keep: z.array(z.string()).max(4).optional(), replaces: z.string().optional(), pageContext: z.array(z.string()), forbidden: z.array(z.string()), unbacked: z.array(z.string()).optional(), rivals: z.array(z.string()), briefing: z.array(z.string()), mayReuse: z.string(), mustPreserve: z.string(), mustNotRepeat: z.string(), placement: z.enum(["additive", "replacement", "field"]), completionTest: z.string(), owed: z.string().optional(), shape: z.enum(["inline_addition", "exact_replacement", "direct_answer", "section", "no_change"]).optional(), anchor: z.string().nullable().optional(), maxSentences: z.number().optional(), sells: z.array(z.string()).optional() });
type NewPagePiece = { slot?: number; assignment?: ChangeProposal["assignment"]; before?: string | null; draftNotes?: readonly string[]; target?: PublicationTarget; preservation?: ChangeProposal["preservation"]; editor?: z.infer<typeof EditorAcceptanceSchema>; reviewOf?: string; heading: string | null; after: string; units?: PublicationUnits; claims: readonly { text: string; supportedBy: readonly string[] }[]; supportFacts: NonNullable<ChangeProposal["supportFacts"]>; review: readonly { i: number; by: string[]; entailed: boolean }[]; gain?: { adds: string; by: readonly string[]; pageWhole: boolean; bodyHash?: string; targetHash?: string } };
const NewPagePieceSchema: z.ZodType<NewPagePiece> = z.object({ assignment: AssignmentSchema.optional(), slot: z.number().int().nonnegative().optional(), before: z.string().nullable().optional(), draftNotes: z.array(z.string()).optional(), target: PublicationTargetSchema.optional(), preservation: z.array(z.object({ text: z.string().min(1), disposition: z.enum(["kept", "corrected", "removed", "moved"]), why: z.string().optional(), to: z.string().optional(), of: z.string().min(1).optional(), basis: z.enum(["duplicate_of", "replaced_by", "unsupported", "obsolete", "owner_confirmed"]).optional(), by: z.array(z.string()).optional() })).optional(), editor: EditorAcceptanceSchema.optional(), reviewOf: z.string().optional(), heading: z.string().nullable(), after: z.string().min(1), units: PublicationUnitsSchema.optional(), claims: z.array(z.object({ text: z.string().min(1), supportedBy: z.array(z.string().min(1)) })), supportFacts: z.array(SupportFactSchema), review: z.array(z.object({ i: z.number().int().min(0), by: z.array(z.string()), entailed: z.boolean() })), gain: z.object({ adds: z.string().min(1), by: z.array(z.string()), pageWhole: z.boolean(), bodyHash: z.string().min(1).optional(), targetHash: z.string().min(1).optional() }).optional() });
const ChangeProposalSchema: z.ZodType<ChangeProposal> = z.object({
  id: z.string().min(1), tenantId: z.string().min(1), kind: z.enum(["existing_edit", "new_page"]),
  pagePath: z.string().nullable(), pageUrl: z.string().nullable(), pageLabel: z.string(),
  primaryQuery: z.string(), opportunityType: z.string(), changeFamily: z.string(), mutationScope: z.enum(["topic", "point"]).optional(),
  status: z.enum(["needs_review", "ready", "implemented_pending_verification"]),
  recommendedChange: RecommendedChangeSchema, whyItMatters: z.string(), operatorSteps: z.array(z.string().min(1)).optional(),
  estimatedEffortMinutes: z.number(), riskLevel: z.enum(["low", "medium", "high"]), confidence: z.enum(["high", "medium", "low"]),
  limitations: z.array(z.string()), faults: z.array(z.string()).optional(),
  evidence: z.object({ query: z.string(), hints: z.array(z.string()), evidenceRefCount: z.number() }),
  impactScore: z.number().nullable(),
  impactAttribution: z.object({ page: z.string().min(1), query: z.string().min(1), members: z.array(z.string().min(1)).min(1).max(40), clicks28d: z.number().finite().nonnegative(), impressions90d: z.number().finite().nonnegative(), sourceDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(),
  upsidePerMonth: z.number().nullable(),
  demandImpressions90d: z.number().nullable().optional(),
  aiImpact: z.object({ answers: z.number(), mentionRate: z.number(), citedRivals: z.number(), audienceWeight: z.number().nullable(),
    days: z.number().optional(), engines: z.number().optional(), prompts: z.number().optional(),
    reportedAnswers: z.number().optional(), retrievedNotCited: z.number().optional(),
    stage: z.enum(["owned_retrieved_not_cited", "rivals_cited_own_not_retrieved", "own_not_in_reported_sources", "owned_mentioned_not_cited", "citations_unreported"]).optional() }).optional(),
  aiScope: z.object({ caseKey: z.string().optional(), promptIds: z.array(z.string()), promptVersions: z.array(z.number()).optional(),
    engines: z.array(z.string()), models: z.array(z.string()).optional(), modes: z.array(z.string()).optional(),
    fanoutKey: z.string().optional(), fanouts: z.array(z.string()), observationIds: z.array(z.string()).optional(), stage: z.string() }).optional(),
  bundle: ChangeBundleSchema.optional(),
  basis: z.string().optional(), workKey: z.string().optional(),
  researchOnly: z.boolean().optional(), research: z.object({ missing: z.string().min(1), next: z.string().min(1) }).optional(), newPageDraft: z.object({ brief: z.record(z.string(), z.unknown()),
    repair: z.object({ of: z.string().min(1), resolution: z.enum(["none", "structural_synthesis", "use_stored_verified_evidence", "acquire_serp", "acquire_page_source", "acquire_competitor_page", "acquire_factual_source", "no_valid_treatment"]), targets: z.array(z.object({ component: z.number().int().nonnegative(), instruction: z.string().min(1).max(600) })).max(24) }).optional(),
    metadata: z.array(z.object({ component: z.number().int().min(0).max(1), piece: NewPagePieceSchema })).max(2).optional(), pieces: z.array(NewPagePieceSchema) }).optional(),
  treatment: z.enum(["rewrite_existing_section", "add_answer_section", "title_or_h1", "meta_description", "internal_link_or_navigation", "technical_reachability", "consolidate_or_differentiate", "factual_correction_batch", "new_page"]).optional(), // unknown keys are STRIPPED here: leave researchOnly out and a research card reloads as an edit
  diagnosisCause: z.string().min(1).optional(), winnersOnFile: z.enum(["none", "unread", "read"]).optional(),
  causeFinding: z.object({ cause: z.string().min(1), action: z.string().nullable(), evidenceKeys: z.array(z.string()),
    // The reading the cause was decided from, kept whole. Carried opaquely here because the ladder OWNS the per-cause shape; a second copy of that union in this schema is a second thing to keep in step.
    payload: z.unknown().optional(),
    // `fired` separates a second real accusation from a cause checked and ruled out; dropping it on the way to the store turned every stored second accusation into a rejected one on reload.
    competingExplanations: z.array(z.object({ cause: z.string().min(1), reason: z.string().min(1), fired: z.boolean().optional() })),
    falsifier: z.string().min(1), explanation: z.string().min(1),
    notConsidered: z.array(z.object({ cause: z.string().min(1), missing: z.string().min(1) })) })
    .optional() as z.ZodType<CauseFinding | undefined>,
  rankingReceipt: z.object({ score: z.number(), directional: z.boolean(), basis: z.string().min(1),
    factors: z.array(z.object({ name: z.string().min(1), input: z.string().min(1), contribution: z.number(), max: z.number() })) }).optional(),
  whyRankedAboveNext: z.string().min(1).optional(),
  modeledOn: z.string().min(1).optional(),
  copyStamp: z.string().min(1).optional(),
  claims: z.array(z.object({ text: z.string().min(1), supportedBy: z.array(z.string().min(1)), of: z.string().min(1).optional() })).optional(),
  supportFacts: z.array(SupportFactSchema).optional(),
  obligation: ObligationSchema.optional(), factIdentity: z.string().optional(),
  assignment: AssignmentSchema.optional(),
  confirmedVersion: z.string().min(1).optional(),
  approval: z.object({ by: z.string().min(1), at: z.string().min(1) }).optional(),
  redraftRequested: z.string().min(1).optional(),
  previousCopy: z.object({ after: z.string().min(1), retiredBecause: z.string().min(1), at: z.string().min(1), attempts: z.number().int().nonnegative().optional(), of: z.string().min(1).optional() }).optional(), draftNotes: z.array(z.string().min(1)).optional(),
  semanticReview: ReviewReceiptSchema.extend({ scope: z.literal("whole_page").optional(), parts: z.array(z.object({ key: z.string().min(1), review: ReviewReceiptSchema })).optional() }).optional(), informationGain: z.object({ adds: z.string().min(1), by: z.array(z.string()), pageWhole: z.boolean(), bodyHash: z.string().min(1).optional(), targetHash: z.string().min(1).optional() }).optional(),
  preservationNotes: PRESERVATION_NOTES_SCHEMA.optional(), preservation: z.array(z.object({ text: z.string().min(1), disposition: z.enum(["kept", "corrected", "removed", "moved"]), why: z.string().optional(), to: z.string().optional(), of: z.string().min(1).optional(),
    basis: z.enum(["duplicate_of", "replaced_by", "unsupported", "obsolete", "owner_confirmed"]).optional(), by: z.array(z.string()).optional() })).optional(),
  publish: z.literal("manual"),
  createdAt: z.string(),
}).superRefine((p, ctx) => {
  const pieces = [p.recommendedChange.kind === "existing_edit" ? p.recommendedChange : null, ...(p.bundle?.components ?? []), ...(p.newPageDraft?.pieces ?? []), ...(p.newPageDraft?.metadata?.map((m) => m.piece) ?? [])];
  for (const piece of pieces) if (piece?.units && piece.after !== COPY_RULES.bodyCopy(piece.units)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Publication text must be the exact projection of its saved units." });
  for (const piece of [p.recommendedChange.kind === "existing_edit" ? p.recommendedChange : null, ...(p.bundle?.components ?? [])]) if (piece?.target && piece.where !== COPY_RULES.where(piece.target)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Placement instructions must be the exact projection of the saved target." });
}) as z.ZodType<ChangeProposal>;

const PERSIST_VERSION = 1 as const;

/** Serialize a proposal for the persistence layer (versioned envelope). `workKey` is projected beside the canonical proposal so database locks can read the generation without decoding the business record. */
export function serializeChangeProposal(proposal: ChangeProposal): string { return JSON.stringify({ v: PERSIST_VERSION, workKey: proposal.workKey, proposal }); }

/** Parse + RE-VALIDATE a persisted proposal: a hand-edited row that no longer satisfies the contract can never be served as a trusted proposal. Fail-soft to null. */
export function deserializeChangeProposal(content: string | null | undefined): ChangeProposal | null {
  try { const obj = content ? JSON.parse(content) as { v?: number; proposal?: unknown } : null;
    const res = obj && obj.v === PERSIST_VERSION ? ChangeProposalSchema.safeParse(obj.proposal) : null;
    return res?.success ? res.data : null; } catch { return null; }
}

/** The coarse family used for identity + UI. */
export function proposalFamily(input: EvidenceInput): string {
  if (input.opportunity.kind === "new_page") return "new_page";
  const f = (input.opportunity.field ?? "").toLowerCase();
  return f === "title" ? "title" : f === "meta" ? "meta" : "other"; }

/** Stable proposal id from the evidence input. */
export function proposalId(input: EvidenceInput): string {
  const isNew = input.opportunity.kind === "new_page";
  const pageKey = isNew ? `new::${input.opportunity.query.toLowerCase().trim()}` : (input.page.path ?? input.page.url ?? input.page.label).toLowerCase().trim();
  const field = input.opportunity.field;
  // Singleton fields share one permanent seat per page. Body opportunities do
  // not: a page can carry independent answers for independent searches, so the
  // search identity is part of the address from its first appearance.
  const seat = isNew ? "new_page" : field ?? `edit@${canonicalQueryKey(input.opportunity.query)}`;
  return `${input.tenantId}::${pageKey}::${input.opportunity.kind}::${seat}`; }

/** Coarse effort minutes by family (a real per-move figure overrides this). */
export function effortForFamily(family: string): number { return family === "title" || family === "meta" || family === "h1" ? 1 : family === "answer" ? 3 : family === "new_page" ? 60 : 5; }
/** WHAT A CHANGE WAS CHECKED AGAINST, in one countable line, readable before anybody opens the receipt. PURE; lives here rather than the bundle producer so a client card may import it without dragging server modules. */
const CLASS_OF: Record<string, string> = {
  gsc_demand: "your search data", page_extract: "the page as last read", keyword: "monthly search counts",
  serp: "the live results page", ai_observation: "AI answers watched", winning_page: "winning pages read",
  competitor: "the sites AI hands this to instead of you", internal_link: "links from your own pages",
  diagnosis: "what the results page shows about the cause",
  independent_source: "independent sources checked against the page" };
export const receiptComposition = (items: readonly { kind: string }[]): string => {
  const by = new Map<string, number>();
  for (const it of items) by.set(CLASS_OF[it.kind] ?? it.kind, (by.get(CLASS_OF[it.kind] ?? it.kind) ?? 0) + 1);
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c, n]) => (n > 1 ? `${c} (${n})` : c));
  return items.length === 0 ? "nothing to show" : `${items.length} ${items.length === 1 ? "check" : "checks"}: ${parts.join(", ")}`; };
