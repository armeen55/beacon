import "server-only";

/**
 * What THIS run buys, and why (ONE frozen research plan). Runtime asks Decision ONE question, what the research is actually stuck
 * on, and hands Evidence plain strings and plain pages, so Decision never reaches a provider and Evidence never reads Decision. The
 * answer comes from the SAME free verdict that decides whether this account already owns the right page.
 *
 * WHAT THE PLAN DOES AND DOES NOT BIND. It JUMPS THE QUEUE for searches and winner reads: the frozen queries go to
 * `selectSerpAgenda` and `rankWinningPages` as PRIORITIES, first and verbatim, beside the account's own page queries, tracked
 * questions and retained keywords. The plan is NOT a spend cap and never was: the agenda runs to whatever cap the caller passes
 * (SERP_AGENDA_CAP in evidence/funnel/observe), so a run legitimately pays for searches outside its own three topics, and only the
 * COMPARISON is bound to the plan. Read the provider's own receipt for what a pass cost; no price is asserted here.
 *
 * ONE SELECTOR, AND IT IS A PLAN, NOT A SINGLE TOPIC. A pass freezes up to three topics in priority order (see
 * MAX_PRIORITY_QUERIES) and never re-picks them; it only recomputes the next requirement for THOSE topics as evidence lands. The
 * invariant that actually protects the money is narrower than "one topic": the comparison this run buys must be earned by a topic in
 * the frozen plan, under the basis it was frozen under, and anything else buys nothing. Only what buying can close is queued, since
 * a mixed shape or an unsettled meaning is already settled by the results page on file and queueing it spent real fetches to reach
 * the same refusal. Fail-soft: no answer means no priority, never a stall.
 */
import { loadBusinessProfile } from "@/domains/account";
import { loadEvidenceSnapshot } from "@/domains/evidence/snapshot-loader";
import type { FunnelIntersectionAsk } from "@/domains/evidence";
import { researchNeeds, type ResearchNeed } from "@/domains/decision";
import { log } from "@/lib/logger";
import type { ResearchRunProgress } from "../research-run";

/** How many investigations one research pass may jump the queue for. */
const MAX_PRIORITY_QUERIES = 3;

/** THE run's frozen research plan, exactly as it is persisted on the run's own progress. */
export type ResearchFocus = NonNullable<ResearchRunProgress["focus"]>;

async function needs(tenantId: string): Promise<ResearchNeed[]> {
  const snapshot = await loadEvidenceSnapshot(tenantId);
  const profile = await loadBusinessProfile(tenantId).catch(() => null);
  const out = await researchNeeds(snapshot, tenantId, profile, MAX_PRIORITY_QUERIES);
  log.info("[research-run] what the research is stuck on", { tenantId, needs: out.map((n) => `${n.requirement}:${n.query ?? "compare"}`) });
  return out;
}

/** The plan this run freezes: chosen ONCE by the run executor, before a cent moves, never re-picked. */
export async function chooseInvestigation(tenantId: string, basis: string | null): Promise<ResearchFocus | null> {
  const out = await needs(tenantId);
  // THE COOLDOWN TRAVELS WITH THE PLAN. Decision computes the earliest legal retry for every topic and this
  // used to drop it on the floor, so no surface could tell a live acquisition from a page I am waiting on,
  // and nothing stopped a run buying the same search again the same day it was told to wait.
  return out.length === 0 ? null
    : { basis, topics: out.map((n) => ({ topicKey: n.topicKey, query: n.query, requirement: n.requirement, retryAfter: n.retryAfter, ownedUrl: n.ownedUrl })) };
}

/** The run's frozen plan, read forward. The pre-focus resume path is DELETED: it existed for runs
 *  frozen before `focus` was persisted, only an UNFINISHED run ever resumes, and production holds
 *  none. Carrying it meant keeping a second, keyless plan shape alive to serve nobody. */
export function runFocus(progress: ResearchRunProgress): ResearchFocus | null {
  return progress.focus ?? null;
}

/** The frozen topics that are actually DUE. A topic whose next legal read is still ahead of `nowMs` contributes
 *  NOTHING: a cooldown is a date I promised the operator, and jumping the queue for a read I said I would not
 *  make until tomorrow breaks it, whether the read is a search or a page of the account's own. */
const due = (focus: ResearchFocus | null, nowMs: number) => (focus?.topics ?? []).filter((t) => !(t.retryAfter && Date.parse(t.retryAfter) > nowMs));

/** EVERYTHING the frozen focus owes the reading side, in ONE answer (Evidence gets strings and an address,
 *  never a topic): `queries` is the exact searches, in the plan's own order; `ownedUrl` is the single page of
 *  the account's OWN this run may go and read, or null. The page is BOUND TO THE BASIS IT WAS FROZEN UNDER,
 *  exactly like the comparison. A run can span days, so a plan frozen before the operator changed their site
 *  or their goal would otherwise send me to read the OLD basis's page, and the new basis holds none of the
 *  retry memory that promised a date for it. */
export function focusReads(focus: ResearchFocus | null, nowMs: number, basis: string | null): { queries: string[]; cases: { caseId: string; query: string | null }[]; ownedUrl: string | null } {
  const topics = due(focus, nowMs), bound = !!basis && !!focus && focus.basis === basis;
  return { queries: topics.map((t) => t.query).filter((q): q is string => !!q),
    // The same frozen topics, WITH their case ids, for the side that files keywords under a case. Discovery
    // resolves each id through the registry itself, so an id this plan froze before a merge still lands right.
    cases: topics.filter((t) => !!t.topicKey).map((t) => ({ caseId: t.topicKey!, query: t.query })),
    ownedUrl: bound ? topics.map((t) => t.ownedUrl).find((u): u is string => !!u) ?? null : null };
}

/** The ONE page by page comparison worth paying for, RECONFIRMED before a cent moves: it must be earned by
 *  a topic THIS run froze, under the basis it was frozen under. A stranded basis, or a topic this run never
 *  chose, buys nothing - which is the normal answer, and the reason a pass usually buys none of this. */
export async function comparisonForFocus(tenantId: string, focus: ResearchFocus | null, basis: string | null): Promise<FunnelIntersectionAsk | null> {
  const keys = new Set((focus?.topics ?? []).map((t) => t.topicKey).filter((k): k is string => !!k));
  // THE FROZEN BASIS MUST BE PRESENT AND MATCH. Letting a null frozen basis pass turned the
  // check off for the whole life of a run: a plan frozen while the current-basis read failed
  // still carries real topic keys, and a run can span days, so the account could move to a
  // new basis and this would keep buying against the old one. Legacy runs never reach here
  // (they carry no topic key at all), so nothing honest is lost by requiring both sides.
  if (keys.size === 0 || !basis || focus!.basis !== basis) return null;
  const earned = (await needs(tenantId)).find((n) => n.comparison && keys.has(n.topicKey));
  return earned ? { topicKey: earned.topicKey, ask: earned.comparison! } : null;
}
