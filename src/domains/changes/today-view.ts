/**
 * today-view (2026-07-01, Move 5), the PURE Today read model. Today is NOT a second
 * backlog; it's a focused operational slice DERIVED from the same CanonicalChange[] that
 * powers /changes (Changes). One identity, one lifecycle, one measurement state, one
 * quality decision, one action path, no parallel recommendation engine, no new
 * persistence. Changes is the complete backlog; Today answers only: what needs attention,
 * what am I planning, what's measuring, what's next if today is empty.
 */
import type { CanonicalChange, Strategy } from "./canonical-change";
import { statusView } from "./canonical-change";
import { rankChanges } from "./strategy";
import { decideChangeAction, isActDecision } from "./decide-action";

export type TodayPlanStatus = "none" | "preview" | "accepted" | "in_progress" | "completed";

export type TodayAttentionKind =
  | "review_plan" // a preview plan is ready to review/accept
  | "apply_pending" // accepted item(s) awaiting the operator's Wix edit
  | "results_ready" // mature result(s) ready to review
  | "refresh_plan"; // plan is stale/expired and was refreshed

export type TodayAttentionItem = {
  id: string;
  kind: TodayAttentionKind;
  title: string;
  message: string;
  href: string;
  priority: number; // lower = more urgent
};

export type TodayMeasuringItem = {
  changeId: string;
  pageLabel: string;
  pageUrl: string;
  headline: string; // maturity headline (Move 2)
  nextCheckpoint: string | null;
  attributionLimited: boolean;
};

export type TodayOpportunity = {
  changeId: string;
  pageLabel: string;
  recommendation: string;
  opportunityType: string;
  estimatedEffortMinutes: number;
  upside: number | null;
  evidenceStrength: CanonicalChange["evidenceStrength"];
};

export type TodayCounts = { readyToday: number; needsAttention: number; measuring: number; resultsAvailable: number };

export type TodayView = {
  strategy: Strategy;
  planStatus: TodayPlanStatus;
  headerSentence: string;
  attention: TodayAttentionItem[];
  measuring: TodayMeasuringItem[];
  nextOpportunities: TodayOpportunity[];
  counts: TodayCounts;
};

/** A tiny projection of the daily plan the builder needs, decouples Today from the
 *  experiments types. */
export type TodayPlanSummary = {
  status: TodayPlanStatus;
  selectedCount: number;
  leftToApply: number; // accepted items still awaiting the operator's edit
  wasRefreshed?: boolean;
};

const MAX_MEASURING = 5;
const MIN_OPPORTUNITIES = 3;
const MAX_OPPORTUNITIES = 10;

/**
 * B-8 (operator spec 2026-07-09): the next-best-moves count is DYNAMIC by
 * opportunity quality, never a fixed number. Rules, applied to an already
 * ranked list (best opportunity first):
 *   - always show at least MIN_OPPORTUNITIES (or all of them, when fewer exist)
 *   - never show more than MAX_OPPORTUNITIES
 *   - beyond the guaranteed first 3, keep extending the list only while the
 *     next item still has strong or directional evidence; the first item with
 *     merely "tracking" evidence stops the extension there (that item, and
 *     everything ranked after it, is left off - a quality cliff, not a count).
 * PURE, total, no I/O.
 */
export function dynamicOpportunityCount(items: ReadonlyArray<Pick<CanonicalChange, "evidenceStrength">>): number {
  const total = Math.min(items.length, MAX_OPPORTUNITIES);
  if (total <= MIN_OPPORTUNITIES) return total;
  let count = MIN_OPPORTUNITIES;
  for (let i = MIN_OPPORTUNITIES; i < total; i++) {
    const strength = items[i]!.evidenceStrength;
    if (strength === "strong" || strength === "directional") {
      count = i + 1;
    } else {
      break;
    }
  }
  return count;
}

/** Build the Today slice from the canonical backlog + the daily-plan summary. PURE. */
export function buildTodayView(input: {
  changes: CanonicalChange[];
  strategy: Strategy;
  plan: TodayPlanSummary | null;
}): TodayView {
  const { changes, strategy } = input;
  const plan = input.plan;
  const planStatus: TodayPlanStatus = plan?.status ?? "none";

  // Measuring, compact, cap 5. Deduped by identity (CanonicalChange already dedupes).
  const measuringAll = changes.filter((c) => statusView(c.status) === "measuring");
  const measuring: TodayMeasuringItem[] = measuringAll.slice(0, MAX_MEASURING).map((c) => ({
    changeId: c.id,
    pageLabel: c.pageLabel,
    pageUrl: c.pageUrl,
    headline: c.measurementHeadline ?? "Measuring",
    nextCheckpoint: c.nextCheckpoint,
    attributionLimited: c.attributionLimited,
  }));

  const resultsAvailable = changes.filter((c) => c.status === "result").length;

  // Next opportunities, the ranked "what to do next" list - the operator's primary daily
  // surface. ALWAYS the best undone moves by opportunity, independent of any plan/cron
  // (2026-07-08, operator: "it should just be the next best moves I haven't done yet,
  // refresh or not - it doesn't even need a cron"). We never gate this on plan status: a
  // stale/stuck/empty "tonight's plan" must never hide the real backlog again. Items already
  // in tonight's plan carry selectedForToday and are shown there, so we exclude them here to
  // avoid duplication; measuring / result / blocked items are never an actionable next step.
  // P1-6 (2026-07-10, visual audit HARD BLOCKER) - a status of "suggested"/"ready" alone is not
  // enough: build-canonical-changes.ts demotes a flagged (off-topic) ready item back to
  // "suggested" rather than blocking it, so it would otherwise still pass this filter and could
  // become nextOpportunities[0] - the Today command's "Do this next" - while the SAME item on
  // /changes routes to decideChangeAction's "watch" and sits in the archive, never on the command
  // path there. THE single decision authority (decide-action.ts) must gate here too, so Today can
  // never command an item /changes itself refuses to treat as actionable: only the four
  // act-decisions (edit/consolidate/create/prune) may become a next opportunity. Prefers the
  // already-refined c.decision (changes-data.ts's cannibalization-aware value) when present, the
  // same fallback changes-list-client.tsx's decisionOf uses.
  const eligibleOpportunities = rankChanges(changes, strategy)
    .filter((c) => (c.status === "suggested" || c.status === "ready") && !c.selectedForToday)
    .filter((c) => isActDecision(c.decision ?? decideChangeAction(c).decision));
  const nextOpportunities: TodayOpportunity[] = eligibleOpportunities
    .slice(0, dynamicOpportunityCount(eligibleOpportunities))
    .map((c) => ({
      changeId: c.id,
      pageLabel: c.pageLabel,
      recommendation: c.recommendation,
      opportunityType: c.opportunityType,
      estimatedEffortMinutes: c.estimatedEffortMinutes,
      upside: c.upside,
      evidenceStrength: c.evidenceStrength,
    }));

  // Attention, deterministic priority; each item is one reason + one action + (where
  // relevant) one canonical identity. "Collecting normally" is NOT an alert.
  const attention: TodayAttentionItem[] = [];
  if (plan?.wasRefreshed) {
    attention.push({ id: "refresh", kind: "refresh_plan", priority: 1, href: "/changes",
      title: "Today’s plan was refreshed", message: "It had timed out, review the updated list before accepting." });
  }
  if (planStatus === "accepted" && plan && plan.leftToApply > 0) {
    attention.push({ id: "apply", kind: "apply_pending", priority: 2, href: "/changes",
      title: `${plan.leftToApply} change${plan.leftToApply === 1 ? "" : "s"} ready to apply`, message: "Apply each in Wix, then Beacon verifies it live." });
  }
  if (planStatus === "preview" && plan && plan.selectedCount > 0) {
    attention.push({ id: "review", kind: "review_plan", priority: 3, href: "/changes",
      title: `${plan.selectedCount} quality-checked change${plan.selectedCount === 1 ? "" : "s"} ready for review`, message: "Review and accept today’s batch." });
  }
  if (resultsAvailable > 0) {
    attention.push({ id: "results", kind: "results_ready", priority: 4, href: "/results",
      title: `${resultsAvailable} mature result${resultsAvailable === 1 ? "" : "s"} ready`, message: "See what your shipped changes drove." });
  }
  attention.sort((a, b) => a.priority - b.priority);

  const counts: TodayCounts = {
    readyToday: planStatus === "preview" || planStatus === "accepted" ? (plan?.selectedCount ?? 0) : 0,
    needsAttention: attention.length,
    measuring: measuringAll.length,
    resultsAvailable,
  };

  return { strategy, planStatus, headerSentence: headerSentenceFor(planStatus, plan, counts), attention, measuring, nextOpportunities, counts };
}

function headerSentenceFor(status: TodayPlanStatus, plan: TodayPlanSummary | null, counts: TodayCounts): string {
  if (status === "preview" && plan) return `${plan.selectedCount} quality-checked change${plan.selectedCount === 1 ? "" : "s"} ready for review.`;
  if (status === "accepted" && plan) {
    return plan.leftToApply > 0
      ? `${plan.leftToApply} of ${plan.selectedCount} change${plan.selectedCount === 1 ? "" : "s"} still to apply.`
      : `All ${plan.selectedCount} change${plan.selectedCount === 1 ? "" : "s"} applied, measuring now.`;
  }
  if (status === "in_progress") return "Your changes are live and measuring.";
  // Wave 3B: the "nothing to do right now" reassurance is OWNED by the ONE Today command (its
  // observe kind: "Nothing needs a decision today. Keep measuring."). The greeting brief must not
  // repeat it, or the same reassurance renders twice, and it must never appear on a day that is
  // NOT observe (a defect / loss / ready-to-ship day). So the brief stays factual here.
  if (counts.measuring > 0 && counts.readyToday === 0) return "Your recent changes are collecting data.";
  return "Choose a few changes to work on today.";
}
