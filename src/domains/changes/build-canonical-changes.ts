/**
 * build-canonical-changes (2026-07-01) — the PURE adapter that turns existing sources (ranked
 * worklist moves + today's daily plan + control reservations) into one deduped CanonicalChange[].
 * NO new persistence, NO new recommendation engine — it composes what already exists. One page+lever
 * has ONE identity across preparation → execution → measurement → result. Genuinely different levers
 * on a page stay separate; duplicate representations of the SAME edit collapse (most-advanced wins).
 */
import { normalizePath, type DailyExperimentPlanRecord, type ControlReservationRecord } from "@/domains/experiments/daily-plan-types";
import { itemStatus, LEVER_TO_ACTION_TYPE } from "@/domains/experiments/execution-state";
import { wixInstructions } from "@/domains/experiments/execution-checklist";
import { internalLinkRelevance } from "@/domains/evidence/relevance-gate";
import {
  changeTypeFamily, effortForFamily, expectedEvidenceStrength, deriveStatus,
  type CanonicalChange, type CanonicalStatus, type ProofSignal,
} from "./canonical-change";

/** Structural subset of a worklist TodayMove the adapter needs (keeps the domain free of app types). */
export type CanonicalMoveInput = {
  id: string;
  actionType: string;
  actionTone: "citation" | "clicks" | "experience" | "page" | string;
  query: string;
  targetUrl: string;
  pageLabel: string;
  why: string;
  rankWhy?: string;
  score?: number;
  demand?: number | null;
  proofStatus?: ProofSignal;
  alreadyMeasuring?: boolean;
  pageMeasuring?: boolean;
  preparedReady?: boolean;
  preparedDraftText?: string | null;
  before?: string | null;
  after?: string | null;
  alternateOpportunities?: string[];
  /** Move 2 — maturity presentation threaded from the proof ledger. */
  proofMaturity?: string | null; // MeasurementMaturity
  proofDirection?: string | null;
  proofLabel?: string | null; // the maturity headline
  proofNextCheckpoint?: string | null;
};

const OPPORTUNITY_LABEL: Record<string, string> = {
  citation: "Win AI citations",
  clicks: "Capture clicks",
  experience: "Fix experience",
  page: "New page",
};
function opportunityLabel(tone: string): string {
  return OPPORTUNITY_LABEL[tone] ?? "Improve page";
}

const LEVER_RECOMMENDATION: Record<string, string> = {
  meta: "Update the meta description with a factual one-liner",
  internal_link: "Add one contextual internal link",
  answer_block: "Move the direct answer to the top of the page",
  title: "Tighten the page title",
  h1: "Tighten the H1",
};

function changeId(tenantId: string, pagePath: string, family: string): string {
  return `${tenantId}::${pagePath}::${family}`;
}

/** A daily-plan selected item → CanonicalChange (today's picks; exact instructions + strong evidence). */
function fromPlanItem(
  tenantId: string,
  plan: DailyExperimentPlanRecord,
  e: DailyExperimentPlanRecord["selected"][number],
): CanonicalChange {
  const pagePath = normalizePath(e.url);
  const changeType = LEVER_TO_ACTION_TYPE[e.lever];
  const family = changeTypeFamily(changeType);
  const status = deriveStatus({ planItemStatus: itemStatus(plan.execution, e.id), selectedForToday: true });
  return {
    id: changeId(tenantId, pagePath, family),
    tenantId,
    pagePath,
    pageUrl: e.canonicalUrl || e.url,
    pageLabel: e.pageLabel,
    opportunityType: opportunityLabel(e.lever === "answer_block" ? "citation" : "clicks"),
    changeType,
    changeFamily: family,
    status,
    recommendation: LEVER_RECOMMENDATION[e.lever] ?? "Apply this change",
    exactInstructions: wixInstructions(e),
    before: e.currentText || null,
    after: e.proposedText || null,
    rationale: `Selected for today — “${e.targetQuery}”. Beacon will measure it against ${e.controls.length} comparison pages.`,
    estimatedEffortMinutes: e.effortMinutes,
    impactScore: 500, // today's picks rank prominently within their status view
    upside: null,
    riskLevel: "low",
    evidenceStrength: "strong", // reserved diff-in-diff controls
    measurementMethod: `Diff-in-diff vs ${e.controls.length} control pages`,
    selectedForToday: true,
    activeExperiment: status === "measuring",
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: null, // plan items execute via the Daily panel, not proof yet
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    qualityDecision: "approved", // plan items already passed the Move-4 quality gate
    qualityNote: null,
    sourceIds: [e.id],
    alternateOpportunities: [],
  };
}

/** A ranked worklist move → CanonicalChange. */
function fromMove(tenantId: string, m: CanonicalMoveInput, controlPaths: Set<string>): CanonicalChange {
  const pagePath = normalizePath(m.targetUrl);
  const family = changeTypeFamily(m.actionType);
  const isControl = controlPaths.has(pagePath);
  let status = deriveStatus({
    proofStatus: m.proofStatus,
    alreadyMeasuring: m.alreadyMeasuring,
    pageMeasuring: m.pageMeasuring || isControl,
    preparedReady: m.preparedReady,
  });
  // Move 4 backfill — surface a recommendation-quality signal on every actionable row.
  // Without the exact draft copy on a worklist move, assess the highest-value check we
  // have: does the target query fit this page? An off-topic rec is FLAGGED and demoted
  // out of high-confidence Ready (never presented as ready-to-ship).
  let qualityDecision: "approved" | "caution" | "flagged" = "approved";
  let qualityNote: string | null = null;
  if ((status === "ready" || status === "suggested") && m.query) {
    const fit = internalLinkRelevance(m.query, m.pageLabel);
    if (!fit.relevant) {
      qualityDecision = "flagged";
      qualityNote = "May be off-topic for this page — review before shipping.";
      if (status === "ready") status = "suggested";
    }
  }
  const proofResultLabel =
    m.proofStatus === "won" ? "Mature result" : m.proofStatus === "no_lift" || m.proofStatus === "no_clear_lift" ? "Mature result" : null;
  return {
    id: changeId(tenantId, pagePath, family),
    tenantId,
    pagePath,
    pageUrl: m.targetUrl,
    pageLabel: m.pageLabel,
    opportunityType: opportunityLabel(m.actionTone),
    changeType: m.actionType,
    changeFamily: family,
    status,
    recommendation: m.why,
    exactInstructions: status === "ready" ? m.preparedDraftText ?? null : null,
    before: m.before ?? null,
    after: m.after ?? null,
    rationale: m.rankWhy || m.why,
    estimatedEffortMinutes: effortForFamily(family),
    impactScore: m.score ?? m.demand ?? 0,
    upside: m.demand ?? null,
    riskLevel: family === "new_page" ? "medium" : "low",
    // Move 2 — evidence strength follows MATURITY when a proof exists: only a mature,
    // settled result is "strong"; an early/interim/overlapping read is "directional";
    // a collecting/blocked/pre-live record is "tracking". Falls back to the change's
    // expected strength when no proof is attached yet.
    evidenceStrength:
      m.proofMaturity === "mature_result" ? "strong"
      : m.proofMaturity === "collecting" || m.proofMaturity === "blocked_data" || m.proofMaturity === "scheduled" ? "tracking"
      : status === "measuring" || status === "result" ? "directional"
      : expectedEvidenceStrength(family),
    measurementMethod: expectedEvidenceStrength(family) === "strong" ? "Diff-in-diff vs comparison pages" : expectedEvidenceStrength(family) === "directional" ? "Tracked vs baseline + context" : "Tracked descriptively",
    selectedForToday: false,
    activeExperiment: status === "measuring",
    protectedControl: isControl,
    blockedReason: isControl ? "This page is a comparison control for a live experiment." : m.pageMeasuring ? "This page is mid-measurement — another change now would muddy the proof." : null,
    result: status === "result" ? (m.proofLabel ?? proofResultLabel) : null,
    measurementHeadline: status === "measuring" || status === "result" ? (m.proofLabel ?? null) : null,
    measurementDetail: (status === "measuring" || status === "result") && m.proofNextCheckpoint ? `Next read ${m.proofNextCheckpoint}` : null,
    nextCheckpoint: m.proofNextCheckpoint ?? null,
    attributionLimited: m.proofMaturity === "attribution_limited",
    qualityDecision,
    qualityNote,
    sourceIds: [m.id],
    alternateOpportunities: m.alternateOpportunities ?? [],
  };
}

const STATUS_RANK: Record<CanonicalStatus, number> = {
  result: 7, measuring: 6, verify: 5, apply: 4, ready: 3, blocked: 2, suggested: 1, skipped: 0,
};

export function buildCanonicalChanges(input: {
  tenantId: string;
  moves: CanonicalMoveInput[];
  plan: DailyExperimentPlanRecord | null;
  reservations: ControlReservationRecord[];
}): CanonicalChange[] {
  const controlPaths = new Set(input.reservations.filter((r) => r.status === "reserved" || r.status === "active").map((r) => normalizePath(r.controlPath)));
  const byId = new Map<string, CanonicalChange>();

  // Plan items first — they own their page+lever identity (today's selection / execution truth).
  if (input.plan) {
    for (const e of input.plan.selected) {
      const c = fromPlanItem(input.tenantId, input.plan, e);
      byId.set(c.id, c);
    }
  }
  // Moves next — collapse onto an existing id when present (keep the most-advanced lifecycle).
  for (const m of input.moves) {
    const c = fromMove(input.tenantId, m, controlPaths);
    const prev = byId.get(c.id);
    if (!prev) { byId.set(c.id, c); continue; }
    if (STATUS_RANK[c.status] > STATUS_RANK[prev.status]) {
      byId.set(c.id, { ...c, selectedForToday: prev.selectedForToday || c.selectedForToday, alternateOpportunities: [...new Set([...prev.alternateOpportunities, ...c.alternateOpportunities])] });
    } else {
      prev.alternateOpportunities = [...new Set([...prev.alternateOpportunities, ...c.alternateOpportunities])];
    }
  }
  return [...byId.values()];
}
