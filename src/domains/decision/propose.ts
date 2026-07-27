/**
 * decision/propose (CORE 100K decision kernel, 2026-07-22) — the TWO proposal
 * paths. Each turns one `EvidenceInput` into a validated `ChangeProposal` by
 * calling the EXISTING, trustworthy drafting harness (llm/structured-drafter)
 * — the kernel does NOT re-implement drafting or safety:
 *
 *   proposeExistingPageChange → draftAtomicEditStructured → AtomicEditDraft
 *   proposeNewPageChange       → draftCreatePageStructured → CreatePageBrief
 *
 * The drafter is gated + budgeted + schema-validated + fired through the
 * content firewalls; it FAILS CLOSED. Its `complete` fn is injectable, so the
 * whole path runs cold with zero paid calls in tests. After a draft lands, the
 * kernel runs the ONE validator (validate-proposal) and stamps the lifecycle
 * status — a rejected draft is returned as a `rejected` proposal, never dropped
 * silently and never presented as ready.
 *
 * PUBLISHING IS MANUAL: this returns a proposal. It NEVER writes a live page.
 *
 * server-only (imports the LLM harness). Deterministic under an injected
 * `complete`.
 */

import "server-only";

import {
  draftAtomicEditStructured,
  draftCreatePageStructured,
  type CompleteFn,
} from "@/domains/decision/llm/structured-drafter";
import type { AtomicEditDraft, CreatePageBrief } from "@/domains/decision/llm/schemas";
import {
  type EvidenceInput,
  type ChangeProposal,
  type RecommendedChange,
  proposalId,
  proposalFamily,
  effortForFamily,
  readyForAction,
} from "./contracts";
import { validateProposal, type ProposalValidation } from "./validate-proposal";

export type ProposalOutcome =
  | { status: "proposed"; proposal: ChangeProposal; validation: ProposalValidation }
  | { status: "no_draft"; reason: string; drafterStatus: string };

export type ProposeOptions = {
  /** Injectable completion fn (default = real OpenAI). Tests pass a fixture. */
  complete?: CompleteFn;
  now?: Date;
  bypassCache?: boolean;
  authoritativeSourceDomains?: readonly string[];
};

/** Build the immutable evidence snapshot carried on the proposal. */
function evidenceSnapshot(input: EvidenceInput, evidenceRefCount: number): ChangeProposal["evidence"] {
  return {
    query: input.opportunity.query,
    hints: [...(input.evidence.hints ?? [])],
    evidenceRefCount,
  };
}

/** Assemble the persisted ChangeProposal from a landed draft + its validation. */
function assemble(args: {
  input: EvidenceInput;
  change: RecommendedChange;
  whyItMatters: string;
  confidence: ChangeProposal["confidence"];
  draftRisks: string[];
  evidenceRefCount: number;
  now: Date;
  validation: ProposalValidation;
}): ChangeProposal {
  const { input, change, whyItMatters, confidence, draftRisks, evidenceRefCount, now, validation } = args;
  const family = proposalFamily(input);
  const isNew = input.opportunity.kind === "new_page";

  // Limitations = the draft's own risks + any validator caution + the honest
  // "no clean before/after baseline yet" note for a brand-new page.
  const limitations: string[] = [...draftRisks];
  if (validation.corrections.length) limitations.push(...validation.corrections);
  if (validation.verdict === "needs_review") {
    limitations.push(...validation.reasons);
  }
  if (isNew) {
    limitations.push("A brand-new page has no before/after baseline yet, so its first read is directional.");
  }

  const riskLevel: ChangeProposal["riskLevel"] =
    validation.verdict === "rejected" ? "high" : isNew ? "medium" : "low";

  return {
    id: proposalId(input),
    tenantId: input.tenantId,
    kind: input.opportunity.kind,
    pagePath: isNew ? null : input.page.path,
    pageUrl: isNew ? null : input.page.url,
    pageLabel: input.page.label,
    primaryQuery: input.opportunity.query,
    opportunityType: input.opportunity.opportunityType,
    changeFamily: family,
    status: validation.status,
    recommendedChange: change,
    whyItMatters,
    estimatedEffortMinutes: effortForFamily(family),
    riskLevel,
    confidence,
    limitations: [...new Set(limitations)],
    evidence: evidenceSnapshot(input, evidenceRefCount),
    impactScore: input.sizing?.impactScore ?? null,
    upsidePerMonth: input.sizing?.upsidePerMonth ?? null,
    publish: "manual",
    createdAt: now.toISOString(),
  };
}

/**
 * COLD-GENERATE an exact existing-page edit (title/meta rewrite) and validate
 * it into a ChangeProposal. Returns `no_draft` when the harness is off / budget-
 * blocked / could not produce a schema-valid draft (fail-closed).
 */
export async function proposeExistingPageChange(
  input: EvidenceInput,
  opts: ProposeOptions = {},
): Promise<ProposalOutcome> {
  const now = opts.now ?? new Date();
  // NO DRAFT SPEND BEFORE A DIAGNOSIS. A gap proves something is wrong and never what
  // to change, so a candidate whose results page does not accuse a specific field
  // costs nothing here: no completion call, no copy, no persisted proposal.
  const diagnosis = input.evidence.diagnosis;
  if (!readyForAction(diagnosis)) {
    return { status: "no_draft", reason: diagnosis?.explanation
      ?? "I checked the results page, but it does not yet show that the title is the problem.", drafterStatus: "not_diagnosed" };
  }
  const field = input.opportunity.field ?? "title";
  const draft = await draftAtomicEditStructured(
    {
      query: input.opportunity.query,
      pageLabel: input.page.label,
      field,
      currentValue: input.opportunity.currentValue ?? null,
      outline: input.evidence.outline ?? [],
      evidenceHints: input.evidence.hints ?? [],
      intent: input.opportunity.intent,
      tenantId: input.tenantId,
    },
    {
      complete: opts.complete,
      now,
      bypassCache: opts.bypassCache,
      authoritativeSourceDomains: opts.authoritativeSourceDomains ?? input.evidence.authoritativeSourceDomains,
    },
  );

  if (draft.status !== "drafted") {
    return { status: "no_draft", reason: draftReason(draft), drafterStatus: draft.status };
  }

  const value = draft.value as AtomicEditDraft;
  const change: RecommendedChange = {
    kind: "existing_edit",
    field: value.field,
    before: value.before,
    after: value.after,
  };

  // Validate FIRST against a placeholder status, then re-stamp — validation
  // decides the status, so we assemble twice-free by computing validation on a
  // provisional proposal shape.
  const provisional = assemble({
    input,
    change,
    whyItMatters: value.rationale,
    confidence: value.confidence,
    draftRisks: value.risks ?? [],
    // The COUNT IS THE EVIDENCE, never the drafter's own claim about it: a drafter
    // that said "evidenceRefs: 1" used to set this while its receipt held nothing.
    evidenceRefCount: diagnosis!.evidenceKeys.length,
    now,
    validation: NEUTRAL_VALIDATION,
  });
  // The gate judges "did the rewrite keep what this page is about" against the
  // candidate's OWN words. Without them it once fell back to one tenant's
  // vocabulary and rejected every draft for everyone else.
  const contextTokens = [...new Set(
    `${input.opportunity.query} ${input.page.label ?? ""} ${input.opportunity.currentValue ?? ""}`
      .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  )].sort();
  const validation = validateProposal(provisional, {
    contextTokens,
    pageBodyText: input.evidence.pageBodyText,
    // Ground the validator on the SAME blob the drafter grounded on (outline +
    // current value + hints), so anything the drafter was allowed to draw on is
    // grounding the entailment gate also accepts.
    evidenceText: [
      ...(input.evidence.outline ?? []),
      input.opportunity.currentValue ?? "",
      ...(input.evidence.hints ?? []),
    ]
      .filter(Boolean)
      .join(" "),
    authoritativeFacts: input.evidence.authoritativeFacts,
    sources: value.sources,
    authoritativeSourceDomains: opts.authoritativeSourceDomains ?? input.evidence.authoritativeSourceDomains,
    now,
  });

  const proposal = assemble({
    input,
    change,
    whyItMatters: value.rationale,
    confidence: value.confidence,
    draftRisks: value.risks ?? [],
    evidenceRefCount: diagnosis!.evidenceKeys.length,
    now,
    validation,
  });
  return { status: "proposed", proposal, validation };
}

/**
 * COLD-GENERATE a full new-page brief and validate it into a ChangeProposal.
 * Returns `no_draft` on a fail-closed harness result.
 */
export async function proposeNewPageChange(
  input: EvidenceInput,
  opts: ProposeOptions = {},
): Promise<ProposalOutcome> {
  const now = opts.now ?? new Date();
  const draft = await draftCreatePageStructured(
    {
      tenantId: input.tenantId,
      query: input.opportunity.query,
      pageLabel: input.page.label,
      competitorPages: input.evidence.competitorPages ?? [],
      fanoutQueries: input.evidence.fanoutQueries ?? [],
      evidenceHints: input.evidence.hints ?? [],
      referenceCandidates: input.evidence.referenceCandidates ?? [],
    },
    {
      complete: opts.complete,
      now,
      bypassCache: opts.bypassCache,
      authoritativeSourceDomains: opts.authoritativeSourceDomains ?? input.evidence.authoritativeSourceDomains,
    },
  );

  if (draft.status !== "drafted") {
    return { status: "no_draft", reason: draftReason(draft), drafterStatus: draft.status };
  }

  const value = draft.value as CreatePageBrief;
  const change: RecommendedChange = {
    kind: "new_page",
    proposedTitle: value.proposedTitle,
    metaDescription: value.metaDescription,
    openingAnswer: value.openingAnswer,
    outline: value.outline,
    faqQuestions: value.faqQuestions ?? [],
    schemaTypes: value.schemaTypes ?? [],
  };
  const why = `AI and Google are asked about "${input.opportunity.query}" and we do not have a page that answers it directly.`;

  const provisional = assemble({
    input,
    change,
    whyItMatters: why,
    confidence: value.confidence,
    draftRisks: value.risks ?? [],
    evidenceRefCount: (input.evidence.hints ?? []).length, // the grounding facts actually carried, never the drafter's own claim about them
    now,
    validation: NEUTRAL_VALIDATION,
  });
  const validation = validateProposal(provisional, {
    // Same principle as the existing-page path: ground on the drafter's own blob
    // (hints + fan-out sub-questions + competitor pages the brief studied).
    evidenceText: [
      ...(input.evidence.hints ?? []),
      ...(input.evidence.fanoutQueries ?? []),
      ...(input.evidence.competitorPages ?? []),
    ]
      .filter(Boolean)
      .join(" "),
    authoritativeFacts: input.evidence.authoritativeFacts,
    sources: value.sources,
    authoritativeSourceDomains: opts.authoritativeSourceDomains ?? input.evidence.authoritativeSourceDomains,
    now,
  });

  const proposal = assemble({
    input,
    change,
    whyItMatters: why,
    confidence: value.confidence,
    draftRisks: value.risks ?? [],
    evidenceRefCount: (input.evidence.hints ?? []).length, // the grounding facts actually carried, never the drafter's own claim about them
    now,
    validation,
  });
  return { status: "proposed", proposal, validation };
}

/** Route to the right path from the evidence's declared kind. */
export function proposeChange(input: EvidenceInput, opts: ProposeOptions = {}): Promise<ProposalOutcome> {
  return input.opportunity.kind === "new_page"
    ? proposeNewPageChange(input, opts)
    : proposeExistingPageChange(input, opts);
}

// ── internals ─────────────────────────────────────────────────────────────────

/** A no-op validation used only to assemble the provisional shape the validator
 *  reads (it inspects recommendedChange + primaryQuery, not status). */
const NEUTRAL_VALIDATION: ProposalValidation = {
  verdict: "needs_review",
  status: "needs_review",
  qualityStatus: "useful_but_needs_review",
  reasons: [],
  factViolations: [],
  corrections: [],
  safetyFlags: [],
  confidence: "medium",
};

function draftReason(
  draft: { status: string; reason?: string; errors?: string[] },
): string {
  if (draft.status === "off") return "Drafting is off (no LLM provider configured).";
  if (draft.status === "blocked_budget") return draft.reason ?? "Blocked by the drafting budget cap.";
  if (draft.status === "validation_failed") {
    return draft.reason ?? `Draft failed validation: ${(draft.errors ?? []).join("; ")}`;
  }
  return "No draft was produced.";
}
