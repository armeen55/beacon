/**
 * Deep Workbench Optimizer (TASK 3) — the per-page SEO command center.
 *
 * PURE deterministic layer. It does NOT call the LLM: it scores + buckets the
 * already-built lever matrix (workbench-matrix.ts, which carries the drafted
 * copy + pushability + risk + benefit per lever) into the six operator moves:
 *   Best next move · Safest change · Highest upside · Fastest measurable ·
 *   Hold / do not touch · Bigger swing later.
 *
 * It folds in two signals the raw matrix lacks:
 *   • the proof ledger — a lever already UNDER MEASUREMENT is held (changing it
 *     resets the proof window), and a measuring CTR lever holds its CTR sibling.
 *   • the SERP hypothesis — when a feature likely owns the clicks, title/meta are
 *     downgraded and answer/schema/UX become the preferred move.
 *
 * No I/O, no server-only, no em dashes in copy. Same input → same buckets.
 */

import type {
  LeverKey,
  ProposedSource,
  WorkbenchLeverRow,
  WorkbenchMatrix,
} from "./workbench-matrix";
import { decideVerdict, type VerdictChip } from "./workbench-priority";
import type { PushMethod } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";
import type { ProofPlanRow } from "@/domains/recommendation-intelligence/page-surgeon/proof-plan";
import type { SerpHypothesis } from "@/domains/recommendation-intelligence/page-surgeon/serp-hypothesis";

export type RollbackType =
  | "exact_prior_value"
  | "reversible_add"
  | "best_effort"
  | "none";
export type OptimizerBlocker = "serp" | "wix" | "data" | "measuring" | null;
export type OptimizerSpeed = "ctr_days" | "rank_weeks" | "structural";

export type OptimizerCandidate = {
  lever: LeverKey;
  label: string;
  /** Literal ship-ready copy when one exists, else null (never fabricated). */
  draft: string | null;
  draftSource: ProposedSource;
  evidence: string;
  estClicksAtStake: number | null;
  upsideConfidence: "high" | "medium" | "low" | null;
  risk: "low" | "medium" | "high";
  measurementMetric: string;
  rollbackType: RollbackType;
  wixPushMethod: PushMethod;
  canAutoApply: boolean;
  serpGuardLabel: string | null;
  verdict: VerdictChip;
  /** Shippable today: auto-applicable, low risk, real rollback, nothing blocking. */
  safeNow: boolean;
  blockedBy: OptimizerBlocker;
  speed: OptimizerSpeed;
  leverageScore: number;
  /** Why it landed in its bucket (especially for Hold). */
  reason: string;
};

export type OptimizerBuckets = {
  bestNextMove: OptimizerCandidate | null;
  safestChange: OptimizerCandidate | null;
  highestUpside: OptimizerCandidate | null;
  fastestMeasurable: OptimizerCandidate | null;
  holdDoNotTouch: OptimizerCandidate[];
  biggerSwingLater: OptimizerCandidate | null;
};

export type OptimizerInput = {
  matrix: WorkbenchMatrix;
  /** This page's Page-Surgeon proof-plan row (reviewed change), if any. */
  proof: ProofPlanRow | null;
  /** Action types currently UNDER MEASUREMENT for this page on the GSC proof
   *  ledger (shipped-change-store, verdict "measuring"). The authoritative
   *  "already measuring" source: the proof-plan row only covers reviewed PS
   *  decisions, not shipped experiments. e.g. ["meta"], ["intro_answer_block"]. */
  measuringActions?: string[];
  /** Operator-resolved SERP hypothesis (upgrades the page-level guard), else null. */
  serp: SerpHypothesis | null;
};

const CONF_WEIGHT: Record<"high" | "medium" | "low", number> = {
  high: 1,
  medium: 0.6,
  low: 0.3,
};

const CTR_FAMILY: ReadonlySet<LeverKey> = new Set(["title", "meta"]);

/** Lever → the proof headlineAction vocabulary (page-decision CHANGE_ACTIONS),
 *  so we can detect a lever overlapping a change already under measurement. */
const LEVER_ACTIONS: Record<LeverKey, ReadonlyArray<string>> = {
  title: ["title"],
  meta: ["meta"],
  h1: ["h1"],
  answer_block: ["intro_answer_block"],
  h2_sections: ["section_add", "section_remove", "section_reorder"],
  visible_qa: ["faq"],
  internal_links: ["internal_link", "citation_source"],
  schema: ["schema"],
  new_page: ["create_new_page"],
  cannibalization: [],
};

function speedOf(lever: LeverKey): OptimizerSpeed {
  if (lever === "title" || lever === "meta") return "ctr_days";
  if (lever === "h1" || lever === "answer_block" || lever === "h2_sections" || lever === "visible_qa")
    return "rank_weeks";
  return "structural";
}

function metricOf(lever: LeverKey): string {
  switch (lever) {
    case "title":
    case "meta":
      return "We'll watch whether more people click your Google listing, usually visible within a week";
    case "h1":
    case "answer_block":
    case "h2_sections":
    case "visible_qa":
      return "We'll watch your Google ranking and how often you show up; this takes a few weeks to update";
    case "schema":
      return "Rich-result eligibility and impressions";
    case "internal_links":
      return "Avg position across the linked cluster";
    case "new_page":
      return "New page impressions and clicks once indexed";
    case "cannibalization":
      return "Combined clicks across the competing pages";
  }
}

function rollbackOf(row: WorkbenchLeverRow): RollbackType {
  if (row.lever === "new_page") return "none";
  if (!row.rollbackReady) return "best_effort";
  if (row.lever === "title" || row.lever === "meta" || row.lever === "h1" || row.lever === "schema")
    return "exact_prior_value";
  return "reversible_add";
}

/** Normalize an action string to the atomic vocabulary (tolerate legacy
 *  "edit_title" / "add_internal_link" forms recorded by older surfaces). */
function normAction(a: string): string {
  return a.toLowerCase().trim().replace(/^(edit|add|change|update|fix|new)_/, "");
}

function actionMatchesLever(action: string, lever: LeverKey): boolean {
  const n = normAction(action);
  if (n === lever) return true;
  if (LEVER_ACTIONS[lever].some((a) => normAction(a) === n)) return true;
  // light tolerance for legacy / variant spellings
  if (lever === "meta" && n.startsWith("meta")) return true;
  if (lever === "answer_block" && n.includes("answer")) return true;
  if (lever === "h2_sections" && n.startsWith("section")) return true;
  if (lever === "visible_qa" && (n === "faq" || n.includes("qa"))) return true;
  if (lever === "internal_links" && n.includes("internal_link")) return true;
  if (lever === "new_page" && n.includes("new_page")) return true;
  return false;
}

function isCtrAction(action: string): boolean {
  const n = normAction(action);
  return n === "title" || n.startsWith("meta");
}

/** A lever is "already measuring" when ANY action under measurement on this page
 *  (PS proof-plan row + the GSC shipped-change ledger) maps to it. CTR siblings
 *  perturb each other's CTR proof window, so a measuring title holds meta too. */
function isMeasuring(lever: LeverKey, measuringActions: string[]): boolean {
  for (const a of measuringActions) {
    if (actionMatchesLever(a, lever)) return true;
    if (CTR_FAMILY.has(lever) && isCtrAction(a)) return true;
  }
  return false;
}

function blockerOf(
  row: WorkbenchLeverRow,
  measuring: boolean,
  serpOwns: boolean,
): OptimizerBlocker {
  if (measuring) return "measuring";
  if (CTR_FAMILY.has(row.lever) && (row.serpGuardLabel != null || serpOwns)) return "serp";
  if (row.pushMethod === "blocked_no_mapping") return "wix";
  if (row.proposedSource === "needs_endpoint" || row.status === "unknown") return "data";
  return null;
}

function reasonFor(c: Omit<OptimizerCandidate, "reason">, proof: ProofPlanRow | null): string {
  switch (c.blockedBy) {
    case "measuring":
      return proof
        ? `Already measuring (check-in ${proof.windows.checkIn28}). Changing it now resets the proof window.`
        : "Already measuring on the proof ledger. Changing it now resets the measurement window.";
    case "serp":
      return "A SERP feature likely owns these clicks. Verify the live SERP before editing the title or meta; prefer an answer block or schema.";
    case "wix":
      return "Needs a Wix CMS mapping before it can publish. Map the field first, or edit it manually.";
    case "data":
      return c.draftSource === "needs_endpoint"
        ? "A real change is warranted but the analysis endpoint must draft the literal copy first."
        : "Not enough data on this dimension yet.";
    default:
      return c.safeNow ? "Shippable now with a real rollback." : "Ready to review.";
  }
}

function toCandidate(
  row: WorkbenchLeverRow,
  input: OptimizerInput,
  measuringActions: string[],
): OptimizerCandidate {
  const serpOwns = input.serp?.featureLikelyOwnsAnswer === true;
  const measuring = isMeasuring(row.lever, measuringActions);
  const blockedBy = blockerOf(row, measuring, serpOwns);
  const rollbackType = rollbackOf(row);
  const safeNow =
    blockedBy === null && row.canAutoApply && row.rollbackReady && row.risk === "low";
  const estClicksAtStake = row.benefit?.estClicksAtStake ?? null;
  const upsideConfidence = row.benefit?.confidence ?? null;
  const leverageScore =
    row.benefit != null ? row.benefit.estClicksAtStake * CONF_WEIGHT[row.benefit.confidence] : 0;

  // Enrich the evidence with the SERP hypothesis cause when this is a guarded CTR lever.
  let evidence = row.whyNeeded;
  if (blockedBy === "serp" && input.serp) {
    const cause = input.serp.queries.find((q) => q.featureLikelyOwnsAnswer)?.clickLossCause;
    if (cause) evidence = `${evidence} SERP: ${cause}.`;
  }

  const base: Omit<OptimizerCandidate, "reason"> = {
    lever: row.lever,
    label: row.label,
    draft: row.proposed,
    draftSource: row.proposedSource,
    evidence,
    estClicksAtStake,
    upsideConfidence,
    risk: row.risk,
    measurementMetric: metricOf(row.lever),
    rollbackType,
    wixPushMethod: row.pushMethod,
    canAutoApply: row.canAutoApply,
    serpGuardLabel: row.serpGuardLabel,
    verdict: decideVerdict(row),
    safeNow,
    blockedBy,
    speed: speedOf(row.lever),
    leverageScore,
  };
  return { ...base, reason: reasonFor(base, input.proof) };
}

const RISK_RANK: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };

/** Build the six operator buckets over the lever matrix. Pure + deterministic. */
export function buildOptimizer(input: OptimizerInput): OptimizerBuckets {
  // Everything under measurement on this page: the PS proof-plan row's action +
  // the GSC shipped-change ledger's open ("measuring") actions. Both gate overlap.
  const measuringActions: string[] = [
    ...(input.proof ? [input.proof.headlineAction] : []),
    ...(input.measuringActions ?? []),
  ];

  // Only `needed` levers are real candidates; the rest are healthy / not flagged.
  const candidates = input.matrix.rows
    .filter((r) => r.needed)
    .map((r) => toCandidate(r, input, measuringActions));

  // Whole-page-healthy: nothing flagged → a single protective Hold, all picks null.
  if (candidates.length === 0) {
    return {
      bestNextMove: null,
      safestChange: null,
      highestUpside: null,
      fastestMeasurable: null,
      biggerSwingLater: null,
      holdDoNotTouch: [
        {
          lever: "keep_current" as LeverKey,
          label: "Keep current",
          draft: null,
          draftSource: "n/a",
          evidence: "No dimension is underperforming the demand this page already has.",
          estClicksAtStake: null,
          upsideConfidence: null,
          risk: "low",
          measurementMetric: "Monitor, revisit if rankings slip",
          rollbackType: "none",
          wixPushMethod: "not_applicable",
          canAutoApply: false,
          serpGuardLabel: null,
          verdict: "Do not touch",
          safeNow: false,
          blockedBy: null,
          speed: "structural",
          leverageScore: 0,
          reason: "Healthy for its position. Monitor, do not touch.",
        },
      ],
    };
  }

  const hold: OptimizerCandidate[] = candidates.filter((c) => c.blockedBy !== null);
  const eligible = candidates.filter((c) => c.blockedBy === null);

  // Bigger swing later: a net-new page or a high-risk structural rewrite. At most
  // one (highest leverage). Removed from the one-click contention pools.
  const biggerPool = candidates.filter(
    (c) => c.lever === "new_page" || (c.lever === "h2_sections" && c.risk === "high"),
  );
  const biggerSwingLater =
    [...biggerPool].sort((a, b) => b.leverageScore - a.leverageScore)[0] ?? null;
  const biggerKey = (c: OptimizerCandidate) => `${c.lever}`;
  const biggerSet = new Set(biggerSwingLater ? [biggerKey(biggerSwingLater)] : []);

  // Best next move: highest leverage among eligible, never cannibalization (an
  // operator cluster decision) and never the bigger-swing structural play.
  const bestPool = eligible.filter(
    (c) => c.lever !== "cannibalization" && !biggerSet.has(biggerKey(c)),
  );
  const bestNextMove =
    [...bestPool].sort(
      (a, b) =>
        b.leverageScore - a.leverageScore ||
        Number(b.safeNow) - Number(a.safeNow) ||
        speedRank(a.speed) - speedRank(b.speed),
    )[0] ?? null;

  // Safest: lowest risk among eligible, tie-broken by a real (exact-value)
  // rollback then auto-applicability.
  const safestChange =
    [...eligible].sort(
      (a, b) =>
        RISK_RANK[a.risk] - RISK_RANK[b.risk] ||
        Number(b.rollbackType === "exact_prior_value") - Number(a.rollbackType === "exact_prior_value") ||
        Number(b.canAutoApply) - Number(a.canAutoApply),
    )[0] ?? null;

  // Highest upside: biggest estimate regardless of blocker (annotated), so the
  // operator sees the real ceiling even when it needs SERP/Wix/data first.
  const highestUpside =
    [...candidates]
      .filter((c) => (c.estClicksAtStake ?? 0) > 0)
      .sort((a, b) => (b.estClicksAtStake ?? 0) - (a.estClicksAtStake ?? 0))[0] ?? null;

  // Fastest measurable: a CTR lever (title/meta) that is shippable and not SERP
  // owned or under measurement, so it moves AND reads in GSC within days.
  const fastestMeasurable =
    [...eligible]
      .filter((c) => c.speed === "ctr_days" && (c.estClicksAtStake ?? 0) > 0)
      .sort((a, b) => b.leverageScore - a.leverageScore)[0] ?? null;

  return {
    bestNextMove,
    safestChange,
    highestUpside,
    fastestMeasurable,
    biggerSwingLater,
    holdDoNotTouch: hold,
  };
}

function speedRank(s: OptimizerSpeed): number {
  return s === "ctr_days" ? 0 : s === "rank_weeks" ? 1 : 2;
}
