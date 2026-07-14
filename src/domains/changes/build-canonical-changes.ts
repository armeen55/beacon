/**
 * build-canonical-changes (2026-07-01), the PURE adapter that turns existing sources (ranked
 * worklist moves + today's daily plan + control reservations) into one deduped CanonicalChange[].
 * NO new persistence, NO new recommendation engine: it composes what already exists. One page+lever
 * has ONE identity across preparation → execution → measurement → result. Genuinely different levers
 * on a page stay separate; duplicate representations of the SAME edit collapse (most-advanced wins).
 */
import { normalizePath, type DailyExperimentPlanRecord, type ControlReservationRecord } from "@/domains/experiments/daily-plan-types";
import { itemStatus, LEVER_TO_ACTION_TYPE } from "@/domains/experiments/execution-state";
import { wixInstructions } from "@/domains/experiments/execution-checklist";
import { internalLinkRelevance } from "@/domains/evidence/relevance-gate";
import { computeOpportunity, computeOpportunityFromGap, type OpportunityForecast } from "@/domains/forecast/opportunity-math";
import { computeSiblingCtrBasis, SIBLING_MIN_IMPRESSIONS_28D, type SiblingPageStat } from "@/domains/forecast/sibling-ctr-basis";
import {
  changeTypeFamily, effortForFamily, expectedEvidenceStrength, defaultEvidenceStrength, deriveStatus,
  type CanonicalChange, type CanonicalStatus, type ProofSignal,
} from "./canonical-change";
import { decideChangeAction } from "./decide-action";
import { isZeroClickTrap, zeroClickTrapReason } from "./zero-click-trap";

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
  /** Item 61: 90d CTR-curve opportunity (clicks left on the table) for the outcome range.
   *  Superseded by opportunity-math.ts (D7) when the raw position/ctr/impressions below are
   *  present; kept as the fallback path for callers that have not been updated yet. */
  ctrOpportunityClicks?: number | null;
  /** D7 (honest opportunity math) - the raw signal opportunity-math.ts needs to compute an
   *  honest range + basis sentence itself, instead of the caller pre-computing a bare clicks
   *  number. All optional: omitted -> honest "not enough history" path, never a fabricated
   *  range. Position/impressions come from the page's top real query. */
  topQueryPosition?: number | null;
  topQueryImpressions90d?: number | null;
  topQueryClicks90d?: number | null;
  /** A real, separately observed AI citation gap (for example, a named competitor
   * being cited). This prevents Google zero-click behavior from suppressing an
   * independently evidenced AEO move. */
  hasIndependentAeoEvidence?: boolean;
  /** D7 - the tenant's own bias-correction factor + empirical capture band, when the caller has
   *  loaded them from forecast-calibration.ts. Omitted -> forecastRange's honest defaults. */
  correctionFactor?: number | null;
  captureBand?: { low: number; high: number; n: number; isEmpirical: boolean } | null;
  settledResultsCount?: number | null;
  proofStatus?: ProofSignal;
  alreadyMeasuring?: boolean;
  pageMeasuring?: boolean;
  preparedReady?: boolean;
  preparedDraftText?: string | null;
  before?: string | null;
  after?: string | null;
  alternateOpportunities?: string[];
  /** Move 2, maturity presentation threaded from the proof ledger. */
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

/** Same djb2 hash opportunity-math.ts uses for hypothesisId, kept local so a plan-pick's
 *  already-computed forecast (buildPickExpectations, not a computeOpportunity() call) still gets
 *  an id in the SAME (tenant, page, lever, day) shape - one hypothesis space, two producers. */
function hashId(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
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
  const decision = decideChangeAction({ status, changeType, changeFamily: family, qualityDecision: "approved" }).decision;
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
    rationale: `Selected for today: “${e.targetQuery}”. Beacon will measure it against ${e.controls.length} comparison pages.`,
    estimatedEffortMinutes: e.effortMinutes,
    impactScore: 500, // today's picks rank prominently within their status view
    // D7: the plan pick already carries a numeric forecast from buildPickExpectations
    // (pick-expectations.ts) - the SAME honest CTR-curve + correction-factor + empirical
    // capture-band machinery opportunity-math.ts composes. `upside` is that range's midpoint,
    // never a raw demand number (plan items never had one here).
    upside:
      e.expectations?.forecastLow != null && e.expectations?.forecastHigh != null
        ? Math.round((e.expectations.forecastLow + e.expectations.forecastHigh) / 2)
        : null,
    expectedOutcome: e.expectations?.forecast ?? null,
    expectedOutcomeLow: e.expectations?.forecastLow ?? null,
    expectedOutcomeHigh: e.expectations?.forecastHigh ?? null,
    // Plan picks always promise the 14-day read (see pick-expectations.ts's changeOurMind line,
    // "If clicks do not move by the 14-day read...") - the same number, not a separate guess.
    expectedOutcomeDays: e.expectations?.forecastLow != null ? 14 : null,
    // Same deterministic id shape opportunity-math.ts uses (tenant+page+lever+day), so this plan
    // pick's hypothesis can be logged the same way even though its range came from
    // buildPickExpectations directly rather than a computeOpportunity() call.
    hypothesisId: e.expectations?.forecastLow != null ? hashId(`${tenantId}|${pagePath}|${e.lever}|${new Date().toISOString().slice(0, 10)}`) : null,
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
    decision,
    sourceIds: [e.id],
    alternateOpportunities: [],
  };
}

/** G8 (Wave 4, 2026-07-11) - the tenant's own sibling pool for sibling-ctr-basis.ts, built ONCE
 *  per buildCanonicalChanges call from the SAME moves this adapter already has (each move's own
 *  top query already carries position/impressions/clicks - no new GSC read). Scoped to exactly
 *  the one tenant this call is for (buildCanonicalChanges takes one tenantId), so a sibling can
 *  never cross a tenant boundary. Moves with no real position/impressions signal contribute
 *  nothing (never a fabricated sibling). */
function buildSiblingPool(moves: readonly CanonicalMoveInput[]): SiblingPageStat[] {
  const pool: SiblingPageStat[] = [];
  for (const m of moves) {
    if (m.topQueryPosition == null || !Number.isFinite(m.topQueryPosition)) continue;
    const impressions90d = m.topQueryImpressions90d ?? 0;
    if (!Number.isFinite(impressions90d) || impressions90d <= 0) continue;
    const clicks = Math.max(0, m.topQueryClicks90d ?? 0);
    pool.push({
      page: normalizePath(m.targetUrl),
      position: m.topQueryPosition,
      ctr: clicks / impressions90d,
      impressions28d: impressions90d / 3,
    });
  }
  return pool;
}

/** A ranked worklist move → CanonicalChange. */
function fromMove(tenantId: string, m: CanonicalMoveInput, controlPaths: Set<string>, siblingPool: readonly SiblingPageStat[]): CanonicalChange {
  const pagePath = normalizePath(m.targetUrl);
  const family = changeTypeFamily(m.actionType);
  const isControl = controlPaths.has(pagePath);
  let status = deriveStatus({
    proofStatus: m.proofStatus,
    alreadyMeasuring: m.alreadyMeasuring,
    pageMeasuring: m.pageMeasuring || isControl,
    preparedReady: m.preparedReady,
  });
  // Move 4 backfill, surface a recommendation-quality signal on every actionable row.
  // Without the exact draft copy on a worklist move, assess the highest-value check we
  // have: does the target query fit this page? An off-topic rec is FLAGGED and demoted
  // out of high-confidence Ready (never presented as ready-to-ship).
  let qualityDecision: "approved" | "caution" | "flagged" = "approved";
  let qualityNote: string | null = null;
  if ((status === "ready" || status === "suggested") && m.query) {
    const fit = internalLinkRelevance(m.query, m.pageLabel);
    if (!fit.relevant) {
      qualityDecision = "flagged";
      qualityNote = "May be off-topic for this page. Review before shipping.";
      if (status === "ready") status = "suggested";
    }
  }
  // A zero-click Google query disproves a click-capture pitch. It does NOT disprove a separately
  // observed AI citation gap. Hold every click move, plus non-click moves that are merely borrowing
  // Google's impressions as their rationale; preserve citation work backed by real AI evidence.
  if (
    qualityDecision === "approved" &&
    family !== "new_page" &&
    (status === "ready" || status === "suggested") &&
    isZeroClickTrap(m) &&
    (m.actionTone === "clicks" || !m.hasIndependentAeoEvidence)
  ) {
    qualityDecision = "flagged";
    qualityNote = zeroClickTrapReason(m.actionTone);
    if (status === "ready") status = "suggested";
  }
  const proofResultLabel =
    m.proofStatus === "won" ? "Mature result" : m.proofStatus === "no_lift" || m.proofStatus === "no_clear_lift" ? "Mature result" : null;
  // D7 (honest opportunity math) - one canonical forecast call. Prefers the raw position/ctr/
  // impressions signal (opportunity-math.ts's own honest CTR-curve + capture-band composition);
  // falls back to a pre-computed ctrOpportunityClicks (legacy callers) via the SAME forecastRange
  // math opportunity-math.ts calls internally, so neither path can silently disagree.
  const opportunityBase = {
    tenantId,
    page: pagePath,
    lever: m.actionType,
    correctionFactor: m.correctionFactor,
    captureBand: m.captureBand,
    settledResultsCount: m.settledResultsCount,
  };
  const opportunity: OpportunityForecast =
    m.topQueryPosition != null
      ? computeOpportunity({
          ...opportunityBase,
          currentPosition: m.topQueryPosition,
          impressions90d: m.topQueryImpressions90d,
          clicks90d: m.topQueryClicks90d,
        })
      : // Legacy fallback: the caller has not threaded the raw position/impressions signal
        // through yet, only a pre-computed 90d CTR-curve gap. Same forecastRange math, same
        // hypothesisId shape - never a second, divergent formula - just without the plain-English
        // position clause in the basis sentence (added once the caller supplies a real position).
        computeOpportunityFromGap(opportunityBase, m.ctrOpportunityClicks ?? 0);
  // G8 (Wave 4, 2026-07-11) - honest impact ranges on THIN history. opportunity-math.ts's own
  // forecast only ever compares THIS page against the industry-default CTR curve; when that
  // comparison abstains, the tenant's OWN sibling pages at a comparable position may still give a
  // defensible basis it cannot see. Attempted ONLY for the exact class of row the pilot found the
  // gap on: a clicks-tone move, a real position/impressions signal, unsized by opportunity-math,
  // and material impressions (the SAME floor sibling-ctr-basis.ts applies to siblings, so the
  // evidence gating this claim is never thinner than the evidence backing it). DISPLAY ONLY - see
  // canonical-change.ts's siblingBasis doc: never touches impactScore/upside/expectedOutcomeLow,
  // so ranking is byte-identical to before this gate existed.
  let siblingBasis: string | null = null;
  let siblingLowPerMonth: number | null = null;
  let siblingHighPerMonth: number | null = null;
  if (
    opportunity.lowPerMonth == null &&
    m.actionTone === "clicks" &&
    m.topQueryPosition != null &&
    Number.isFinite(m.topQueryPosition) &&
    m.topQueryImpressions90d != null &&
    Number.isFinite(m.topQueryImpressions90d) &&
    m.topQueryImpressions90d > 0
  ) {
    const ownImpressions28d = m.topQueryImpressions90d / 3;
    if (ownImpressions28d >= SIBLING_MIN_IMPRESSIONS_28D) {
      const ownCtr = Math.max(0, m.topQueryClicks90d ?? 0) / m.topQueryImpressions90d;
      const sibling = computeSiblingCtrBasis({
        ownPage: pagePath,
        ownPosition: m.topQueryPosition,
        ownCtr,
        ownImpressions28d,
        siblings: siblingPool,
      });
      if (sibling) {
        siblingBasis = sibling.basis;
        siblingLowPerMonth = sibling.lowPerMonth;
        siblingHighPerMonth = sibling.highPerMonth;
      }
    }
  }
  // Wave 3C - the base decision from this change's own type/family/status. changes-data.ts refines
  // it with the source move's cannibalization case (which this pure adapter cannot see) before the
  // list renders.
  const decision = decideChangeAction({ status, changeType: m.actionType, changeFamily: family, qualityDecision }).decision;
  return {
    id: changeId(tenantId, pagePath, family),
    tenantId,
    pagePath,
    pageUrl: m.targetUrl,
    pageLabel: m.pageLabel,
    primaryQuery: m.query,
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
    // impactScore stays a RANKING signal only (never shown to the operator as a claim) - it may
    // fall back to the raw demand score when no source score exists, which is fine for sort order
    // but would NOT be fine as a displayed "upside" number, which is why `upside` below is always
    // opportunity-math's own forecast midpoint, never m.demand.
    impactScore: m.score ?? m.demand ?? 0,
    // D7 (honest opportunity math): the midpoint of opportunity-math's own CTR-curve range -
    // never a raw impressions/demand-score sum. Null exactly when expectedOutcome is (not enough
    // history to size this honestly).
    upside: opportunity.lowPerMonth != null && opportunity.highPerMonth != null
      ? Math.round((opportunity.lowPerMonth + opportunity.highPerMonth) / 2)
      : null,
    // Item 61 / D7: the plain-English basis sentence from opportunity-math.ts (the tenant's own
    // CTR curve + settled-history capture band), replacing the old bare "roughly X to Y" line.
    // Null exactly when there is not enough history - see the honest fallback in
    // opportunity-math.ts, never a fabricated range.
    expectedOutcome: opportunity.basis,
    expectedOutcomeLow: opportunity.lowPerMonth,
    expectedOutcomeHigh: opportunity.highPerMonth,
    expectedOutcomeDays: opportunity.days,
    hypothesisId: opportunity.hypothesisId,
    // R14b (see-the-math) - the raw inputs behind a SIZED forecast, so the row can
    // open its own small math disclosure. Honest-fallback rows carry none (their
    // basis sentence already explains itself in prose). This path always sizes
    // with the default curve today, so the basis phrase matches opportunity-math's
    // own default-lead sentence, never a tenant-curve claim it did not make.
    forecastInputs:
      opportunity.lowPerMonth != null
        ? {
            impressions90d: m.topQueryImpressions90d ?? null,
            currentPosition: m.topQueryPosition ?? null,
            curveBasis: "your own click rates at each Google position",
          }
        : null,
    riskLevel: family === "new_page" ? "medium" : "low",
    // Move 2 / B1 fix - evidence strength follows real comparison data, never the lever
    // TYPE alone. Only a mature, settled result is "strong"; an early/interim/overlapping
    // read is "directional"; a collecting/blocked/pre-live record is "tracking". A bare
    // suggestion with NO proof and NO reserved controls gets the honest pre-comparison
    // default (never "strong" decoration - "Strong comparison" must mean Beacon actually
    // has comparison data, not that the lever type is theoretically diffable).
    evidenceStrength:
      m.proofMaturity === "mature_result" ? "strong"
      // E-39 D4 (review P2): "unresolved" (the retry bound exhausted, no data ever
      // arrived) has exactly as little evidence as "blocked_data" - never let it
      // fall through to "directional", which would imply a real early/interim read.
      : m.proofMaturity === "collecting" || m.proofMaturity === "blocked_data" || m.proofMaturity === "scheduled" || m.proofMaturity === "unresolved" ? "tracking"
      : status === "measuring" || status === "result" ? "directional"
      : defaultEvidenceStrength(family),
    measurementMethod: expectedEvidenceStrength(family) === "strong" ? "Diff-in-diff vs comparison pages once selected" : expectedEvidenceStrength(family) === "directional" ? "Tracked vs baseline + context" : "Tracked descriptively",
    selectedForToday: false,
    activeExperiment: status === "measuring",
    protectedControl: isControl,
    blockedReason: isControl ? "This page is a comparison control for a live experiment." : m.pageMeasuring ? "This page is mid-measurement. Another change now would muddy the proof." : null,
    result: status === "result" ? (m.proofLabel ?? proofResultLabel) : null,
    measurementHeadline: status === "measuring" || status === "result" ? (m.proofLabel ?? null) : null,
    measurementDetail: (status === "measuring" || status === "result") && m.proofNextCheckpoint ? `Next read ${m.proofNextCheckpoint}` : null,
    nextCheckpoint: m.proofNextCheckpoint ?? null,
    attributionLimited: m.proofMaturity === "attribution_limited",
    qualityDecision,
    qualityNote,
    decision,
    sourceIds: [m.id],
    alternateOpportunities: m.alternateOpportunities ?? [],
    siblingBasis,
    siblingLowPerMonth,
    siblingHighPerMonth,
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
  // G8 - this tenant's own sibling pool (see buildSiblingPool's doc): built once from the SAME
  // moves this one call already has, so a sibling can never cross the tenantId this call is for.
  const siblingPool = buildSiblingPool(input.moves);

  // Plan items first: they own their page+lever identity (today's selection / execution truth).
  if (input.plan) {
    for (const e of input.plan.selected) {
      const c = fromPlanItem(input.tenantId, input.plan, e);
      byId.set(c.id, c);
    }
  }
  // Moves next: collapse onto an existing id when present (keep the most-advanced lifecycle).
  for (const m of input.moves) {
    const c = fromMove(input.tenantId, m, controlPaths, siblingPool);
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
