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
  | "other";

export function actionFamilyOf(actionType: string): ExperimentFamily {
  const a = (actionType || "").toLowerCase();
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
  | "insufficient_controls";

export type ExperimentEligibility =
  | { eligible: true; reason: "clean" }
  | { eligible: false; reason: EligibilityReason; availableAt?: string; relatedProofIds?: string[] };

export type ExternalFlags = {
  ownershipUncertain?: boolean;
  highRisk?: boolean;
  staleResearch?: boolean;
  insufficientControls?: boolean;
};

/**
 * Is it scientifically safe to run a `family` experiment on `url` right now? PURE.
 * Ledger-derived blocks (measuring / control / no-lift / compound) take precedence; the
 * caller layers candidate-data flags (ownership/risk/research/controls) on top.
 */
export function assessEligibility(input: {
  url: string;
  family: ExperimentFamily;
  states: Map<string, PageExperimentState>;
  external?: ExternalFlags;
  /** Allow treating a current control if the caller has explicitly released/reassigned it. */
  allowControlOverride?: boolean;
}): ExperimentEligibility {
  const path = pathOf(input.url);
  const s = input.states.get(path);

  if (s && s.activeTreatments.length > 0) {
    const sameFamily = s.activeTreatments.some((t) => familiesCollide(t.family, input.family));
    return {
      eligible: false,
      reason: sameFamily ? "same_family_measuring" : "compound_edit",
      availableAt: s.nextAvailableAt,
      relatedProofIds: s.activeTreatments.map((t) => t.proofId),
    };
  }

  if (s && s.activeControlAssignments.length > 0 && !input.allowControlOverride) {
    return {
      eligible: false,
      reason: "active_control",
      availableAt: s.nextAvailableAt,
      relatedProofIds: [...new Set(s.activeControlAssignments.map((c) => c.proofId))],
    };
  }

  if (s) {
    const noLiftSameFamily = s.settledTreatments.some(
      (t) => (t.verdict === "loss" || t.verdict === "inconclusive") && familiesCollide(t.family, input.family),
    );
    if (noLiftSameFamily) {
      return { eligible: false, reason: "recent_no_lift", relatedProofIds: s.settledTreatments.map((t) => t.proofId) };
    }
  }

  const ext = input.external ?? {};
  if (ext.highRisk) return { eligible: false, reason: "high_risk_page" };
  if (ext.ownershipUncertain) return { eligible: false, reason: "ownership_uncertain" };
  if (ext.staleResearch) return { eligible: false, reason: "stale_research" };
  if (ext.insufficientControls) return { eligible: false, reason: "insufficient_controls" };

  return { eligible: true, reason: "clean" };
}
