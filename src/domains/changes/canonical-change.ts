/**
 * canonical-change (2026-07-01) — the ONE object the operator sees: a CHANGE. A pure read-model that
 * unifies the worklist move, the daily-plan selection, execution state, and proof/measurement into a
 * single lifecycle (suggested → ready → apply → verify → measuring → result). NO new persistence — the
 * adapter (build-canonical-changes) composes existing sources; this file is types + pure derivations
 * (status, evidence strength, effort, strategy ranking, goal filters). Internal concepts
 * (recommendation/draft/ActionPack/experiment/reservation/proof) never surface as separate workflows.
 */
import { isActiveStatus, type DailyExperimentItemStatus } from "@/domains/experiments/execution-state";

export type CanonicalStatus =
  | "suggested" // recommended, not yet prepared
  | "ready" // exact instructions available (prepared OR selected for today)
  | "apply" // accepted into today's plan, awaiting the operator's Wix edit
  | "verify" // applied, verification in flight
  | "measuring" // live + being tracked
  | "result" // mature/settled outcome
  | "blocked" // a real opportunity, but unsafe now (active measurement / protected control)
  | "skipped"; // operator dismissed — hidden from the default list

/** The four operator-facing status VIEWS (tabs) — each a grouping of statuses, not a separate pipeline. */
export type StatusView = "todo" | "ready" | "measuring" | "results";
export function statusView(s: CanonicalStatus): StatusView {
  if (s === "result") return "results";
  if (s === "measuring") return "measuring";
  if (s === "ready" || s === "apply" || s === "verify") return "ready";
  return "todo"; // suggested + blocked
}

export type EvidenceStrength = "strong" | "directional" | "tracking";
export const EVIDENCE_LABEL: Record<EvidenceStrength, string> = {
  strong: "Strong comparison",
  directional: "Directional signal",
  tracking: "Tracking only",
};

export type Strategy = "balanced" | "growth" | "clean";
export type Goal = "recommended" | "quick_wins" | "biggest_upside" | "recover_traffic" | "ai_visibility" | "new_pages";

export type CanonicalChange = {
  id: string; // stable: `${tenantId}::${pagePath}::${changeFamily}`
  tenantId: string;
  pagePath: string; // normalized
  pageUrl: string;
  pageLabel: string;
  opportunityType: string; // operator-facing label ("Capture clicks", "Win AI citations", …)
  changeType: string; // canonical action_type (edit_meta, add_internal_link, …)
  changeFamily: string; // coarse family for identity (meta|title|h1|link|answer|schema|new_page|cro|other)
  status: CanonicalStatus;
  recommendation: string; // one-sentence action
  exactInstructions: string | null; // only when ready/apply
  before: string | null;
  after: string | null;
  rationale: string;
  estimatedEffortMinutes: number;
  impactScore: number; // for ranking (demand/score-derived)
  /** Monthly opportunity for display/ranking. D7 (honest opportunity math): this is the
   *  MIDPOINT of the same CTR-curve range `expectedOutcome` describes in prose, never a raw
   *  impressions/demand-score sum - the "biggest upside" goal filter now sorts on real forecast
   *  math instead of an unactionable raw number. Null exactly when `expectedOutcome` is (not
   *  enough history to size this honestly). */
  upside: number | null;
  /** Item 61 / D7: honest monthly outcome range ("roughly 20 to 60 extra clicks a month"),
   *  from opportunity-math.ts (the tenant's own CTR curve + settled-history capture band). Null
   *  when there is not enough history to size this honestly - see `expectedOutcomeBasis` for the
   *  honest reason, never a fabricated range. */
  expectedOutcome: string | null;
  /** D7 numeric twins of the range `expectedOutcome` describes in prose (same pattern as
   *  PickExpectations.forecastLow/High) - present exactly when `expectedOutcome` names a range. */
  expectedOutcomeLow?: number | null;
  expectedOutcomeHigh?: number | null;
  /** D7 - days until the first real read for this forecast (opportunity-math.ts's own
   *  lever-family default, or a measured time-to-signal when one exists). Always present once a
   *  forecast was computed, even in the honest "not enough history" case (a caller still knows
   *  when to check back). */
  expectedOutcomeDays?: number | null;
  /** D7 - the deterministic hypothesis id opportunity-math.ts generated for this exact rendered
   *  forecast, so the caller (changes-data.ts) can log it via hypothesis-log.ts. Present whenever
   *  a forecast (even a "not enough history" one) was computed for this change. */
  hypothesisId?: string | null;
  riskLevel: "low" | "medium" | "high";
  evidenceStrength: EvidenceStrength;
  measurementMethod: string;
  selectedForToday: boolean;
  activeExperiment: boolean;
  protectedControl: boolean;
  blockedReason: string | null;
  result: string | null; // mature outcome label only (never "won/lost" before maturity)
  /** Move 2 — maturity-aware measurement language (shared with MoveCard + Results).
   *  For measuring/result rows this is the honest headline ("Early negative signal",
   *  "Collecting data", "Helped", "Waiting for Google data"). Null when not measured. */
  measurementHeadline: string | null;
  measurementDetail: string | null; // next-checkpoint / waiting-for-data / overlap note
  nextCheckpoint: string | null; // ISO date of the soonest future read
  attributionLimited: boolean; // an overlapping edit weakens this measurement
  /** Move 4 backfill — the recommendation-quality signal surfaced on every actionable row.
   *  "approved" = passed; "caution" = passed with a caveat; "flagged" = failed a content
   *  check (e.g. off-topic for this page) → never presented as high-confidence Ready. */
  qualityDecision?: "approved" | "caution" | "flagged";
  qualityNote?: string | null;
  sourceIds: string[];
  alternateOpportunities: string[]; // other levers available on this page (kept under the primary)
};

const NEW_PAGE_FAMILIES = new Set(["new_page", "hub"]);

/** Collapse a raw action_type into the coarse family used for identity + classification. */
export function changeTypeFamily(actionType: string | null | undefined): string {
  const a = (actionType ?? "").toLowerCase();
  if (!a) return "other";
  if (a.includes("meta")) return "meta";
  if (a.includes("title")) return "title";
  if (a.includes("h1")) return "h1";
  if (a.includes("answer") || a.includes("faq") || a.includes("intro")) return "answer";
  if (a.includes("internal_link") || a.includes("link")) return "link";
  if (a.includes("schema")) return "schema";
  if (a.includes("create") || a.includes("new_page") || a.includes("page") || a.includes("hub")) return "new_page";
  if (a.includes("ux") || a.includes("cro") || a.includes("experience") || a.includes("image")) return "cro";
  return "other";
}

/** Coarse effort (minutes) when the daily plan hasn't supplied an exact figure. */
export function effortForFamily(family: string): number {
  if (family === "meta" || family === "title" || family === "h1") return 1;
  if (family === "link" || family === "answer" || family === "schema") return 3;
  if (family === "new_page") return 60;
  if (family === "cro") return 10;
  return 5;
}

/**
 * Measurement strength a lever FAMILY is capable of, once it is actually running with real
 * comparison data (reserved control pages, or a live/mature proof record) attached. This is a
 * ceiling, not a default. B1 fix: a bare suggestion must never borrow this label before any
 * comparison data exists (see `defaultEvidenceStrength` below, used pre-selection).
 */
export function expectedEvidenceStrength(family: string): EvidenceStrength {
  if (NEW_PAGE_FAMILIES.has(family)) return "tracking"; // no clean before/after baseline
  if (family === "cro") return "directional"; // friction fixes rarely have clean controls
  return "strong"; // single-page text levers CAN get diff-in-diff controls once selected
}

/**
 * Evidence strength for a change that has NOT yet been selected into today's plan and has no
 * proof record attached, i.e. a bare recommendation. No comparison/control data exists yet for
 * these, so they must never show "Strong comparison" (that badge is decoration, not evidence,
 * until Beacon actually reserves controls or starts measuring). Tracking-only families stay
 * tracking; everything else reads as directional until it earns real comparison data.
 */
export function defaultEvidenceStrength(family: string): EvidenceStrength {
  if (NEW_PAGE_FAMILIES.has(family)) return "tracking";
  return "directional";
}

export type ProofSignal = "measuring" | "won" | "no_lift" | "no_clear_lift" | null | undefined;
export type StatusSignal = {
  proofStatus?: ProofSignal;
  alreadyMeasuring?: boolean;
  pageMeasuring?: boolean;
  planItemStatus?: DailyExperimentItemStatus | null;
  selectedForToday?: boolean;
  preparedReady?: boolean;
  skipped?: boolean;
};

/**
 * Pure status resolver. Most-settled wins: a mature proof outcome beats live measurement beats an
 * execution stage beats a plan selection beats a prepared draft beats a bare suggestion. A page mid-
 * measurement (different change) is `blocked` (visible in To do), never an actionable Ready item.
 */
export function deriveStatus(sig: StatusSignal): CanonicalStatus {
  if (sig.skipped) return "skipped";
  // 1) settled proof outcome
  if (sig.proofStatus === "won" || sig.proofStatus === "no_lift" || sig.proofStatus === "no_clear_lift") return "result";
  // 2) live proof
  if (sig.proofStatus === "measuring" || sig.alreadyMeasuring) return "measuring";
  // 3) execution stage (daily-plan item)
  const item = sig.planItemStatus;
  if (item) {
    if (isActiveStatus(item)) return "measuring";
    if (item === "verified_live" || item === "verification_pending" || item === "activation_pending") return "verify";
    if (item === "skipped") return "skipped";
    if (item === "ready_to_apply" || item === "verification_failed") return "apply"; // accepted, awaiting the Wix edit
  }
  // 4) a different change is mid-measurement on this page → not safe to act now
  if (sig.pageMeasuring) return "blocked";
  // 5) selected into today's plan (preview) OR a prepared draft → ready (exact instructions exist)
  if (sig.selectedForToday || sig.preparedReady) return "ready";
  // 6) bare recommendation
  return "suggested";
}
