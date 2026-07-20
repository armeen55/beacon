/**
 * today-view (2026-07-01, Move 5), the PURE Today read model. Today is NOT a second
 * backlog; it's a focused operational slice DERIVED from the same CanonicalChange[] that
 * powers /changes (Changes). One identity, one lifecycle, one measurement state, one
 * quality decision, one action path, no parallel recommendation engine, no new
 * persistence. Changes is the complete backlog; Today answers only: what needs attention,
 * what am I planning, what's next if today is empty. (2026-07-20: the unrendered
 * measuring-list/attention-list/counts.measuring/counts.resultsAvailable fields were deleted;
 * Today's own page renders measuring/results straight off the canonical lifecycle loader.)
 */
import type { CanonicalChange, Strategy } from "./canonical-change";
import { rankChanges } from "./strategy";
import { decideChangeAction, isActDecision } from "./decide-action";

export type TodayPlanStatus = "none" | "preview" | "accepted" | "in_progress" | "completed";

export type TodayOpportunity = {
  changeId: string;
  pageLabel: string;
  recommendation: string;
  opportunityType: string;
  estimatedEffortMinutes: number;
  upside: number | null;
  evidenceStrength: CanonicalChange["evidenceStrength"];
};

/**
 * FP3 - THE ONE-COUNT RULE (see domains/changes/lifecycle-counts.ts). The builder takes the
 * CANONICAL whole-tenant ledger pair (countLedgerLifecycle: measuring = Results' "In flight"
 * set, decided = Wins + What we learned) threaded in from the same ChangesView release that
 * carries measuringCountCanonical / decidedCountCanonical, and uses it ONLY to decide the
 * greeting sentence and whether a "results ready" alert fires (folded into `needsAttention`
 * below). Neither raw number is exposed on `counts`: every rendered surface that needs the
 * measuring/decided totals (Today's own page, Results) already reads them straight off the
 * SAME canonical loader, so re-exposing a second copy here is exactly how the "25 vs 7"
 * divergence class reappears (a persisted Today blob can go stale independently of the live
 * ledger). `readyToday` and `needsAttention` are Today-specific derived numbers with no other
 * canonical source, so they stay.
 */
export type TodayCounts = { readyToday: number; needsAttention: number };

export type TodayView = {
  strategy: Strategy;
  planStatus: TodayPlanStatus;
  headerSentence: string;
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

/** Build the Today slice from the canonical backlog + the daily-plan summary. PURE.
 *  `ledgerCounts` is the FP3 canonical pair from the SAME ChangesView release
 *  (measuringCountCanonical / decidedCountCanonical, i.e. countLedgerLifecycle over the
 *  proof ledger) - see the TodayCounts doc above for why status must never re-derive it. */
export function buildTodayView(input: {
  changes: CanonicalChange[];
  strategy: Strategy;
  plan: TodayPlanSummary | null;
  ledgerCounts: { measuring: number; decided: number };
}): TodayView {
  const { changes, strategy } = input;
  const plan = input.plan;
  const planStatus: TodayPlanStatus = plan?.status ?? "none";

  // FP3 ONE-COUNT RULE: the canonical decided total (Results' Wins + What we learned),
  // never a status === "result" recount of the worklist slice. Used ONLY below to decide
  // whether the "results ready" condition contributes to `needsAttention` - the decided
  // total itself is never re-exposed on `counts` (Results already renders it straight off
  // the same canonical loader).
  const resultsAvailable = input.ledgerCounts.decided;

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

  // needsAttention, deterministic count of the same conditions that used to render as a
  // titled/messaged alert list (that list itself rendered nowhere and was deleted 2026-07-20;
  // the count is still Today's own "Needs attention" tile). "Collecting normally" is NOT an
  // alert.
  let needsAttention = 0;
  if (plan?.wasRefreshed) needsAttention += 1;
  if (planStatus === "accepted" && plan && plan.leftToApply > 0) needsAttention += 1;
  if (planStatus === "preview" && plan && plan.selectedCount > 0) needsAttention += 1;
  if (resultsAvailable > 0) needsAttention += 1;

  const counts: TodayCounts = {
    readyToday: planStatus === "preview" || planStatus === "accepted" ? (plan?.selectedCount ?? 0) : 0,
    needsAttention,
  };

  return {
    strategy,
    planStatus,
    headerSentence: headerSentenceFor(planStatus, plan, counts, input.ledgerCounts.measuring),
    nextOpportunities,
    counts,
  };
}

function headerSentenceFor(
  status: TodayPlanStatus,
  plan: TodayPlanSummary | null,
  counts: TodayCounts,
  ledgerMeasuring: number,
): string {
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
  if (ledgerMeasuring > 0 && counts.readyToday === 0) return "Your recent changes are collecting data.";
  return "Choose a few changes to work on today.";
}
