/**
 * daily-experiment-planner (2026-06-30) — the PURE brain behind "Plan today's experiments".
 * Given candidate (page, lever) pairs + the proof ledger, it: (1) drops anything not
 * scientifically eligible (active treatment / active control / no-lift / compound / risk),
 * (2) scores the rest deterministically for "tonight value", (3) selects a diversified,
 * effort-bounded batch that intentionally spreads across page families + action families so
 * Beacon learns faster AND doesn't pile onto one family's controls.
 *
 * No I/O, no LLM, no paid calls. The caller builds candidates (GSC + research + DataForSEO);
 * this only decides what's safe + worth doing today.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import {
  deriveExperimentStates,
  assessEligibility,
  actionFamilyOf,
  type ExperimentFamily,
  type EligibilityReason,
  type ExternalFlags,
} from "./experiment-eligibility";
import { EXTREME_SHORTFALL_RATIO, type PowerAssessment } from "./power-analysis";
import { MIN_MULTIPLIER, MAX_MULTIPLIER, type LearnedPrior } from "@/domains/learning/experiment-prior";
import {
  computeLeverRetirementDecisions, RetirementIndex, type LeverRetirementDecision, type SettledLeverRow,
} from "./lever-retirement";

/** First path segment groups a family (iran-animals/*, iran-flags/*); top-level slugs are
 *  their own family. Generic — no hardcoded vocabulary. */
export function pageFamilyOf(url: string): string {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
  const segs = path.split("/").filter(Boolean);
  return segs.length >= 2 ? segs[0] : segs[0] ?? "root";
}

export type DailyCandidate = {
  url: string;
  actionFamily: ExperimentFamily;
  targetQuery: string;
  impressions: number;
  position: number;
  ctr: number;
  /** 0..1 share of page impressions from the target query. */
  ownership: number;
  /** Potential extra monthly clicks if CTR reached the position's expected rate. */
  ctrOpportunityClicks: number;
  effortMinutes: number;
  /** Candidate-data eligibility flags the ledger can't know (ownership/risk/research). */
  external?: ExternalFlags;
  /** Optional explicit page family (else derived from the URL). */
  pageFamily?: string;
  /** Pages this experiment INFLUENCES (internal-link destinations that receive authority). The
   *  planner caps links per destination and never lets an influenced page be a treated page too. */
  influencedUrls?: string[];
  /** R1 (2026-07-01): bounded 0.5..1.5 multiplier from the specialist-team debate (move-router
   *  adjustedScore/baseScore). Absent/1 = team silent or neutral - identical pre-team score. */
  teamScoreMultiplier?: number;
  /** Item 35 (2026-07-02): the power-analysis verdict for this candidate's page - can this page's
   *  own traffic and noise actually resolve the forecast effect within the batch's read window?
   *  Computed by the caller (build-today-preview.ts) from a bounded per-page daily-series read +
   *  the candidate's own numeric forecast (pick-expectations.ts forecastLow/forecastHigh); absent
   *  when no forecast exists yet (nothing to assess) or the read was skipped (budget/cache miss) -
   *  absence is treated as neutral, never as a penalty or an exclusion. */
  power?: PowerAssessment;
  /** Item 47 (2026-07-02): the learned win-rate prior for this exact (actionType, pageType,
   *  queryCluster) from src/domains/learning/experiment-prior.ts, resolved by the caller
   *  (build-daily-candidates.ts) from loadExperimentOutcomes. Bounded [0.85, 1.15], decided-only,
   *  >=3-sample with dimension backoff - the SAME discipline the worklist's demand-graph ranking
   *  already applies (load-graph.ts). Absent/neutral (multiplier 1, tag null) on a fresh tenant
   *  with no settled outcomes -> byte-identical plans. */
  learnedPrior?: LearnedPrior;
};

/** Item 81 (2026-07-02): a candidate admitted through a (pageFamily, lever) cell's ONE scheduled
 *  retest after 90 days of retirement carries this flag, frozen at selection time, so the card
 *  can say plainly "I am retesting this after it lost 3 times before." Absent on every ordinary
 *  candidate - never a re-derivation downstream. */
export type RetestFlag = { pageFamily: string; lever: string; decision: LeverRetirementDecision };

export type PlannerConfig = {
  maxExperiments?: number;
  effortBudgetMinutes?: number;
  maxPerPageFamily?: number;
  maxPerActionFamily?: number;
  maxHighTraffic?: number;
  highTrafficImpressions?: number;
  /** Cap on internal links pointing at the SAME destination in one batch (avoid an authority burst). */
  maxLinksPerDestination?: number;
  backups?: number;
  now?: Date;
};

const DEFAULTS = {
  maxExperiments: 10,
  effortBudgetMinutes: 45,
  maxPerPageFamily: 4,
  maxPerActionFamily: 4,
  maxHighTraffic: 2,
  highTrafficImpressions: 9000,
  maxLinksPerDestination: 1,
  backups: 2,
};

export type PlannedExperiment = DailyCandidate & {
  pageFamily: string;
  score: number;
  /** Item 81: present exactly when this pick is tonight's ONE scheduled retest of a
   *  previously-retired (pageFamily, lever) cell. Absent on every ordinary pick. */
  retest?: RetestFlag;
};
export type ExcludedReason = EligibilityReason | "page_family_cap" | "action_family_cap" | "high_traffic_cap" | "budget_full" | "over_max" | "influenced_conflict" | "underpowered" | "lever_retired";
export type ExcludedExperiment = {
  url: string;
  actionFamily: ExperimentFamily;
  reason: ExcludedReason;
  availableAt?: string;
  relatedProofIds?: string[];
};

export type ControlAvailabilitySummary = {
  /** Pages with NO active treatment/control — the clean pool a new batch can draw controls from. */
  cleanPages: number;
  byPageFamily: Record<string, number>;
  /** Whether the clean pool is large enough to anchor the selected batch (≥ MIN_CONTROLS each). */
  sufficient: boolean;
};

export type DailyExperimentPlan = {
  date: string;
  tenantId: string;
  candidatesEvaluated: number;
  selected: PlannedExperiment[];
  backups: PlannedExperiment[];
  excluded: ExcludedExperiment[];
  familyDistribution: Record<string, number>;
  leverDistribution: Record<string, number>;
  estimatedMinutes: number;
  controlAvailability: ControlAvailabilitySummary;
  /** Item 81: every (pageFamily, lever) cell with settled-loss history tonight - retired,
   *  retest_due, or active-again-after-a-win. Empty on a ledger with no qualifying losses
   *  (byte-identical to pre-item-81 behavior downstream). The caller (build-today-preview.ts)
   *  turns a retired/retest_due entry into the plain "I stopped..." sentence. */
  leverRetirements: LeverRetirementDecision[];
};

const CTR_CURVE: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.065, 6: 0.05, 7: 0.04, 8: 0.034, 9: 0.029, 10: 0.025 };
function expectedCtr(pos: number): number {
  const p = Math.round(pos);
  if (p <= 0) return 0.28;
  if (p <= 10) return CTR_CURVE[p];
  if (p <= 15) return 0.018;
  if (p <= 20) return 0.012;
  return 0.006;
}

/** Item 35 - the power-band score multiplier: a well-powered pick is unaffected, a marginal pick
 *  is downranked (still eligible - worth doing, just not tonight's FIRST choice when a
 *  well-powered alternative exists), an underpowered pick is downranked hard (it only survives
 *  selection at all when nothing better fills the batch - see EXTREME_SHORTFALL_RATIO for the
 *  harder hard-exclude line applied in the selection loop below). Absent power = neutral (1): a
 *  candidate the caller never assessed (no forecast yet, or the bounded read didn't reach it)
 *  must never be silently punished for a gate that hasn't run. */
function powerScoreFactor(power: PowerAssessment | undefined): number {
  if (!power) return 1;
  if (power.band === "well_powered") return 1;
  if (power.band === "marginal") return 0.6;
  return 0.25;
}

/** Item 47 (2026-07-02) - the learned-prior score factor: the SAME bounded multiplier the
 *  demand-graph worklist ranking already applies (see load-graph.ts / experiment-prior.ts),
 *  clamped again here defensively so a caller mistake can never push the nightly planner's score
 *  outside [MIN_MULTIPLIER, MAX_MULTIPLIER] even if it somehow attached an out-of-range value.
 *  Absent/neutral (multiplier 1) is the exact pre-item-47 score - a fresh tenant with no settled
 *  outcomes yields byte-identical plans. */
function learnedPriorScoreFactor(prior: LearnedPrior | undefined): number {
  if (!prior) return 1;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, prior.multiplier));
}

/** Deterministic "tonight value" — rewards page-1 rank, weak CTR, clear ownership, medium
 *  traffic; the CTR opportunity (extra clicks) is the spine. PURE. */
export function scoreCandidate(c: DailyCandidate): number {
  const exp = expectedCtr(c.position);
  const positionFactor = c.position >= 4 && c.position <= 12 ? 1 : c.position < 4 ? 0.7 : 0.5;
  const mediumFactor = c.impressions >= 500 && c.impressions <= 6000 ? 1 : 0.6;
  const weakCtr = exp > 0 ? Math.min(1.5, Math.max(0.3, exp / Math.max(c.ctr, exp * 0.05))) : 1;
  const ownershipFactor = 0.5 + Math.min(0.5, c.ownership);
  // The team's bounded, visible adjustment (R1). Neutral when the team abstained.
  const teamFactor = Math.max(0.5, Math.min(1.5, c.teamScoreMultiplier ?? 1));
  // Item 35 - a candidate this page's own traffic can't resolve within the window is worth less
  // tonight than one we can actually verify, even if the raw opportunity looks identical.
  const powerFactor = powerScoreFactor(c.power);
  // Item 47 - what the ledger has already learned about this exact (actionType, pageType,
  // queryCluster) tilts ties, never dominates (bounded to +/-15%, same discipline as the
  // worklist's demand-graph ranking).
  const priorFactor = learnedPriorScoreFactor(c.learnedPrior);
  return c.ctrOpportunityClicks * positionFactor * mediumFactor * (weakCtr / 1.5) * ownershipFactor * teamFactor * powerFactor * priorFactor;
}

/** Plan today's safe, diversified, effort-bounded batch. PURE. */
export function planDailyExperiments(input: {
  tenantId: string;
  date: string;
  candidates: DailyCandidate[];
  proofLedger: ShippedChangeRecord[];
  config?: PlannerConfig;
}): DailyExperimentPlan {
  const cfg = { ...DEFAULTS, ...(input.config ?? {}) };
  const now = input.config?.now ?? new Date();
  const states = deriveExperimentStates(input.proofLedger, now);

  const excluded: ExcludedExperiment[] = [];
  const eligible: PlannedExperiment[] = [];

  for (const c of input.candidates) {
    const elig = assessEligibility({ url: c.url, family: c.actionFamily, states, external: c.external });
    if (!elig.eligible) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: elig.reason, availableAt: elig.availableAt, relatedProofIds: elig.relatedProofIds });
      continue;
    }
    // Item 35 - honest degrade, not silent shrink: a MARGINAL or plain UNDERPOWERED pick still
    // enters the pool (scoreCandidate already downranks it, see powerScoreFactor) so the operator's
    // plan never quietly loses a slot to a gate they can't see. Only an EXTREME shortfall (the
    // forecast midpoint sits below half the page's own detectable floor - the test is doomed even
    // with patience) is hard-excluded, and the reason is recorded so nothing disappears silently.
    if (c.power && c.power.ratio < EXTREME_SHORTFALL_RATIO) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "underpowered" });
      continue;
    }
    eligible.push({ ...c, pageFamily: c.pageFamily ?? pageFamilyOf(c.url), score: scoreCandidate(c) });
  }
  eligible.sort((a, b) => b.score - a.score);

  // Item 81 - AUTO-RETIRE repeatedly-losing (pageFamily, lever) cells, with one scheduled
  // retest after 90 days. Computed fresh from the settled ledger every call (see
  // lever-retirement.ts) - nothing persisted, nothing to go stale. Applied AFTER scoring/sort
  // so the retest cell's single slot goes to tonight's BEST-scoring candidate in that cell, not
  // an arbitrary one. A ledger with no cell at >= RETIRE_LOSS_THRESHOLD settled losses and zero
  // wins yields an empty decision list and every candidate passes through untouched - the exact
  // pre-item-81 eligible/excluded shape (pinned by lever-retirement-wiring.test.ts).
  const settledRows: SettledLeverRow[] = input.proofLedger
    .filter((r) => r.verdict === "won" || r.verdict === "lost" || r.verdict === "inconclusive")
    .map((r) => ({ path: r.path, actionType: r.actionType, verdict: r.verdict, settledAt: r.measuredAt ?? r.shippedAt }));
  const leverRetirements = computeLeverRetirementDecisions(settledRows, now, pageFamilyOf, actionFamilyOf);
  const retirementIndex = new RetirementIndex(leverRetirements);
  const afterRetirement: PlannedExperiment[] = [];
  for (const e of eligible) {
    const admission = retirementIndex.admit(e.pageFamily, e.actionFamily);
    if (admission.blocked) {
      excluded.push({ url: e.url, actionFamily: e.actionFamily, reason: "lever_retired" });
      continue;
    }
    afterRetirement.push(admission.retest && admission.decision ? { ...e, retest: { pageFamily: e.pageFamily, lever: e.actionFamily, decision: admission.decision } } : e);
  }

  // Greedy diversified selection.
  const selected: PlannedExperiment[] = [];
  const backups: PlannedExperiment[] = [];
  const perPageFamily = new Map<string, number>();
  const perActionFamily = new Map<string, number>();
  let minutes = 0;
  let highTraffic = 0;
  const usedUrls = new Set<string>();
  const normPath = (u: string) => (u.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
  const selectedPaths = new Set<string>(); // treated page paths
  const influencedCount = new Map<string, number>(); // destination path → links pointing at it

  for (const e of afterRetirement) {
    if (usedUrls.has(e.url)) continue; // one experiment per page per batch
    const pf = perPageFamily.get(e.pageFamily) ?? 0;
    const af = perActionFamily.get(e.actionFamily) ?? 0;
    const isHigh = e.impressions >= cfg.highTrafficImpressions;
    const ePath = normPath(e.url);
    const influenced = (e.influencedUrls ?? []).map(normPath);

    let blockReason: ExcludedReason | null = null;
    if (selected.length >= cfg.maxExperiments) blockReason = "over_max";
    else if (minutes + e.effortMinutes > cfg.effortBudgetMinutes) blockReason = "budget_full";
    else if (pf >= cfg.maxPerPageFamily) blockReason = "page_family_cap";
    else if (af >= cfg.maxPerActionFamily) blockReason = "action_family_cap";
    else if (isHigh && highTraffic >= cfg.maxHighTraffic) blockReason = "high_traffic_cap";
    // INFLUENCE guards: don't treat a page another selected link feeds; don't link to a page we're
    // already treating; cap links per destination (avoid a simultaneous authority burst).
    else if (influencedCount.has(ePath)) blockReason = "influenced_conflict";
    else if (influenced.some((d) => selectedPaths.has(d))) blockReason = "influenced_conflict";
    else if (influenced.some((d) => (influencedCount.get(d) ?? 0) >= cfg.maxLinksPerDestination)) blockReason = "influenced_conflict";

    if (blockReason) {
      if (backups.length < cfg.backups && blockReason !== "over_max") backups.push(e);
      else excluded.push({ url: e.url, actionFamily: e.actionFamily, reason: blockReason });
      continue;
    }
    selected.push(e);
    usedUrls.add(e.url);
    selectedPaths.add(ePath);
    for (const d of influenced) influencedCount.set(d, (influencedCount.get(d) ?? 0) + 1);
    perPageFamily.set(e.pageFamily, pf + 1);
    perActionFamily.set(e.actionFamily, af + 1);
    minutes += e.effortMinutes;
    if (isHigh) highTraffic += 1;
  }

  // Control availability: clean pages (no active treatment/control) by family.
  const byPageFamily: Record<string, number> = {};
  let cleanPages = 0;
  const selectedUrls = new Set(selected.map((s) => s.url));
  for (const c of input.candidates) {
    const st = states.get(c.url.replace(/^https?:\/\/[^/]+/, "") || "/");
    const busy = st && (st.activeTreatments.length > 0 || st.activeControlAssignments.length > 0);
    if (!busy && !selectedUrls.has(c.url)) {
      cleanPages += 1;
      const pf = c.pageFamily ?? pageFamilyOf(c.url);
      byPageFamily[pf] = (byPageFamily[pf] ?? 0) + 1;
    }
  }

  const familyDistribution: Record<string, number> = {};
  const leverDistribution: Record<string, number> = {};
  for (const s of selected) {
    familyDistribution[s.pageFamily] = (familyDistribution[s.pageFamily] ?? 0) + 1;
    leverDistribution[s.actionFamily] = (leverDistribution[s.actionFamily] ?? 0) + 1;
  }

  return {
    date: input.date,
    tenantId: input.tenantId,
    candidatesEvaluated: input.candidates.length,
    selected,
    backups,
    excluded,
    familyDistribution,
    leverDistribution,
    estimatedMinutes: minutes,
    controlAvailability: { cleanPages, byPageFamily, sufficient: cleanPages >= Math.max(2, selected.length) },
    leverRetirements,
  };
}
