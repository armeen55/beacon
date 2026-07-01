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
  type ExperimentFamily,
  type EligibilityReason,
  type ExternalFlags,
} from "./experiment-eligibility";

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
};

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

export type PlannedExperiment = DailyCandidate & { pageFamily: string; score: number };
export type ExcludedReason = EligibilityReason | "page_family_cap" | "action_family_cap" | "high_traffic_cap" | "budget_full" | "over_max" | "influenced_conflict";
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
  return c.ctrOpportunityClicks * positionFactor * mediumFactor * (weakCtr / 1.5) * ownershipFactor * teamFactor;
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
    eligible.push({ ...c, pageFamily: c.pageFamily ?? pageFamilyOf(c.url), score: scoreCandidate(c) });
  }
  eligible.sort((a, b) => b.score - a.score);

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

  for (const e of eligible) {
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
  };
}
