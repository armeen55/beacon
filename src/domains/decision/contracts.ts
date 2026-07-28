/**
 * decision/contracts (CORE 100K decision kernel, 2026-07-22) — the ONE input
 * and the ONE output of the recommendation-intelligence collapse.
 *
 * The kernel turns exactly one normalized `EvidenceInput` (a small structural
 * interface this module OWNS — it does NOT depend on demand-graph / evidence
 * internals; the real evidence assembler maps its output onto this shape) into
 * a ranked, exact, safe `ChangeProposal`.
 *
 * A `ChangeProposal` is the single persisted representation the operator sees.
 * It carries, in one object, everything the old recommendation / draft /
 * ActionPack / changes-shaping layers used to split across five modules:
 *   - the PAGE the change lands on (or that a new page is proposed for)
 *   - the OPPORTUNITY (demand phrase + operator-facing label)
 *   - the EVIDENCE that grounds it (a compact snapshot, not a live handle)
 *   - the RECOMMENDED EXACT CHANGE (title/meta rewrite before→after, OR a
 *     full new-page brief) — the cold-generated, schema-validated artifact
 *   - WHY IT MATTERS (rationale) + EFFORT/RISK + CONFIDENCE + LIMITATIONS
 *   - STATUS (the proposal lifecycle) — always a PROPOSAL, never an auto-write.
 *
 * PUBLISHING AUTHORITY IS MANUAL. A ChangeProposal is a proposal only. Nothing
 * in this kernel writes to a live page. `publish: "manual"` is a structural
 * reminder carried on every proposal.
 *
 * PURE — types + Zod schema + pure derivations + (de)serialization only. No I/O.
 * The proposal PATHS (propose.ts) and PERSISTENCE (proposal-store.ts) live in
 * sibling files so this contract stays importable from any surface.
 */

import { z } from "zod";
import type { AuthoritativeFact } from "@/domains/decision/drafts/factual-entailment";

// ── EvidenceInput — the ONE normalized input the kernel consumes ──────────────

/** The demand + page context for a single opportunity. Structural on purpose:
 *  the evidence assembler owns HOW these fields are computed; the kernel only
 *  consumes this shape. */
export interface EvidenceInput {
  tenantId: string;
  /** The page the change lands on. `path` null = a brand-new page opportunity. */
  page: {
    path: string | null;
    url: string | null;
    label: string;
  };
  opportunity: {
    /** The primary demand phrase behind this opportunity. */
    query: string;
    /** Which proposal path this evidence routes to. */
    kind: ProposalKind;
    /** Operator-facing label ("Capture clicks", "Win AI citations", …). */
    opportunityType: string;
    /** For an existing-page edit: which field to rewrite. */
    field?: "title" | "meta";
    /** For an existing-page edit: the current value being improved. */
    currentValue?: string | null;
    /** The searcher's dominant intent (when/cost/how/where/who/list/compare). */
    intent?: string;
  };
  /** Everything that grounds a safe draft. All optional — the drafter + the
   *  validator degrade honestly when a field is absent. */
  evidence: {
    /** Plain-English facts the team established (GSC demand, a tracked AI prompt). */
    hints?: string[];
    /** The target page's own stored body text — turns ON factual entailment. */
    pageBodyText?: string | null;
    /** The page's section outline (existing-page edit context). */
    outline?: string[];
    /** Dated, sourced facts on file — back an allowed correction. */
    authoritativeFacts?: AuthoritativeFact[];
    /** This tenant's curated authoritative-source domains. */
    authoritativeSourceDomains?: string[];
    /** THE diagnosis that earned this action. No diagnosis, no drafter call. */
    diagnosis?: ActionDiagnosis;
  };
  /** Honest value sizing for the ranker. All optional — a missing figure never
   *  fabricates a number, it just sinks in the ranking. */
  sizing?: {
    /** Demand/score-derived rank input. */
    impactScore?: number | null;
    /** Honest monthly opportunity midpoint (never a raw impressions sum). */
    upsidePerMonth?: number | null;
  };
}

// ── Candidate diagnosis (decision truth replacement, 2026-07-27) ──────────────

/**
 * What the evidence actually justifies for one page or topic, decided BEFORE any
 * draft is written. Doing nothing is the default: a page is not a problem because
 * it is big. Only the two `act_` outcomes may become a ChangeProposal; the rest
 * are the honest answer and live in the run receipt, never as manufactured work.
 * Internal to Decision: NOT persisted as its own record and never a public type.
 */
export type CandidateAction =
  // No `act_new_page`: a page this account does not own is decided by the coverage ladder
  // over researched TOPICS, never by this per-page diagnosis over pages it already has.
  | "act_existing_page" | "consolidate"
  | "watch" | "research_needed" | "do_nothing";

/** The ONE action-specific gap that earns an action. Gross impressions are not here. */
export type CandidateGap = "ctr_deficit" | "recent_decline" | "serp_mismatch" | "ai_gap" | "technical";

export type DecisionCandidate = {
  action: CandidateAction;
  /** Required for every `act_` outcome; absent means nothing was proven. */
  gap?: CandidateGap;
  pageUrl?: string | null;
  /** The EXACT query the gap was measured on (never a page total). */
  query?: string | null;
  /** Clicks a fix could plausibly recover, from exact query metrics. Ranks
   *  opportunity: a huge page with no deficit ranks below a small real gap. */
  recoverableClicks: number;
  /** Plain-English why, carrying the exact numbers the receipt will show. */
  reason: string;
};

/** Action floors. A gap under ANY of these is not worth the operator's attention,
 *  so the honest answer is watch/do_nothing. Tuned against real data: a healthy
 *  page whose best query gap was 23 clicks must not produce work. */
export const MIN_QUERY_IMPRESSIONS = 500;
export const MIN_CTR_DEFICIT = 0.02;
export const MIN_RECOVERABLE_CLICKS = 50;

/**
 * EVIDENCE READINESS (evidence-qualified changes, 2026-07-27). A click gap proves
 * something is WRONG. It never proves WHAT TO CHANGE: the same gap is explained by
 * a weak title, a search feature eating the click, the wrong page ranking, an
 * ambiguous query, or nothing at all. So a gap opens an INVESTIGATION, and only the
 * exact evidence below can close it into an action.
 */
export type EvidenceReadiness = {
  /** Exact GSC rows for this query on this page. */
  gsc: boolean;
  /** The page's current title and description, the thing an edit would replace. */
  ownedCopy: boolean;
  /** A live results page observed for the EXACT candidate query, not a neighbour. */
  serp: boolean;
  /** Inspectable extracts of pages that actually rank or are cited FOR that query. */
  winners: number;
  /** The page's own WORDS beyond its title, so a claim about the page can be checked.
   *  No body store exists yet, so this is false everywhere today and High confidence
   *  on an edit is currently unreachable. That is the truth, not a gap to paper over. */
  body: boolean;
};

/** EVIDENCE COMPLETENESS ONLY: do I hold the things a diagnosis would need to read?
 *  This is a precondition, NEVER a permission to act. Holding a results page is not
 *  the same as knowing what it says (a live counterexample: Google already displayed
 *  this page's title with the searcher's exact words, so "the title is missing them"
 *  was never the problem). ActionDiagnosis below decides what may become Ready. */
export function evidenceComplete(r: EvidenceReadiness): boolean {
  return r.gsc && r.ownedCopy && r.serp;
}

/** WHY this page underperforms, in the vocabulary a diagnosis may conclude in. One
 *  cause per candidate, chosen by reading the evidence, never by token containment. */
export type DiagnosisCause =
  | "snippet_intent_mismatch"
  | "weak_value_promise"
  | "result_format_mismatch"
  | "wrong_page_ranking"
  | "cannibalization"
  | "content_coverage_gap"
  | "stale_or_inaccurate_copy"
  | "google_rewrite_already_matches"
  | "serp_market_mismatch"
  | "ambiguous_search_intent"
  | "unknown";

/** The single edit a diagnosed cause supports. `watch` and null are real answers. */
export type DiagnosedAction =
  | "title" | "meta" | "opening_answer" | "section"
  | "full_page" | "new_page" | "consolidate" | "watch";

/**
 * THE reasoning step between "this page underperforms" and "change this". Held
 * inside the existing candidate and receipt path: no new table, record, or route.
 *
 * `diagnosed` means the evidence NAMES a cause, the action follows from that cause,
 * at least one competing explanation is ruled out with its own evidence, and every
 * claim cites receipt keys. Anything else is `inconclusive`, which keeps the page
 * under investigation and spends nothing on drafting copy nobody can justify.
 */
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

/** A change may be drafted and shown as Ready only for a DIAGNOSED action naming a
 *  real edit. Evidence completeness alone never earns it. */
export function readyForAction(d: ActionDiagnosis | null | undefined): boolean {
  return !!d && d.status === "diagnosed" && d.action != null && d.action !== "watch"
    && d.evidenceKeys.length > 0 && d.alternativesRuledOut.length > 0;
}

/** Confidence follows EVIDENCE COMPLETENESS, never how good the draft reads. A
 *  proposal that admits it never saw the results page cannot be high confidence. */
export function confidenceFor(r: EvidenceReadiness, d?: ActionDiagnosis | null): ChangeProposal["confidence"] {
  if (!evidenceComplete(r) || (d !== undefined && !readyForAction(d))) return "low";
  return r.winners >= 2 && r.body ? "high" : "medium";
}

// ── ChangeProposal — the ONE persisted output ─────────────────────────────────

/** `new_page` is earned, never assumed: only the page by page comparison can prove this
 *  account reaches none of what the winning pages share (decision/new-page). */
export type ProposalKind = "existing_edit" | "new_page";

/** The proposal lifecycle. A proposal is NEVER an auto-write; `applied` is set
 *  only by the operator's own manual action downstream, never by the kernel. */
export type ProposalStatus =
  | "proposed" // generated + validated safe, awaiting the operator
  | "needs_review" // generated but the validator wants a human look before use
  | "rejected" // a safety gate rejected the draft — never shown as ready
  | "applied"; // the operator manually applied it (set downstream, not here)

export type ProposalRisk = "low" | "medium" | "high";
export type ProposalConfidence = "high" | "medium" | "low";

/** The exact change — a discriminated union. `existing_edit` carries a precise
 *  before→after field rewrite; `new_page` carries a full build brief. */
export type RecommendedChange =
  | {
      kind: "existing_edit";
      field: "title" | "meta" | "h1" | "answer_block" | "section";
      before: string | null;
      after: string;
    }
  | {
      kind: "new_page";
      proposedTitle: string;
      metaDescription: string;
      openingAnswer: string;
      outline: string[];
      faqQuestions: string[];
      schemaTypes: string[];
    };

/** A compact, frozen copy of what grounded this proposal — never a live handle.
 *  Enough for the operator to see "why Beacon recommends this" and for the
 *  validator to re-run on load. */
export type ProposalEvidence = {
  query: string;
  hints: string[];
  /** The count of grounding evidence refs the draft itself carried (>=1). */
  evidenceRefCount: number;
};

// ── ChangeBundle: the atomic components implemented together on one page ──────
// (canonical record, Slice 7). A bundle rides ON a ChangeProposal: the proposal
// stays the one persisted, ranked, validated record; the bundle is its deep,
// copy-ready form. Never a second pipeline, never a second status vocabulary.

export type BundleComponentKind = "title" | "meta" | "h1" | "opening_answer" | "section" | "internal_links" | "source_pack";

/** One exact, copy-ready component. Every component cites the receipt items
 *  that justify it; a component without evidence is never emitted (three
 *  grounded components beat eight padded ones). */
export type BundleComponent = {
  kind: BundleComponentKind;
  /** Operator-facing label ("Page title", "Opening answer", ...). */
  label: string;
  /** Exact current copy (null = the page has none today: a pure insertion). */
  before: string | null;
  /** Exact copy-ready replacement or insertion text. */
  after: string;
  /** Keys into receipt.items that justify this component (>= 1). */
  evidenceKeys: string[];
  /** review = touches facts or claims and deserves a human look first. */
  risk: "safe" | "review";
};

/** One piece of canonical evidence the bundle used, in plain English. */
export type BundleEvidenceItem = {
  /** Stable within the bundle; referenced by BundleComponent.evidenceKeys. */
  key: string;
  kind: "gsc_demand" | "keyword" | "serp" | "ai_observation" | "winning_page" | "page_extract" | "competitor" | "internal_link" | "diagnosis";
  /** Plain-English fact (never a raw id, provider name, or lab word). */
  fact: string;
  /** Freshness; null = an undated aggregate. */
  observedAt: string | null;
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
  receipt: {
    items: BundleEvidenceItem[];
    /** Evidence Beacon looked for and honestly does NOT have. */
    missing: string[];
    freshestObservedAt: string | null;
  };
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
  /** Coarse change family (meta|title|h1|answer|new_page|…) for identity/UI. */
  changeFamily: string;
  status: ProposalStatus;
  /** The exact, cold-generated change. */
  recommendedChange: RecommendedChange;
  /** One plain-English sentence: why this matters. */
  whyItMatters: string;
  estimatedEffortMinutes: number;
  riskLevel: ProposalRisk;
  confidence: ProposalConfidence;
  /** Honest caveats carried WITH the proposal (never hidden). Risks from the
   *  draft + any validator caution + the honest "no baseline yet" note. */
  limitations: string[];
  evidence: ProposalEvidence;
  /** Honest value sizing for the ranker (may be null — never fabricated). */
  impactScore: number | null;
  upsidePerMonth: number | null;
  /** The deep copy-ready form (Slice 7). Absent on atomic proposals and on
   *  every pre-bundle persisted row; ONE decoder serves both generations. */
  bundle?: ChangeBundle;
  /** The onboarding/research basis this proposal was generated under (truth
   *  convergence slice). A proposal whose basis is not the account's CURRENT basis
   *  is WITHHELD from the customer queue entirely at load, never deleted and never
   *  rewritten. Absent on pre-basis rows, which read as stale by definition. */
  basis?: string;
  /** STRUCTURAL: this is a proposal. The kernel never writes a live page. */
  publish: "manual";
  createdAt: string;
};

// ── Zod schema (re-validate on every load; reject tampered/legacy rows) ────────

const RecommendedChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing_edit"),
    field: z.enum(["title", "meta", "h1", "answer_block", "section"]),
    before: z.string().nullable(),
    after: z.string().min(1),
  }),
  z.object({
    kind: z.literal("new_page"),
    proposedTitle: z.string().min(1),
    metaDescription: z.string().min(1),
    openingAnswer: z.string().min(1),
    outline: z.array(z.string()),
    faqQuestions: z.array(z.string()),
    schemaTypes: z.array(z.string()),
  }),
]);

const ChangeBundleSchema: z.ZodType<ChangeBundle> = z.object({
  objective: z.string().min(1),
  metric: z.string().min(1),
  scope: z.object({ queries: z.array(z.string()), prompts: z.array(z.string()) }),
  components: z.array(z.object({
    kind: z.enum(["title", "meta", "h1", "opening_answer", "section", "internal_links", "source_pack"]),
    label: z.string().min(1),
    before: z.string().nullable(),
    after: z.string().min(1),
    evidenceKeys: z.array(z.string().min(1)).min(1),
    risk: z.enum(["safe", "review"]),
  })).min(1),
  receipt: z.object({
    items: z.array(z.object({
      key: z.string().min(1),
      kind: z.enum(["gsc_demand", "keyword", "serp", "ai_observation", "winning_page", "page_extract", "competitor", "internal_link", "diagnosis"]),
      fact: z.string().min(1),
      observedAt: z.string().nullable(),
    })),
    missing: z.array(z.string()),
    freshestObservedAt: z.string().nullable(),
  }),
  alternatives: z.array(z.object({ option: z.string().min(1), reason: z.string().min(1) })),
  risks: z.array(z.string()),
  confidenceReasons: z.array(z.string()),
  measurementPlan: z.string().min(1),
}).superRefine((b, ctx) => {
  // Referential integrity: unproven copy can never be served. Every component
  // must cite receipt items that actually exist.
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
  status: z.enum(["proposed", "needs_review", "rejected", "applied"]),
  recommendedChange: RecommendedChangeSchema,
  whyItMatters: z.string(),
  estimatedEffortMinutes: z.number(),
  riskLevel: z.enum(["low", "medium", "high"]),
  confidence: z.enum(["high", "medium", "low"]),
  limitations: z.array(z.string()),
  evidence: z.object({
    query: z.string(),
    hints: z.array(z.string()),
    evidenceRefCount: z.number(),
  }),
  impactScore: z.number().nullable(),
  upsidePerMonth: z.number().nullable(),
  bundle: ChangeBundleSchema.optional(),
  basis: z.string().optional(),
  publish: z.literal("manual"),
  createdAt: z.string(),
}) as z.ZodType<ChangeProposal>;

const PERSIST_VERSION = 1 as const;

/** Serialize a proposal for the persistence layer (versioned envelope). */
export function serializeChangeProposal(proposal: ChangeProposal): string {
  return JSON.stringify({ v: PERSIST_VERSION, proposal });
}

/** Parse + RE-VALIDATE a persisted proposal. A hand-edited row that no longer
 *  satisfies the contract can never be served as a trusted proposal. Fail-soft
 *  → null. */
export function deserializeChangeProposal(content: string | null | undefined): ChangeProposal | null {
  if (!content) return null;
  try {
    const obj = JSON.parse(content) as { v?: number; proposal?: unknown };
    if (!obj || obj.v !== PERSIST_VERSION) return null;
    const res = ChangeProposalSchema.safeParse(obj.proposal);
    return res.success ? res.data : null;
  } catch {
    return null;
  }
}

// ── pure derivations (identity, family, effort) ───────────────────────────────

/** Collapse a raw field/kind into the coarse family used for identity + UI. */
export function proposalFamily(input: EvidenceInput): string {
  if (input.opportunity.kind === "new_page") return "new_page";
  const f = (input.opportunity.field ?? "").toLowerCase();
  if (f === "title") return "title";
  if (f === "meta") return "meta";
  return "other";
}

/** Stable proposal id from the evidence input. */
export function proposalId(input: EvidenceInput): string {
  const pageKey = input.opportunity.kind === "new_page"
    ? `new::${input.opportunity.query.toLowerCase().trim()}`
    : (input.page.path ?? input.page.url ?? input.page.label).toLowerCase().trim();
  const suffix = input.opportunity.kind === "new_page" ? "new_page" : (input.opportunity.field ?? "edit");
  return `${input.tenantId}::${pageKey}::${input.opportunity.kind}::${suffix}`;
}

/** Coarse effort minutes by family (a real per-move figure overrides this). */
export function effortForFamily(family: string): number {
  if (family === "title" || family === "meta" || family === "h1") return 1;
  if (family === "answer") return 3;
  if (family === "new_page") return 60;
  return 5;
}
