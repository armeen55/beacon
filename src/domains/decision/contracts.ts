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
    /** Plain-English facts the team established (GSC demand, a profound prompt). */
    hints?: string[];
    /** The target page's own stored body text — turns ON factual entailment. */
    pageBodyText?: string | null;
    /** The page's section outline (existing-page edit context). */
    outline?: string[];
    /** Dated, sourced facts on file — back an allowed correction. */
    authoritativeFacts?: AuthoritativeFact[];
    /** New-page seeds. */
    competitorPages?: string[];
    fanoutQueries?: string[];
    referenceCandidates?: string[];
    /** This tenant's curated authoritative-source domains. */
    authoritativeSourceDomains?: string[];
  };
  /** Honest value sizing for the ranker. All optional — a missing figure never
   *  fabricates a number, it just sinks in the ranking. */
  sizing?: {
    /** Demand/score-derived rank input. */
    impactScore?: number | null;
    /** Honest monthly opportunity midpoint (never a raw impressions sum). */
    upsidePerMonth?: number | null;
    /** A DataForSEO verdict exists for this topic (new-page confidence input). */
    hasSerpVerdict?: boolean;
  };
}

// ── ChangeProposal — the ONE persisted output ─────────────────────────────────

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
