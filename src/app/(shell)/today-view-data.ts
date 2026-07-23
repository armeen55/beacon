import "server-only";

/**
 * today-view-data (CORE 100K cutover, 2026-07-22) — Today's slice, derived from
 * the SAME ranked ChangeProposals /changes renders (loadChangesView). No parallel
 * recommendation engine, no new persistence. Today answers only: what is the one
 * best move next, and how much is measuring. Fail-soft: a missing changes read
 * degrades to a quiet Today.
 */
import { after } from "next/server";
import { currentTenantId } from "@/lib/tenant-context";
import { loadChangesView, sanitizeSurfaceComputedAt, type ChangesView } from "./changes-data";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import type { ChangeProposal } from "@/domains/decision";
import type { TodayOpportunity, EvidenceStrength } from "@/domains/measurement/today/today-command";

/** The minimal Today read model the Today page renders (headerSentence + the one
 *  ranked next opportunity). Owned here now that the changes-domain today-view was
 *  retired. */
export type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
};

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
};

const CONFIDENCE_TO_STRENGTH: Record<ChangeProposal["confidence"], EvidenceStrength> = {
  high: "strong",
  medium: "directional",
  low: "tracking",
};

/** A plain first-person directive for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  if (c.kind === "new_page") return `Build a new page that answers "${p.primaryQuery}"`;
  const field = c.field === "meta" ? "description" : c.field.replace(/_/g, " ");
  return `Update the ${field} on ${p.pageLabel} to sharpen it for "${p.primaryQuery}"`;
}

/** PURE: map a ranked proposal to Today's opportunity shape. */
export function proposalToOpportunity(p: ChangeProposal): TodayOpportunity {
  return {
    changeId: p.id,
    pageLabel: p.pageLabel,
    recommendation: recommendationOf(p),
    opportunityType: p.opportunityType,
    estimatedEffortMinutes: p.estimatedEffortMinutes,
    upside: p.upsidePerMonth,
    evidenceStrength: CONFIDENCE_TO_STRENGTH[p.confidence],
  };
}

/** PURE: build the Today slice from a ChangesView. Today's next opportunities are
 *  the ready (validated, exact-copy) proposals, best first. */
export function buildTodayViewFromChanges(view: ChangesView): TodayView {
  const ready = view.ready.slice(0, 5).map(proposalToOpportunity);
  const measuring = view.measuringCountCanonical;
  let headerSentence: string;
  if (ready.length > 0) {
    headerSentence =
      measuring > 0
        ? `You have ${ready.length} change${ready.length === 1 ? "" : "s"} ready to apply and ${measuring} still measuring.`
        : `You have ${ready.length} change${ready.length === 1 ? "" : "s"} ready to apply.`;
  } else if (view.toDo.length > 0) {
    headerSentence = `I have ${view.toDo.length} idea${view.toDo.length === 1 ? "" : "s"} to review with you, and ${measuring} change${measuring === 1 ? "" : "s"} measuring.`;
  } else if (measuring > 0) {
    headerSentence = `Nothing needs a decision today. ${measuring} change${measuring === 1 ? " is" : "s are"} measuring.`;
  } else {
    headerSentence = "Nothing needs a decision today. Connect your data and I'll rank your next moves.";
  }
  return { headerSentence, nextOpportunities: ready };
}

async function loadTodayViewUncached(): Promise<TodayComposite> {
  const view = await loadChangesView().catch(() => null);
  if (!view) {
    return { today: { headerSentence: "Nothing needs a decision today.", nextOpportunities: [] }, hasChanges: false };
  }
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0 };
}

/** Compose Today from the exact Changes release that will ship beside it. */
export async function buildTodayCompositeFromChanges(view: ChangesView): Promise<TodayComposite> {
  return { today: buildTodayViewFromChanges(view), hasChanges: view.proposals.length > 0 };
}

export async function loadTodayView(): Promise<TodayComposite> {
  return loadTodayViewWithSwr(await currentTenantId());
}

type TodayViewBuilder = (tenantId: string) => Promise<TodayComposite>;

/** Exported for tests; render paths go through loadTodayView above. */
export async function loadTodayViewWithSwr(
  tenantId: string,
  deps: { build?: TodayViewBuilder } = {},
): Promise<TodayComposite> {
  const build = deps.build ?? (() => loadTodayViewUncached());
  const scheduleReleaseRebuild = () =>
    after(async () => {
      const { refreshCustomerSurface } = await import("./surface-release");
      await refreshCustomerSurface(tenantId).catch(() => null);
    });

  const customer = await readCustomerSurface(tenantId).catch(() => null);
  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild();
    return {
      ...customer.today,
      surfaceVersion: customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  scheduleReleaseRebuild();
  return build(tenantId);
}
