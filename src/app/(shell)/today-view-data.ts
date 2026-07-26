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
import { normalizedFixKey } from "@/components/today/today-smoke-alarm";
import { readCustomerSurface, isCustomerSurfaceStale } from "./surface-release";
import { countTrackedQuestions } from "@/domains/runtime";
import type { ChangeProposal } from "@/domains/decision";
import type { TodayOpportunity, EvidenceStrength } from "@/domains/measurement/today/today-command";

/** The minimal Today read model the Today page renders (headerSentence + the one
 *  ranked next opportunity). Owned here now that the changes-domain today-view was
 *  retired. */
export type TodayView = {
  headerSentence: string;
  nextOpportunities: TodayOpportunity[];
  /** Pages that already have a READY proposal in THIS release, keyed by the same
   *  normalized path the smoke alarm blames, carrying the proposal to open. Today
   *  says "I have a fix ready" only from this list, and links straight at it.
   *  Optional so a release blob written before this field degrades to no claim.
   *  proposalId is EMPTY STRING when the change has no bundle: the fix is real
   *  (so the claim stays honest) but /changes/<id> would 404 for it, so the CTA
   *  falls back to the Changes queue. */
  readyFixes?: { page: string; proposalId: string }[];
};

export type TodayComposite = {
  today: TodayView;
  hasChanges: boolean;
  surfaceVersion?: string;
  surfaceComputedAt?: string;
  /** TRUE when I am tracking zero questions, which is the one state that stops my
   *  research outright. Today shows the fix instead of a silent empty page. */
  needsTrackedQuestions?: boolean;
  /** Where that fix lives. */
  trackedQuestionsHref?: string;
};

const CONFIDENCE_TO_STRENGTH: Record<ChangeProposal["confidence"], EvidenceStrength> = {
  high: "strong",
  medium: "directional",
  low: "tracking",
};

/** A plain first-person directive for one proposal (the "do this next" line). */
function recommendationOf(p: ChangeProposal): string {
  const c = p.recommendedChange;
  // Slice 7: a bundled change already states its objective in one plain sentence.
  if (p.bundle) return p.bundle.objective;
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

/** How many ready changes Today previews under its one command. */
const TODAY_PREVIEW_LIMIT = 5;

/** PURE: build the Today slice from a ChangesView. Today's next opportunities are
 *  the ready (validated, exact-copy) proposals, best first. The COUNT is the full
 *  ready list; the preview is the top five, so Today can never under-report the
 *  queue it is drawing from (it used to count the sliced preview). */
export function buildTodayViewFromChanges(view: ChangesView): TodayView {
  const readyTotal = view.ready.length;
  const ready = view.ready.slice(0, TODAY_PREVIEW_LIMIT).map(proposalToOpportunity);
  const readyFixes = view.ready
    .filter((p) => p.pagePath || p.pageUrl)
    .map((p) => ({ page: normalizedFixKey(p.pagePath ?? p.pageUrl ?? ""), proposalId: p.bundle ? p.id : "" }))
    .filter((f) => f.page.length > 0);
  const measuring = view.measuringCountCanonical;
  let headerSentence: string;
  if (readyTotal > 0) {
    const lead =
      readyTotal > ready.length
        ? `You have ${readyTotal} changes ready; here are the ${ready.length === 5 ? "five" : ready.length} strongest.`
        : `You have ${readyTotal} change${readyTotal === 1 ? "" : "s"} ready to apply.`;
    headerSentence =
      measuring > 0
        ? `${lead} ${measuring} more ${measuring === 1 ? "is" : "are"} still measuring.`
        : lead;
    return { headerSentence, nextOpportunities: ready, readyFixes };
  } else if ((view.demotedStaleBasis ?? 0) > 0) {
    const n = view.demotedStaleBasis;
    headerSentence = `Your business info changed, so I set aside ${n} earlier ${n === 1 ? "idea" : "ideas"} and will draft fresh ones on the next research pass.${measuring > 0 ? ` ${measuring} change${measuring === 1 ? " is" : "s are"} still measuring.` : ""}`;
  } else if (view.toDo.length > 0) {
    const tail = measuring > 0 ? `, and ${measuring} change${measuring === 1 ? " is" : "s are"} measuring` : "";
    headerSentence = `I have ${view.toDo.length} idea${view.toDo.length === 1 ? "" : "s"} to review with you${tail}.`;
  } else if (measuring > 0) {
    headerSentence = `Nothing needs a decision today. ${measuring} change${measuring === 1 ? " is" : "s are"} measuring.`;
  } else {
    headerSentence = "Nothing needs a decision today. I am still gathering evidence, and I will rank your next moves as it lands.";
  }
  return { headerSentence, nextOpportunities: ready, readyFixes };
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

  // One lean head-count, in parallel with the surface read: zero tracked
  // questions is the ONE state that stops research outright, and Today has to
  // name it rather than look merely quiet. A failed count (null) claims
  // NOTHING: a false zero would advertise a recovery the account does not need.
  const [customer, trackedCount] = await Promise.all([
    readCustomerSurface(tenantId).catch(() => null),
    countTrackedQuestions(tenantId).catch(() => null),
  ]);
  const paused = trackedCount === 0
    ? { needsTrackedQuestions: true, trackedQuestionsHref: "/settings/config#tracked-ai-prompts" }
    : {};

  if (customer) {
    if (isCustomerSurfaceStale(customer.computedAt, Date.now())) scheduleReleaseRebuild();
    return {
      ...customer.today,
      ...paused,
      surfaceVersion: customer.releaseId,
      surfaceComputedAt: sanitizeSurfaceComputedAt(customer.computedAt) ?? undefined,
    };
  }
  scheduleReleaseRebuild();
  return { ...(await build(tenantId)), ...paused };
}
