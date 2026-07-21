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
  cautionOf,
  actionFamilyOf,
  type ExperimentFamily,
  type EligibilityReason,
  type ExternalFlags,
  type AttributionCaution,
} from "./experiment-eligibility";
import { expectedCtrAt } from "./pick-expectations";
import { MIN_MULTIPLIER, MAX_MULTIPLIER, type LearnedPrior } from "@/domains/learning/experiment-prior";
import { EFFECT_MIN_MULTIPLIER, EFFECT_MAX_MULTIPLIER, type EffectPrior } from "@/domains/learning/effect-size-prior";
import { learningEligibleVerdict } from "@/domains/proof-gsc/verdict-calibration";

// R6 (N12) - the honest Jaccard floors for the intra-batch same-query check below: two
// candidates in tonight's own batch are only treated as competing for the same searches when
// each side has at least MIN_QUERIES_FOR_OVERLAP_JUDGMENT queries and their Jaccard clears
// MIN_QUERY_OVERLAP_JACCARD, so "one shared generic query" is never counted as evidence.
const MIN_QUERY_OVERLAP_JACCARD = 1 / 3;
const MIN_QUERIES_FOR_OVERLAP_JUDGMENT = 2;

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
  /** R6 / N12 (2026-07-03): every query this page's own change is really chasing, impression-
   *  sorted, when the caller has one (build-today-preview.ts's queriesByUrl - the page's real
   *  GSC top queries, already computed for the keyword-research brief). Absent falls back to
   *  the singleton [targetQuery] - the honest default when only one query is known. This is the
   *  set the same-query blocking check below compares with the ledger's own targetQueries
   *  Jaccard floors, so a candidate is never blocked on a query it doesn't actually chase. */
  relatedQueries?: ReadonlyArray<string>;
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
  /** Item 47 (2026-07-02): the learned win-rate prior for this exact (actionType, pageType,
   *  queryCluster) from src/domains/learning/experiment-prior.ts, resolved by the caller
   *  (build-daily-candidates.ts) from loadExperimentOutcomes. Bounded [0.85, 1.15], decided-only,
   *  >=3-sample with dimension backoff - the SAME discipline the worklist's demand-graph ranking
   *  already applies (load-graph.ts). Absent/neutral (multiplier 1, tag null) on a fresh tenant
   *  with no settled outcomes -> byte-identical plans. */
  learnedPrior?: LearnedPrior;
  /** R5 / N15 (2026-07-03): the learned EFFECT-SIZE prior for this exact (lever family,
   *  page-type band) from src/domains/learning/effect-size-prior.ts, resolved by the caller
   *  (build-today-preview.ts) from the SAME gated ledger read as learnedPrior. Bounded
   *  [0.8, 1.3], decided-only, >= 3 settled magnitudes per bucket with backoff to the lever
   *  then the site mean. Absent/neutral (multiplier 1, tag null) on a fresh tenant ->
   *  byte-identical plans. Complements learnedPrior: that one learns how OFTEN a kind of
   *  change wins, this one learns how MUCH it moved clicks when it settled. */
  effectPrior?: EffectPrior;
  /** N46 (R6, 2026-07-03): this candidate's own evidence-freshness verdict from
   *  src/domains/changes/opportunity-expiry.ts (classifyOpportunityFreshness), resolved by the
   *  caller (build-today-preview.ts) from whatever dated evidence it actually has for this pick.
   *  Absent (the default) means "nothing to judge" and is treated as fresh, never as a penalty -
   *  a fresh tenant or a caller that never wires evidence dates yields byte-identical plans to
   *  before N46 existed. Only "expired" changes selection (see ExcludedReason
   *  "evidence_expired"); "aging" is presentation-only and never touches the planner. */
  evidenceFreshness?: "fresh" | "aging" | "expired";
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
  /** E-39 D1: present when this pick is admitted WITH CAUTION (it is a comparison
   *  page for a live measurement, or mid-measurement itself, or has a thin
   *  comparison pool). The page is safe to ship; the caution is carried so the
   *  card can say so plainly and the measurement reads one confidence tier lower.
   *  Absent on a fully clean pick. */
  attributionCaution?: AttributionCaution;
};
export type ExcludedReason = EligibilityReason | "page_family_cap" | "action_family_cap" | "high_traffic_cap" | "budget_full" | "over_max" | "influenced_conflict" | "lever_retired" | "interference_hold" | "last_clean_donor" | "query_overlap_hold" | "evidence_expired" | "prerequisite_pending";
export type ExcludedExperiment = {
  url: string;
  actionFamily: ExperimentFamily;
  reason: ExcludedReason;
  availableAt?: string;
  relatedProofIds?: string[];
  /** Item N14 / N16 / R6 N12 / N45: present only for reasons "interference_hold",
   *  "last_clean_donor", "query_overlap_hold", and "prerequisite_pending" - the
   *  plain first-person sentence naming WHY (e.g. "I am holding this because the
   *  page shares its template family with 3 changes still measuring." or "I am
   *  holding this page because it is the last clean comparison page for a change
   *  I am still measuring on /iran-flags." or "I am holding this because it
   *  competes for the same searches as a change I am already measuring on
   *  /persian-cat." or "Fix the indexing problem on /iran-flags first.
   *  Optimizing a page Google is told to ignore wastes the work."). Absent for
   *  every other exclusion reason. */
  plainReason?: string;
};

/** Item N14: the per-candidate interference read the caller (build-daily-
 *  candidates.ts / build-today-preview.ts) has already computed from
 *  interference-graph.ts, keyed by the SAME host-stripped path
 *  experiment-eligibility.ts uses. Optional - a caller that never wires this
 *  (the default, undefined map) sees byte-identical plans to before N14
 *  existed. Kept as a plain lookup (not the full InterferenceGraphResult
 *  type) so this module stays free of a hard dependency on proof-gsc's
 *  interference-graph.ts; the caller does the one-line adaptation. */
export type InterferenceHoldLookup = ReadonlyMap<string, { hold: boolean; reason: string }>;

/** N16 (R5, 2026-07-03): pages that are the LAST clean comparison page for an
 *  open measurement, keyed by the SAME host-stripped path convention as
 *  InterferenceHoldLookup, valued with the plain first-person hold sentence
 *  (control-contamination.ts's lastCleanDonorHoldSentence). Treating such a
 *  page tonight would leave that measurement with no clean comparison at all,
 *  forcing the weaker median-band read. Optional - a caller that never wires
 *  this (the default, undefined) sees byte-identical plans. NOTE: this is a
 *  planner-side AVOIDANCE input only; frozen-pool ordering (N13) is inviolable
 *  and nothing here re-selects or re-ranks any donor. */
export type LastCleanDonorHoldLookup = ReadonlyMap<string, string>;

/** R6 (N12, 2026-07-03): the NARROW, query-overlap-only interference read the
 *  caller computes from interference-graph.ts's computeQueryOverlapHoldsForLedger
 *  (query_overlap edges only - never same_template_family or linked_page_treated,
 *  the too-aggressive N14 edge kinds documented as not-yet-safe-to-flip-live).
 *  Keyed by the SAME host-stripped path convention as InterferenceHoldLookup.
 *  Optional - a caller that never wires this (the default, undefined) sees
 *  byte-identical plans to before N12 existed. Kept as its own type (not reused
 *  as InterferenceHoldLookup) so a future caller can wire N14's full hold and
 *  N12's narrow hold independently, each with its own honest ExcludedReason. */
export type QueryOverlapHoldLookup = ReadonlyMap<string, { hold: boolean; reason: string }>;

/** N45 (R21, 2026-07-03): prerequisite holds a caller may compute for candidates
 *  whose prerequisite (a technical fix, a hub page, or schema) has not shipped,
 *  keyed by the candidate's OWN url (host-stripped path, same convention as the
 *  other lookups) and valued with the plain first-person hold sentence ("Fix the
 *  indexing problem on /X first. ..."). A candidate whose prerequisite is still
 *  pending is held with reason "prerequisite_pending" until the prerequisite
 *  ships. Optional - omitted (the default) yields byte-identical plans to before
 *  N45 existed. Kept as a plain path->sentence map (like LastCleanDonorHoldLookup)
 *  so this module never depends on a specific producer; the daily levers
 *  (content/link/answer edits) can never carry a prerequisite, so the original
 *  dependency-planner producer was deleted 2026-07-21 as provably inert and no
 *  production caller wires this today. */
export type PrerequisiteHoldLookup = ReadonlyMap<string, string>;

/** R6 (N12): the query set a candidate is really chasing - relatedQueries when
 *  the caller supplied it, else the honest singleton fallback [targetQuery]. */
function candidateQuerySet(c: Pick<DailyCandidate, "targetQuery" | "relatedQueries">): string[] {
  const list = c.relatedQueries && c.relatedQueries.length > 0 ? c.relatedQueries : [c.targetQuery];
  return [...new Set(list.map((q) => (q ?? "").trim().toLowerCase()).filter(Boolean))];
}

/** R6 (N12): same Jaccard-plus-floors test interference-graph.ts's
 *  buildQueryOverlapEdges applies to ledger ships, reused verbatim here for
 *  TWO candidates inside tonight's own batch (intra-batch blocking) rather
 *  than reimplemented. A single shared query (either side's SMALLER set below
 *  MIN_QUERIES_FOR_OVERLAP_JUDGMENT) never fires - the exact same honest floor
 *  as the ledger-side check, so "one shared generic query" is never treated as
 *  evidence in either direction. */
function queriesOverlap(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const setA = new Set(a);
  const setB = new Set(b);
  const smaller = Math.min(setA.size, setB.size);
  if (smaller < MIN_QUERIES_FOR_OVERLAP_JUDGMENT) return false;
  let shared = 0;
  for (const q of setA) if (setB.has(q)) shared++;
  const union = setA.size + setB.size - shared;
  const jaccard = union > 0 ? shared / union : 0;
  return jaccard >= MIN_QUERY_OVERLAP_JACCARD;
}

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

// R9 (2026-07-03): this file used to carry its OWN copy of the CTR-by-position
// table. It now reads the ONE canonical curve (tenant-ctr-curve.ts, via
// pick-expectations' expectedCtrAt) - byte-identical values, one source.
const expectedCtr = expectedCtrAt;

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

/** R5 / N15 (2026-07-03) - the effect-size score factor: same posture as
 *  learnedPriorScoreFactor above, defensively re-clamped to [0.8, 1.3] so a caller
 *  mistake can never push the nightly score outside the effect prior's own band.
 *  Absent/neutral (multiplier 1) is the exact pre-N15 score. */
function effectPriorScoreFactor(prior: EffectPrior | undefined): number {
  if (!prior) return 1;
  return Math.max(EFFECT_MIN_MULTIPLIER, Math.min(EFFECT_MAX_MULTIPLIER, prior.multiplier));
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
  // Item 47 - what the ledger has already learned about this exact (actionType, pageType,
  // queryCluster) tilts ties, never dominates (bounded to +/-15%, same discipline as the
  // worklist's demand-graph ranking).
  const priorFactor = learnedPriorScoreFactor(c.learnedPrior);
  // R5 / N15 - how MUCH changes like this moved clicks when they settled (the magnitude
  // twin of the win-rate prior above). Bounded to [0.8, 1.3]; neutral when no bucket has
  // 3+ settled magnitudes, so a fresh tenant scores byte-identically.
  const effectFactor = effectPriorScoreFactor(c.effectPrior);
  return c.ctrOpportunityClicks * positionFactor * mediumFactor * (weakCtr / 1.5) * ownershipFactor * teamFactor * priorFactor * effectFactor;
}

/**
 * Fail-closed calibration quarantine, review fix 9 (2026-07-11): the settled rows
 * lever retirement (item 81) folds over. Only won/lost TRUST is quarantined:
 *   - an uncalibrated won/lost is excluded (it can neither retire a lever nor
 *     unsuppress one - learningEligibleVerdict fails closed);
 *   - an INCONCLUSIVE row flows exactly as it did before the quarantine,
 *     regardless of calibration - it was never a trust-bearing claim, and the
 *     quarantine must not change any non-decided bucket;
 *   - a calibrated won/lost flows exactly as before.
 * Exported for a direct test pin. PURE.
 */
export function settledLeverRowsForRetirement(
  proofLedger: ReadonlyArray<
    Pick<ShippedChangeRecord, "path" | "actionType" | "verdict" | "measuredAt" | "shippedAt" | "calibrationVersion">
  >,
): SettledLeverRow[] {
  const out: SettledLeverRow[] = [];
  for (const r of proofLedger) {
    const verdict = r.verdict === "inconclusive" ? "inconclusive" : learningEligibleVerdict(r);
    if (verdict !== "won" && verdict !== "lost" && verdict !== "inconclusive") continue;
    out.push({ path: r.path, actionType: r.actionType, verdict, settledAt: r.measuredAt ?? r.shippedAt });
  }
  return out;
}

/** Plan today's safe, diversified, effort-bounded batch. PURE. */
export function planDailyExperiments(input: {
  tenantId: string;
  date: string;
  candidates: DailyCandidate[];
  proofLedger: ShippedChangeRecord[];
  config?: PlannerConfig;
  /** Item N14: per-candidate interference read (interference-graph.ts),
   *  keyed by host-stripped path. Optional - omitted (the default) yields
   *  byte-identical plans to before N14 existed. */
  interference?: InterferenceHoldLookup;
  /** N16: last-clean-donor holds (see LastCleanDonorHoldLookup). Optional -
   *  omitted (the default) yields byte-identical plans to before N16 existed. */
  lastCleanDonorHolds?: LastCleanDonorHoldLookup;
  /** R6 (N12): the narrow query-overlap-only interference read (see
   *  QueryOverlapHoldLookup) - a candidate whose queries overlap an OPEN
   *  measurement's target queries is held with reason "query_overlap_hold".
   *  Optional - omitted (the default) yields byte-identical plans to before
   *  N12 existed. */
  queryOverlapHolds?: QueryOverlapHoldLookup;
  /** N45 (R21): prerequisite holds (see PrerequisiteHoldLookup) - a candidate
   *  whose prerequisite (a technical fix, a hub page, or schema) is still
   *  pending is held with reason "prerequisite_pending". Optional - omitted
   *  (the default) yields byte-identical plans to before N45 existed. */
  prerequisiteHolds?: PrerequisiteHoldLookup;
}): DailyExperimentPlan {
  const cfg = { ...DEFAULTS, ...(input.config ?? {}) };
  const now = input.config?.now ?? new Date();
  const states = deriveExperimentStates(input.proofLedger, now);
  const normPathForInterference = (u: string) =>
    (u.replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "") || "/");

  const excluded: ExcludedExperiment[] = [];
  const eligible: PlannedExperiment[] = [];

  for (const c of input.candidates) {
    const elig = assessEligibility({ url: c.url, family: c.actionFamily, states, external: c.external });
    if (!elig.eligible) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: elig.reason, availableAt: elig.availableAt, relatedProofIds: elig.relatedProofIds });
      continue;
    }
    // N46 (R6, 2026-07-03) - EXPIRED EVIDENCE: a candidate whose own evidence has already
    // expired (opportunity-expiry.ts's classifyOpportunityFreshness - stale SERP/teardown/GSC/
    // seasonal/keyword-library evidence, or a seasonal window that already passed) is skipped
    // tonight rather than shipped on a pitch Beacon no longer trusts. This is selection-only -
    // nothing is deleted, and the SAME row is picked back up automatically once its evidence
    // next refreshes (evidenceFreshness simply stops being "expired" on a later call). "aging"
    // is presentation-only and never reaches this check. Absent evidenceFreshness (the default)
    // is treated as fresh, so a caller that never wires evidence dates sees byte-identical plans.
    if (c.evidenceFreshness === "expired") {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "evidence_expired" });
      continue;
    }
    // Item N14 - the general interference graph generalizes N12 (same-query
    // blocking) and N13 (control contamination): a candidate whose target
    // page has a SIGNIFICANT interference edge into an in-flight measurement
    // (a directly linked page, a same-template-family page, overlapping
    // search demand, or a sitewide shock still being measured elsewhere)
    // gets the same hold treatment as an active-treatment/control exclusion,
    // with the plain reason threaded through so the operator sees WHY, not
    // just a bare status code. Only fires when the caller wired the lookup
    // (interference-graph.ts's honest floors already keep a weak edge from
    // ever reaching `hold: true`); an unwired caller sees byte-identical
    // behavior to every planner version before N14.
    const holdEntry = input.interference?.get(normPathForInterference(c.url));
    if (holdEntry?.hold) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "interference_hold", plainReason: holdEntry.reason });
      continue;
    }
    // N16 (R5) - SUSTAINABLE CONTROL POOL: a page that is the LAST clean
    // comparison page for an open measurement is held tonight, same pattern
    // as the interference hold above. Treating it would exhaust that
    // measurement's frozen donor pool entirely (no clean donor left to
    // promote), forcing the weaker median-band read. The plain sentence rides
    // plainReason so the operator sees WHY, never a bare status code. Only
    // fires when the caller wired the lookup; an unwired caller sees
    // byte-identical behavior to every planner version before N16.
    const donorHold = input.lastCleanDonorHolds?.get(normPathForInterference(c.url));
    if (donorHold) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "last_clean_donor", plainReason: donorHold });
      continue;
    }
    // R6 (N12) - SAME-QUERY BLOCKING, part 1: never pick a candidate whose target
    // queries overlap an OPEN measurement's target queries (the ledger-native
    // targetQueries Jaccard, computed by the caller from interference-graph.ts's
    // query_overlap edges - see QueryOverlapHoldLookup). This is the narrow subset
    // of N14's full interference hold that is safe to flip live today (see N14's
    // master-plan note on why the full graph is not yet flipped). Only fires when
    // the caller wired the lookup; an unwired caller sees byte-identical behavior.
    const queryHold = input.queryOverlapHolds?.get(normPathForInterference(c.url));
    if (queryHold?.hold) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "query_overlap_hold", plainReason: queryHold.reason });
      continue;
    }
    // N45 (R21) - PREREQUISITE HOLD: a candidate whose prerequisite is still
    // pending (a technical indexing fix on the same page, a hub page it links
    // into not built yet, or the schema its rich result needs) is held tonight
    // rather than shipped on work that would be wasted until the prerequisite
    // lands. Same additive pattern as the interference/donor/query holds above:
    // the plain sentence rides plainReason so the operator sees WHY, and the
    // SAME row is picked up automatically once its prerequisite ships (the
    // caller's dependency plan simply stops listing it). Only fires when the
    // caller wired the lookup; an unwired caller sees byte-identical behavior.
    const prereqHold = input.prerequisiteHolds?.get(normPathForInterference(c.url));
    if (prereqHold) {
      excluded.push({ url: c.url, actionFamily: c.actionFamily, reason: "prerequisite_pending", plainReason: prereqHold });
      continue;
    }
    // E-39 D1: a caution-eligible pick (active comparison page / mid-measurement /
    // thin comparison pool) is SELECTABLE, not frozen out - carry its caution so
    // the card explains it and the measurement reads one tier lower.
    const attributionCaution = cautionOf(elig) ?? undefined;
    eligible.push({ ...c, pageFamily: c.pageFamily ?? pageFamilyOf(c.url), score: scoreCandidate(c), attributionCaution });
  }
  eligible.sort((a, b) => b.score - a.score);

  // R6 (N12) - SAME-QUERY BLOCKING, part 2: INTRA-BATCH. Never let tonight's own
  // batch pick two candidates whose target queries overlap each other, even when
  // neither is measuring yet - shipping both tonight would make it impossible to
  // tell which change moved the shared searches. First-ranked (by score, already
  // sorted above) wins; a later-ranked candidate whose queries overlap an
  // ALREADY-ACCEPTED one this pass is held with the "tonight's pick" sentence
  // instead of the "already measuring" one. Applied to the full eligible pool
  // (not just what fits the effort budget) so the exclusion reason is honest
  // regardless of which other caps end up removing a pick later.
  const acceptedForQueryCheck: PlannedExperiment[] = [];
  const afterQueryOverlap: PlannedExperiment[] = [];
  for (const e of eligible) {
    const myQueries = candidateQuerySet(e);
    const collider = acceptedForQueryCheck.find((a) => queriesOverlap(myQueries, candidateQuerySet(a)));
    if (collider) {
      const colliderPath = normPathForInterference(collider.url);
      excluded.push({
        url: e.url,
        actionFamily: e.actionFamily,
        reason: "query_overlap_hold",
        plainReason: `I am holding this because it competes for the same searches as today's pick for ${colliderPath}.`,
      });
      continue;
    }
    acceptedForQueryCheck.push(e);
    afterQueryOverlap.push(e);
  }

  // Item 81 - AUTO-RETIRE repeatedly-losing (pageFamily, lever) cells, with one scheduled
  // retest after 90 days. Computed fresh from the settled ledger every call (see
  // the lever-retirement section below) - nothing persisted, nothing to go stale. Applied AFTER scoring/sort
  // so the retest cell's single slot goes to tonight's BEST-scoring candidate in that cell, not
  // an arbitrary one. A ledger with no cell at >= RETIRE_LOSS_THRESHOLD settled losses and zero
  // wins yields an empty decision list and every candidate passes through untouched - the exact
  // pre-item-81 eligible/excluded shape (pinned by lever-retirement-wiring.test.ts).
  const settledRows: SettledLeverRow[] = settledLeverRowsForRetirement(input.proofLedger);
  const leverRetirements = computeLeverRetirementDecisions(settledRows, now, pageFamilyOf, actionFamilyOf);
  const retirementIndex = new RetirementIndex(leverRetirements);
  const afterRetirement: PlannedExperiment[] = [];
  for (const e of afterQueryOverlap) {
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

// ---------------------------------------------------------------------------
// Proof-history voice (FINAL PREMIUM PLAN item 27; merged from
// proof-history-voice.ts 2026-07-21) - the ninth deterministic voice in the
// nightly debate: what the MEASURED ledger already says about this page family +
// lever family. Two shapes:
//   - same lever tried before -> the honest tally ("won 1, no clear lift 2")
//   - a SIBLING lever settled without a win and tonight's lever differs -> the
//     redirection reasoning out loud ("We tried a title change on similar pages:
//     no lift after the full window. That is why tonight is a description
//     change, not a title change.")
// PURE, no I/O. Pinned in daily-experiment-planner.test.ts.
// ---------------------------------------------------------------------------

export type SettledAgg = { won: number; lost: number; flat: number };

export const FAMILY_PLAIN: Record<string, string> = {
  title: "a title change",
  meta: "a description change",
  title_meta: "a title and description change",
  h1: "a headline change",
  answer: "a direct answer",
  link: "an internal link",
  schema: "structured data",
  content: "a content edit",
  new_page: "a new page",
  other: "a change",
};

/** Tally settled (non-measuring) verdicts by `${pageFamily}::${actionFamily}`. */
export function aggregateSettled(
  rows: Array<{ path: string; actionType: string; verdict: string }>,
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): Map<string, SettledAgg> {
  const out = new Map<string, SettledAgg>();
  for (const r of rows) {
    if (r.verdict === "measuring") continue;
    const key = `${familyOfPath(r.path)}::${familyOfAction(r.actionType)}`;
    const agg = out.get(key) ?? { won: 0, lost: 0, flat: 0 };
    if (r.verdict === "won") agg.won += 1;
    else if (r.verdict === "lost") agg.lost += 1;
    else agg.flat += 1;
    out.set(key, agg);
  }
  return out;
}

/** The voice's claim for tonight's (pageFamily, actionFamily), or null when history is silent. */
export function proofHistoryLine(
  settled: Map<string, SettledAgg>,
  pageFamily: string,
  actionFamily: string,
): string | null {
  const agg = settled.get(`${pageFamily}::${actionFamily}`);
  if (agg) {
    const parts: string[] = [];
    if (agg.won > 0) parts.push(`won ${agg.won}`);
    if (agg.flat > 0) parts.push(`no clear lift ${agg.flat}`);
    if (agg.lost > 0) parts.push(`hurt ${agg.lost}`);
    return `We already tried this kind of change on similar pages: ${parts.join(", ")}.`;
  }
  // Lever redirection: a sibling lever on this page family settled without a win.
  for (const [key, sib] of settled) {
    const [fam, lever] = key.split("::");
    if (fam !== pageFamily || lever === actionFamily) continue;
    if (sib.won === 0 && sib.flat + sib.lost > 0) {
      const outcome = sib.lost > 0 ? "it hurt" : "no lift after the full window";
      const sibPlain = FAMILY_PLAIN[lever ?? "other"] ?? "a change";
      const tonightPlain = FAMILY_PLAIN[actionFamily] ?? "a different change";
      return `We tried ${sibPlain} on similar pages: ${outcome}. That is why today's change is ${tonightPlain}, not ${sibPlain}.`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Lever retirement (BEACON_500 item 81, 2026-07-02; merged from
// lever-retirement.ts 2026-07-21) - PURE core that turns the proof ledger's
// repeated losses into an automatic "stop doing this" decision, per
// (pageFamily, actionFamily) cell, with a scheduled single retest so the rule
// can never fossilize.
//
// Reuses the EXACT grouping the proof-history voice above already uses
// (aggregateSettled: pageFamilyOf x actionFamilyOf over settled-only ledger
// rows) so a "lever" here means the SAME action family the rest of the daily
// batch reasons about, never a re-derivation.
//
// RETIRE a cell when it has >= RETIRE_LOSS_THRESHOLD settled losses AND zero
// wins. The cell's retiredAt is the settlement date of the loss that FIRST
// crossed the threshold (so re-running this on a later night with the same
// ledger yields the same retiredAt - deterministic, not "now").
//
// RETEST after RETEST_AFTER_DAYS have passed since retiredAt: exactly ONE fresh
// candidate in that cell is allowed through as `retest_due`. The planner
// consumes that single slot per planning pass via RetirementIndex.admit(). Once
// the retest candidate itself SETTLES (a new ledger row lands for that cell
// after retiredAt):
//   - a loss resets the clock: the retest loss becomes the new latest loss, and
//     (since the cell still has >= threshold losses and 0 wins) it re-retires
//     with retiredAt = the retest loss's own settlement date - a fresh 90-day
//     wait starts from there.
//   - a win fully unsuppresses the cell: any win at all breaks the "zero wins"
//     condition, so the cell reads as `active` from then on, permanently (until
//     a fresh run of >=3 losses with 0 wins accumulates again, which the ledger
//     would show for itself).
//
// DERIVED ENTIRELY FROM THE LEDGER. No persisted retirement list, no
// hand-maintained store - the retiredAt/retestAfter timestamps and the
// single-retest gate are all computed from the settled rows' own timestamps
// every time. This means a retest "grant" needs no separate log: whether
// tonight's candidate is the (at most one) retest allowed is a pure function of
// "how many candidates in this cell have already settled at or after retiredAt"
// - since a retest candidate, once shipped, becomes a ledger row itself, the
// SECOND settled row after retiredAt (if any) proves a retest already happened
// and used its slot.
//
// No I/O, no LLM, no paid calls. Pinned in daily-experiment-planner.test.ts.
// ---------------------------------------------------------------------------

/** >= this many settled losses with zero wins in a cell retires it. */
export const RETIRE_LOSS_THRESHOLD = 3;
/** Days a retired cell must wait before its one scheduled retest is allowed through. */
export const RETEST_AFTER_DAYS = 90;

const DAY_MS = 86_400_000;

/** The minimal settled-ledger row this section needs: same shape aggregateSettled's caller
 *  already has on hand (ShippedChangeRecord), read as plain fields so this stays a leaf. */
export type SettledLeverRow = {
  path: string;
  actionType: string;
  verdict: "won" | "lost" | "inconclusive" | string;
  /** ISO settlement time. Falls back to shippedAt at the call site when null - see
   *  settledLeverRowsForRetirement above; this section always receives a concrete ISO string per row. */
  settledAt: string;
};

export type LeverRetirementStatus = "active" | "retired" | "retest_due";

export type LeverRetirementDecision = {
  lever: ExperimentFamily | string;
  pageFamily: string;
  status: LeverRetirementStatus;
  lossCount: number;
  winCount: number;
  /** ISO timestamp the cell most recently retired (the loss that crossed the threshold, or the
   *  retest loss that re-retired it). Null while active. */
  retiredAtIso: string | null;
  /** ISO timestamp the ONE scheduled retest becomes available (retiredAtIso + 90 days). Null
   *  while active. */
  retestAfterIso: string | null;
  /** Plain-language lever name for operator copy (the FAMILY_PLAIN table above). */
  leverPlain: string;
};

type Cell = {
  lever: string;
  pageFamily: string;
  rows: SettledLeverRow[]; // settled rows for this cell, any order in
};

function cellKey(pageFamily: string, lever: string): string {
  return `${pageFamily}::${lever}`;
}

/**
 * Group settled rows into (pageFamily, lever) cells using the SAME family functions the
 * planner + proof-history voice already use. Callers pass rows already restricted to settled
 * (non-measuring) verdicts - mirrors aggregateSettled's own contract exactly.
 */
function groupCells(
  rows: SettledLeverRow[],
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  for (const r of rows) {
    const pageFamily = familyOfPath(r.path);
    const lever = familyOfAction(r.actionType);
    const key = cellKey(pageFamily, lever);
    let cell = cells.get(key);
    if (!cell) {
      cell = { lever, pageFamily, rows: [] };
      cells.set(key, cell);
    }
    cell.rows.push(r);
  }
  return cells;
}

/**
 * Fold one cell's settled rows (oldest first) into a retirement decision. Pure, deterministic:
 * replays the cell's history in settlement order so retiredAt always lands on the loss that
 * actually crossed the threshold (or the retest loss that re-crossed it), never "now".
 */
function decideCell(cell: Cell, now: Date): LeverRetirementDecision {
  const rows = [...cell.rows].sort((a, b) => Date.parse(a.settledAt) - Date.parse(b.settledAt));

  let lossCount = 0;
  let winCount = 0;
  let retiredAtIso: string | null = null;
  // How many settled rows have landed strictly after the current retiredAtIso - this counts
  // the retest attempt itself once it settles, so a second post-retirement row (win or loss)
  // is recognized as "the retest already happened", never a second free slot.
  let settledSinceRetiredAt = 0;

  for (const r of rows) {
    if (r.verdict === "won") {
      winCount += 1;
      // A win at any point fully clears the retirement (per spec: "or fully unsuppress if it
      // wins"). Reset the whole cell to active - a fresh run of losses would have to re-earn
      // retirement from here forward.
      retiredAtIso = null;
      settledSinceRetiredAt = 0;
      continue;
    }
    if (r.verdict !== "lost") continue; // inconclusive rows don't count toward either bucket

    lossCount += 1;
    if (retiredAtIso == null) {
      // Not currently retired: does THIS loss cross the threshold?
      if (lossCount >= RETIRE_LOSS_THRESHOLD && winCount === 0) {
        retiredAtIso = new Date(Date.parse(r.settledAt)).toISOString();
        settledSinceRetiredAt = 0;
      }
    } else {
      // Already retired and this loss settled after that - it can only be the single granted
      // retest settling badly. Re-retire, resetting the clock to THIS loss's own settlement.
      settledSinceRetiredAt += 1;
      retiredAtIso = new Date(Date.parse(r.settledAt)).toISOString();
      settledSinceRetiredAt = 0;
    }
  }

  const leverPlain = FAMILY_PLAIN[cell.lever] ?? "a change";

  if (retiredAtIso == null) {
    return {
      lever: cell.lever, pageFamily: cell.pageFamily, status: "active",
      lossCount, winCount, retiredAtIso: null, retestAfterIso: null, leverPlain,
    };
  }

  const retestAfterIso = new Date(Date.parse(retiredAtIso) + RETEST_AFTER_DAYS * DAY_MS).toISOString();
  // A retest is DUE once the wait has passed AND no settled row has landed after retiredAt yet
  // (settledSinceRetiredAt tracks that - see the loop above; it is reset to 0 every time
  // retiredAtIso itself advances, so it only ever counts rows strictly after the CURRENT
  // retiredAtIso, which for a freshly-computed decision is always zero here since any such row
  // would have already advanced retiredAtIso in the loop).
  const waited = now.getTime() >= Date.parse(retestAfterIso);
  const status: LeverRetirementStatus = waited ? "retest_due" : "retired";

  return {
    lever: cell.lever, pageFamily: cell.pageFamily, status,
    lossCount, winCount, retiredAtIso, retestAfterIso, leverPlain,
  };
}

/**
 * Compute a retirement decision for every (pageFamily, lever) cell that has ANY settled loss
 * history. Cells with no losses never appear (they are implicitly "active" - the planner
 * treats an absent cell as active, see RetirementIndex below). PURE, deterministic given
 * (rows, now).
 */
export function computeLeverRetirementDecisions(
  rows: SettledLeverRow[],
  now: Date,
  familyOfPath: (path: string) => string,
  familyOfAction: (actionType: string) => string,
): LeverRetirementDecision[] {
  const cells = groupCells(rows, familyOfPath, familyOfAction);
  const decisions: LeverRetirementDecision[] = [];
  for (const cell of cells.values()) {
    const d = decideCell(cell, now);
    if (d.lossCount > 0) decisions.push(d);
  }
  return decisions.sort((a, b) => (a.pageFamily === b.pageFamily ? a.lever.localeCompare(b.lever) : a.pageFamily.localeCompare(b.pageFamily)));
}

/**
 * Stateful (in-memory, per-planning-pass) gate the planner consumes candidate-by-candidate:
 * a `retired` cell blocks every candidate; a `retest_due` cell admits exactly ONE candidate
 * (flagging it `retest: true`) and blocks the rest for the remainder of THIS pass; an `active`
 * (or absent) cell never blocks anything. Never persisted - rebuilt fresh from the ledger on
 * every call to planDailyExperiments, so there is nothing to go stale.
 */
export class RetirementIndex {
  private readonly byCell = new Map<string, LeverRetirementDecision>();
  private readonly retestConsumed = new Set<string>();

  constructor(decisions: LeverRetirementDecision[]) {
    for (const d of decisions) this.byCell.set(cellKey(d.pageFamily, d.lever), d);
  }

  /** Look up the decision for a cell without consuming anything (read-only). */
  decisionFor(pageFamily: string, lever: string): LeverRetirementDecision | undefined {
    return this.byCell.get(cellKey(pageFamily, lever));
  }

  /**
   * Admit or block one candidate in (pageFamily, lever). Returns:
   *  - { blocked: false } for an active/absent cell, or the retest slot when granted;
   *  - { blocked: true, decision } for a retired cell, or a retest_due cell whose one slot is
   *    already used this pass.
   * Order-sensitive by design: candidates are offered in the planner's own scored order, so the
   * single retest slot goes to the BEST-scoring eligible candidate in that cell tonight.
   */
  admit(pageFamily: string, lever: string): { blocked: boolean; retest: boolean; decision?: LeverRetirementDecision } {
    const key = cellKey(pageFamily, lever);
    const decision = this.byCell.get(key);
    if (!decision || decision.status === "active") return { blocked: false, retest: false };
    if (decision.status === "retired") return { blocked: true, retest: false, decision };
    // retest_due: exactly one candidate gets through per pass.
    if (this.retestConsumed.has(key)) return { blocked: true, retest: false, decision };
    this.retestConsumed.add(key);
    return { blocked: false, retest: true, decision };
  }
}

/**
 * Plain, first-person retirement sentence for the nightly plan/daily card explanation, e.g.
 * "I stopped rewriting titles on city pages, it lost 3 times." or, when a retest is scheduled,
 * the sentence names when the one retest will run. No em or en dashes ever. Returns null for an
 * active (or absent) cell - honest silence, never a manufactured caution.
 */
export function retirementLine(decision: LeverRetirementDecision | undefined): string | null {
  if (!decision || decision.status === "active") return null;
  const pageWord = decision.pageFamily.replace(/[-_]+/g, " ");
  const timesWord = decision.lossCount === 1 ? "time" : "times";
  const base = `I stopped ${decision.leverPlain.replace(/^a /, "").replace(/^an /, "")} on ${pageWord} pages, it lost ${decision.lossCount} ${timesWord}.`;
  if (decision.status === "retest_due") {
    return `${base} I am ready to retest it once now.`;
  }
  const retestMonth = decision.retestAfterIso
    ? new Date(decision.retestAfterIso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    : "a future month";
  return `${base} I will retest it once in ${retestMonth}.`;
}
