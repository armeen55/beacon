/** Existing-page summary changes use the canonical captured-page writer and reviewer. Publishing remains manual. */

import "server-only";

import type { CompleteFn } from "./llm/structured-drafter";
import { draftFieldForPage } from "./drafted-copy";
import { loadOwnedPageBodies } from "@/domains/evidence/pages/owned-context";
import { readFactChecks } from "@/domains/evidence/pages/fact-checks";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { resolveCurrentBasis } from "./load-proposals";
import { COPY_RULES } from "./copy-sanitize";
import { copyKey, REVIEW_CONTRACT } from "./proof"; import { openHold } from "./completeness";
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

type ProposalOutcome =
  | { status: "ready"; proposal: ChangeProposal; validation: ProposalValidation }
  /** A safety gate refused this draft. It earned no lifecycle stage, so the caller files it as
   *  history rather than queueing it, and does not pay to redraft the same failure. */
  | { status: "withdrawn"; proposal: ChangeProposal; validation: ProposalValidation }
  | { status: "no_draft"; reason: string; drafterStatus: string };

export type ProposeOptions = {
  /** Injectable completion fn (default = real OpenAI). Tests pass a fixture. */
  complete?: CompleteFn;
  now?: Date;
  bypassCache?: boolean;
  authoritativeSourceDomains?: readonly string[];
  /** THE PASS'S ONE ATTEMPT BUDGET, decremented BEFORE the charged call below so a refusal costs exactly what it
   *  cost. Absent means this call stands on its own, which is what a test and a single-shot caller want. */
  attempts?: { left: number; record?: (r: unknown) => void };
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
  evidenceRefCount: number;
  now: Date;
  validation: ProposalValidation;
}): ChangeProposal {
  const { input, change, whyItMatters, confidence, evidenceRefCount, now, validation } = args;
  const family = proposalFamily(input);

  // Limitations = the validator's cautions (the writer is no longer asked for risks; code owns caveats).
  const limitations: string[] = [];
  if (validation.corrections.length) limitations.push(...validation.corrections);
  if (validation.verdict === "needs_review") {
    limitations.push(...validation.reasons);
  }

  const riskLevel: ChangeProposal["riskLevel"] = validation.verdict === "rejected" ? "high" : "low";

  return {
    id: proposalId(input),
    tenantId: input.tenantId,
    kind: input.opportunity.kind,
    pagePath: input.page.path,
    pageUrl: input.page.url,
    pageLabel: input.page.label,
    primaryQuery: input.opportunity.query,
    opportunityType: input.opportunity.opportunityType,
    changeFamily: family,
    status: validation.verdict === "ready" ? "ready" : "needs_review",
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
 * it into a ChangeProposal. Returns `no_draft` when the harness is off / budget- blocked / could not produce a schema-valid draft (fail-closed).
 */
export async function proposeExistingPageChange(
  input: EvidenceInput,
  opts: ProposeOptions = {},
): Promise<ProposalOutcome> {
  const now = opts.now ?? new Date();
  // NO DRAFT SPEND BEFORE A DIAGNOSIS. A gap proves something is wrong and never what to change, so a candidate whose results page does not accuse a specific field
  // costs nothing here: no completion call, no copy, no persisted proposal.
  const diagnosis = input.evidence.diagnosis;
  if (!readyForAction(diagnosis)) {
    return { status: "no_draft", reason: diagnosis?.explanation
      ?? "The checked results page does not yet show that the title is the problem.", drafterStatus: "not_diagnosed" };
  }
  const field = input.opportunity.field ?? "title";
  const url = input.page.url;
  if (!url) return { status: "no_draft", reason: COPY_RULES.pageState.capture, drafterStatus: "evidence_required" };
  const [bodies, checked, basis] = await Promise.all([loadOwnedPageBodies(input.tenantId, [url]), readFactChecks(input.tenantId), resolveCurrentBasis(input.tenantId)]);
  if (basis == null) return { status: "no_draft", reason: "The current account basis could not be read; no summary was bought.", drafterStatus: "evidence_required" };
  const body = bodies.get(canonicalUrlKey(url));
  if (!body || !COPY_RULES.captureProof(body, now.getTime()).some(c => c.tenantId === input.tenantId)) return { status: "no_draft", reason: COPY_RULES.pageState.capture, drafterStatus: "evidence_required" };
  const refusals = new Map<string, string>(), key = proposalId(input), unsettled = new Set<string>(), creditStop = { hit: false };
  const draft = await draftFieldForPage({ field, body, query: input.opportunity.query, brief: diagnosis!.explanation, evidenceHints: input.evidence.hints ?? [], ownedPaths: [input.page.path ?? new URL(body.url).pathname], minutes: effortForFamily(proposalFamily(input)), checked, basis, refusalKey: key },
    { tenantId: input.tenantId, now, complete: opts.complete, bypassCache: opts.bypassCache, attempts: opts.attempts, refusals, unsettled, creditStop, settleKey: key });
  if (!draft) return { status: "no_draft", reason: refusals.get(key) ?? "No summary passed its captured-page checks.", drafterStatus: unsettled.has(key) || creditStop.hit ? "error" : opts.attempts && opts.attempts.left <= 0 ? "budget_spent" : "not_diagnosed" };
  const change: RecommendedChange = { kind: "existing_edit", field, before: draft.before, after: draft.after, units: draft.units };
  const provisional: ChangeProposal = { ...assemble({ input, change, whyItMatters: diagnosis!.explanation, confidence: "medium", evidenceRefCount: diagnosis!.evidenceKeys.length, now, validation: NEUTRAL_VALIDATION }),
    basis, estimatedEffortMinutes: draft.minutes, limitations: [...draft.draftNotes ?? []], reviewedCaptures: draft.reviewedCaptures, assignment: draft.assignment, claims: draft.claims, supportFacts: draft.supportFacts, preservation: draft.preservation, draftNotes: draft.draftNotes, ...(draft.gain ? { informationGain: draft.gain } : {}) };
  if (draft.reviewOf === COPY_RULES.pieceKey(draft) && draft.editor) provisional.semanticReview = { of: copyKey(provisional), version: REVIEW_CONTRACT, editor: draft.editor, claims: draft.review ?? [] };
  // The gate judges "did the rewrite keep what this page is about" against the candidate's OWN words. Without them it once fell back to one tenant's vocabulary and rejected every draft for everyone else.
  const contextTokens = [...new Set(
    `${input.opportunity.query} ${input.page.label ?? ""} ${input.opportunity.currentValue ?? ""}`
      .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2),
  )].sort();
  const validation = validateProposal(provisional, {
    contextTokens,
    pageBodyText: body.vocabulary,
    // THE PAGE'S OWN WORDS GROUND THE CLAIM, AND THE BRIEF NEVER DOES (campaign review, 2026-09-05). This grounded the
    // validator on the same blob the drafter was briefed with, hints included, so a figure that existed only in the
    // producer's own diagnosis line ("is shown 3,157 times in 90 days", `hintsFor` in opportunities.ts) was grounding
    // for a title that quoted it, and the row came back `ready` and was served. Three doors already refuse exactly
    // that: the writer's (`groundingOf`), the promotion door and the release sweep. This is the fourth and last.
    // What stays is what the page itself carries: its outline and the line being replaced.
    evidenceText: [
      ...(input.evidence.outline ?? []),
      input.opportunity.currentValue ?? "",
    ]
      .filter(Boolean)
      .join(" "),
    authoritativeFacts: input.evidence.authoritativeFacts,
    sources: draft.supportFacts.flatMap(f => f.sources ?? []),
    authoritativeSourceDomains: opts.authoritativeSourceDomains ?? input.evidence.authoritativeSourceDomains,
    now,
  });

  const proposal: ChangeProposal = { ...provisional, status: validation.verdict === "ready" ? "ready" : "needs_review", riskLevel: validation.verdict === "rejected" ? "high" : "low", limitations: [...new Set([...provisional.limitations, ...validation.corrections, ...(validation.verdict === "needs_review" ? validation.reasons : [])])] };
  if (openHold(proposal).blocking) proposal.status = "needs_review";
  return { status: validation.verdict === "rejected" ? "withdrawn" : "ready", proposal, validation };
}

// ── internals ─────────────────────────────────────────────────────────────────

/** A no-op validation used only to assemble the provisional shape the validator
 *  reads (it inspects recommendedChange + primaryQuery, not status). */
const NEUTRAL_VALIDATION: ProposalValidation = {
  verdict: "needs_review",
  qualityStatus: "useful_but_needs_review",
  reasons: [],
  limitations: [],
  factViolations: [],
  corrections: [],
  safetyFlags: [],
  confidence: "medium",
};
