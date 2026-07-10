/**
 * experiment-eligibility (2026-06-30) — the PURE scientific core of Beacon's Daily
 * Experiment Cycle. It reads the proof ledger and answers, for any (page, lever) a daily
 * batch might propose: is this experiment scientifically SAFE to run right now?
 *
 * The hard problem it solves: the live title experiments use 17 unchanged animal pages as
 * diff-in-diff CONTROLS. If a later batch treats one of those controls (e.g. the operator's
 * meta-vs-title test on the same animals), that control's CTR moves for a NON-natural reason
 * and contaminates the title experiments. So:
 *   - a page with an ACTIVE treatment can't be re-treated (same family) or compound-edited
 *     (different family) until its 28-day window closes;
 *   - a page serving as an ACTIVE CONTROL can't be treated until the experiments it anchors
 *     settle (or it's explicitly released + the treated experiments reassign controls);
 *   - a settled NO-LIFT lever blocks re-testing the SAME family (but a different family may
 *     be allowed later);
 *   - a page becomes available again only after its final window (+ GSC finalization lag).
 *
 * No I/O, no LLM, no paid calls — deterministic from the ledger. The planner + the proof
 * engine's contamination guard both consume this.
 */

import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import { outcomeStateOf } from "@/domains/proof-gsc/measure-lifecycle";

/** Action FAMILY — coarser than action_type. Same-family re-tests collide; cross-family on
 *  one page is a compound edit (blocked by default). Title and meta are DISTINCT families so
 *  a meta-vs-title comparison is a legitimate cross-page design, not a re-test. */
export type ExperimentFamily =
  | "title"
  | "meta"
  | "title_meta"
  | "h1"
  | "answer"
  | "link"
  | "schema"
  | "content"
  | "new_page"
  // BEACON 500 item 61: agentic full-page rewrites (rewrite-page.ts) are a
  // distinct family from single-lever "content" edits so the diff-in-diff
  // priors learn whether a full section rebuild beats a single-lever edit,
  // instead of the two blending into one "content" prior.
  | "full_rewrite"
  | "other";

export function actionFamilyOf(actionType: string): ExperimentFamily {
  const a = (actionType || "").toLowerCase();
  if (/full_rewrite/.test(a)) return "full_rewrite";
  const hasTitle = /title/.test(a);
  const hasMeta = /meta|description/.test(a);
  if (hasTitle && hasMeta) return "title_meta";
  if (hasTitle) return "title";
  if (hasMeta) return "meta";
  if (/\bh1\b|heading/.test(a)) return "h1";
  if (/answer|faq|snippet/.test(a)) return "answer";
  if (/link/.test(a)) return "link";
  if (/schema|json.?ld|structured/.test(a)) return "schema";
  if (/create_page|new_page|create_tool|create_calculator|create_collection|build_/.test(a)) return "new_page";
  if (/edit_page|content|section|rewrite|expand|paragraph|body|add_image|image_alt/.test(a)) return "content";
  return "other";
}

/** Two families "collide" for contamination purposes if a re-test of the same intent. title
 *  and title_meta overlap; meta and title_meta overlap. */
export function familiesCollide(a: ExperimentFamily, b: ExperimentFamily): boolean {
  if (a === b) return true;
  const titleish = new Set<ExperimentFamily>(["title", "title_meta"]);
  const metaish = new Set<ExperimentFamily>(["meta", "title_meta"]);
  if (titleish.has(a) && titleish.has(b)) return true;
  if (metaish.has(a) && metaish.has(b)) return true;
  return false;
}

/** Days after ship that a 28-day experiment is considered DONE + the page/control frees up
 *  (final window + GSC finalization lag). */
export const FINAL_WINDOW_DAYS = 28;
export const GSC_LAG_DAYS = 3;
const RELEASE_DAYS = FINAL_WINDOW_DAYS + GSC_LAG_DAYS;

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  return new Date(Date.parse(dateOnly(iso)) + days * 86_400_000).toISOString();
}
function pathOf(urlOrPath: string): string {
  return (urlOrPath.replace(/^https?:\/\/[^/]+/, "") || "/").replace(/[?#].*$/, "");
}

export type ActiveTreatment = { proofId: string; family: ExperimentFamily; actionType: string; startedAt: string; finalCheckpointAt: string };
export type ActiveControlAssignment = { proofId: string; treatedPath: string; startedAt: string; finalCheckpointAt: string };
export type SettledTreatment = { proofId: string; family: ExperimentFamily; actionType: string; verdict: "win" | "loss" | "inconclusive"; settledAt: string | null };

export type PageExperimentState = {
  path: string;
  activeTreatments: ActiveTreatment[];
  activeControlAssignments: ActiveControlAssignment[];
  settledTreatments: SettledTreatment[];
  /** ISO when the page next becomes available for a new experiment (max of all active
   *  treatment + control final checkpoints), or undefined if already free. */
  nextAvailableAt?: string;
};

/**
 * Build the per-page experiment state from the proof ledger. PURE.
 * A record is an ACTIVE treatment while it's measuring; its controlPages are ACTIVE control
 * assignments for that same window.
 */
export function deriveExperimentStates(records: ShippedChangeRecord[], now: Date = new Date()): Map<string, PageExperimentState> {
  const states = new Map<string, PageExperimentState>();
  const get = (p: string): PageExperimentState => {
    let s = states.get(p);
    if (!s) {
      s = { path: p, activeTreatments: [], activeControlAssignments: [], settledTreatments: [] };
      states.set(p, s);
    }
    return s;
  };

  for (const r of records) {
    const tp = pathOf(r.path);
    const family = actionFamilyOf(r.actionType);
    const finalCheckpointAt = addDaysIso(r.shippedAt, RELEASE_DAYS);
    const state = outcomeStateOf(r, now);
    if (state === "measuring") {
      get(tp).activeTreatments.push({ proofId: r.id, family, actionType: r.actionType, startedAt: r.shippedAt, finalCheckpointAt });
      for (const cp of r.controlPages) {
        get(pathOf(cp)).activeControlAssignments.push({ proofId: r.id, treatedPath: tp, startedAt: r.shippedAt, finalCheckpointAt });
      }
    } else {
      get(tp).settledTreatments.push({
        proofId: r.id, family, actionType: r.actionType,
        verdict: state === "win" ? "win" : state === "loss" ? "loss" : "inconclusive",
        settledAt: r.measuredAt,
      });
    }
  }

  for (const s of states.values()) {
    const checkpoints = [
      ...s.activeTreatments.map((t) => t.finalCheckpointAt),
      ...s.activeControlAssignments.map((c) => c.finalCheckpointAt),
    ];
    if (checkpoints.length > 0) s.nextAvailableAt = checkpoints.sort().at(-1);
  }
  return states;
}

/** Paths that currently have an ACTIVE (measuring) treatment — the set a control must avoid
 *  to stay a clean comparison. Used by the proof engine's contamination guard + the planner. */
export function activeTreatmentPaths(records: ShippedChangeRecord[], now: Date = new Date()): Set<string> {
  const out = new Set<string>();
  for (const r of records) if (outcomeStateOf(r, now) === "measuring") out.add(pathOf(r.path));
  return out;
}

/** Drop any control that is ITSELF an active treatment (contaminated) — the diff-in-diff
 *  must only subtract NATURAL drift, never another experiment's effect. PURE. */
export function cleanControlPaths(controlPaths: string[], activeTreatments: Set<string>): string[] {
  return controlPaths.filter((cp) => !activeTreatments.has(pathOf(cp)));
}

export type EligibilityReason =
  | "page_measuring"
  | "active_control"
  | "same_family_measuring"
  | "recent_no_lift"
  | "ownership_uncertain"
  | "high_risk_page"
  | "stale_research"
  | "compound_edit"
  | "insufficient_controls"
  // E-39 (adaptive control pools, operator-approved 2026-07-10): the one case a
  // page serving as a comparison page stays a HARD block - it is the last clean
  // comparison page for an OPEN measurement that has zero other comparables, so
  // releasing it would leave a live measurement with nothing honest to compare
  // against. Every OTHER control page is now admit-with-caution (see below).
  | "last_clean_donor";

/**
 * E-39 admit-with-caution (operator-approved 2026-07-10). The reasons that used
 * to LOCK the operator out but are only MEASUREMENT INCONVENIENCE, never a real
 * hazard to the page. A page carrying one of these stays EDITABLE / ELIGIBLE; the
 * edit is admitted WITH CAUTION, and any measurement the page participates in
 * reads one confidence tier lower and can never be reported as a clean causal
 * result. Principle: "measurement inconvenience alone never locks the operator
 * out."
 *
 *   - active_control        this page is a comparison page for a live measurement
 *   - same_family_measuring a same-family change on this page is still measuring
 *   - compound_edit         a different-family change on this page is measuring
 *   - insufficient_controls fewer than the diff-in-diff minimum (2) comparison
 *                           pages exist -> reduced confidence, NOT a freeze (D3)
 */
export type CautionReason =
  | "active_control"
  | "same_family_measuring"
  | "compound_edit"
  | "insufficient_controls";

/**
 * E-39: reasons that STAY hard blocks because acting is genuinely unsafe or
 * dishonest, not merely inconvenient: a proven loss (recent_no_lift), a
 * high-earning page we will not gamble (high_risk_page), a page we may not own
 * (ownership_uncertain), stale research (stale_research), and the LAST clean
 * comparison page for an open measurement with zero other comparables
 * (last_clean_donor).
 */
export type HardBlockReason =
  | "recent_no_lift"
  | "ownership_uncertain"
  | "high_risk_page"
  | "stale_research"
  | "last_clean_donor";

/**
 * E-39: the attribution caution carried by an eligible-with-caution page. The
 * page is safe to edit; this only records that a measurement made while the
 * caution holds reads one tier lower and never as a clean causal result. PURE
 * (computed from the ledger; nothing persisted - Decision 7 compute-only).
 */
export type AttributionCaution = {
  reason: CautionReason;
  /** Proof ids of the measurements this edit would touch / collide with. */
  relatedProofIds: string[];
  /** When the colliding measurement(s) settle and the caution clears, if known. */
  availableAt?: string;
  /** Plain first-person explanation (Beacon voice, no dashes). */
  copy: string;
  /** Decision 2: a measurement made while this caution holds reads one tier lower. */
  lowersConfidenceOneTier: true;
};

export type ExperimentEligibility =
  | { eligible: true; reason: "clean" }
  | { eligible: true; reason: CautionReason; caution: AttributionCaution }
  | { eligible: false; reason: HardBlockReason; availableAt?: string; relatedProofIds?: string[] };

export type ExternalFlags = {
  ownershipUncertain?: boolean;
  highRisk?: boolean;
  staleResearch?: boolean;
  /** E-39 D3: fewer than the diff-in-diff minimum (2) defensible comparison
   *  pages. No longer a freeze - the edit is admitted with caution and the
   *  measurement reads at a lower confidence tier (weak_estimate). */
  insufficientControls?: boolean;
  /** E-39 D1: this page is the LAST clean comparison page for an open
   *  measurement that has ZERO other comparables. Only THEN is a control a hard
   *  block; every other control is admit-with-caution. The caller (planner)
   *  computes this from control-contamination.ts's lastCleanDonorPaths. */
  lastCleanDonor?: boolean;
};

/** E-39: the plain first-person caution line for each caution reason. Beacon
 *  voice, first person, no dashes. Deterministic (Decision 7 compute-only). */
export function cautionCopyFor(reason: CautionReason): string {
  switch (reason) {
    case "active_control":
      return "This page is a comparison page for a change I am still measuring. You can edit it, but that makes the comparison less certain, so I will read the affected result with caution.";
    case "same_family_measuring":
      return "I am already measuring a similar change on this page. You can ship another, but I will not be able to tell the two apart cleanly, so I will read the result with caution.";
    case "compound_edit":
      return "This page already has a different change I am measuring. A second edit now overlaps that measurement, so I will read the affected result with caution.";
    case "insufficient_controls":
      return "I could not find at least two closely matched comparison pages, so I will measure this against what I have and read the result with lower confidence.";
  }
}

/**
 * Is it safe to run a `family` experiment on `url` right now, and if so does it
 * carry an attribution caution? PURE. E-39 admit-with-caution model:
 *
 *   HARD BLOCKS (eligible:false) come first - a proven loss, a risky page, an
 *   unowned page, stale research, or the last clean comparison page for an open
 *   measurement. These are genuine hazards, not inconvenience.
 *
 *   ADMIT-WITH-CAUTION (eligible:true + caution) - a page that is mid-measurement
 *   (its own change, or as someone else's comparison page) or that has a thin
 *   comparison pool stays editable, flagged so the measurement reads honestly.
 *
 *   CLEAN (eligible:true) - nothing to flag.
 *
 * The caller layers candidate-data flags (ownership/risk/research/controls/
 * last-clean-donor) on top of the ledger-derived state.
 */
export function assessEligibility(input: {
  url: string;
  family: ExperimentFamily;
  states: Map<string, PageExperimentState>;
  external?: ExternalFlags;
  /** @deprecated E-39: a control is now admit-with-caution, never a lock, so an
   *  override is unnecessary. Kept so legacy callers compile; when true, the
   *  active_control caution is cleared to fully clean. */
  allowControlOverride?: boolean;
}): ExperimentEligibility {
  const path = pathOf(input.url);
  const s = input.states.get(path);
  const ext = input.external ?? {};

  // ── HARD BLOCKS FIRST (genuine hazards, not inconvenience) ──
  // A proven loss / no-lift on the same family: re-testing wastes the operator's
  // time on something we already learned does not work on this page.
  if (s) {
    const noLiftSameFamily = s.settledTreatments.some(
      (t) => (t.verdict === "loss" || t.verdict === "inconclusive") && familiesCollide(t.family, input.family),
    );
    if (noLiftSameFamily) {
      return { eligible: false, reason: "recent_no_lift", relatedProofIds: s.settledTreatments.map((t) => t.proofId) };
    }
  }
  if (ext.highRisk) return { eligible: false, reason: "high_risk_page" };
  if (ext.ownershipUncertain) return { eligible: false, reason: "ownership_uncertain" };
  if (ext.staleResearch) return { eligible: false, reason: "stale_research" };
  // E-39 D1: the ONLY case a control stays a hard block - releasing THIS exact
  // page would leave an open measurement with zero honest comparables.
  if (ext.lastCleanDonor) {
    return {
      eligible: false,
      reason: "last_clean_donor",
      availableAt: s?.nextAvailableAt,
      relatedProofIds: s ? [...new Set(s.activeControlAssignments.map((c) => c.proofId))] : undefined,
    };
  }

  // ── ADMIT-WITH-CAUTION (E-39 D1). Precedence: the treated page's own active
  // treatment (same-family re-test vs cross-family compound edit) dominates being
  // someone else's comparison page, which dominates a thin comparison pool. ──
  const caution = (reason: CautionReason, relatedProofIds: string[], availableAt?: string): ExperimentEligibility => ({
    eligible: true,
    reason,
    caution: { reason, relatedProofIds, availableAt, copy: cautionCopyFor(reason), lowersConfidenceOneTier: true },
  });

  if (s && s.activeTreatments.length > 0) {
    const sameFamily = s.activeTreatments.some((t) => familiesCollide(t.family, input.family));
    return caution(
      sameFamily ? "same_family_measuring" : "compound_edit",
      s.activeTreatments.map((t) => t.proofId),
      s.nextAvailableAt,
    );
  }
  if (s && s.activeControlAssignments.length > 0 && !input.allowControlOverride) {
    return caution("active_control", [...new Set(s.activeControlAssignments.map((c) => c.proofId))], s.nextAvailableAt);
  }
  if (ext.insufficientControls) {
    return caution("insufficient_controls", []);
  }

  return { eligible: true, reason: "clean" };
}

/** E-39: extract the attribution caution from an eligibility result, or null. PURE. */
export function cautionOf(e: ExperimentEligibility): AttributionCaution | null {
  return e.eligible && e.reason !== "clean" ? e.caution : null;
}
