import "server-only";

/**
 * What THIS run buys, and why (ONE frozen research plan, 2026-07-28). Runtime asks Decision ONE question -
 * what is the research actually stuck on - and hands Evidence plain strings and plain pages, so Decision
 * never reaches a provider and Evidence never reads Decision. The answer comes from the SAME free verdict
 * that decides whether this account already owns the right page.
 *
 * WHAT THE PLAN DOES AND DOES NOT BIND. It JUMPS THE QUEUE for searches and winner reads: the frozen
 * queries go to `selectSerpAgenda` and `rankWinningPages` as priorities beside the account's own page
 * queries, tracked questions and retained keywords, and the agenda still runs to 40. The live run of
 * 2026-07-29 paid for two searches outside its plan, at $0.0006 each, exactly as designed. An earlier
 * version of this header claimed every search a run pays for belongs to a frozen topic; it does not,
 * and only the COMPARISON is bound that way. Saying otherwise made a queue-jump read as a spend cap.
 *
 * ONE SELECTOR, AND IT IS A PLAN, NOT A SINGLE TOPIC. A pass freezes up to three topics in priority order
 * (see MAX_PRIORITY_QUERIES) and never re-picks them; it only recomputes the next requirement for THOSE
 * topics as evidence lands. The invariant that actually protects the money is narrower than "one topic",
 * and it is the one worth stating: the comparison this run buys must be earned by a topic in the frozen
 * plan, under the basis it was frozen under. Anything else buys nothing. Only what buying can close is
 * queued: a mixed shape or an unsettled meaning is already settled by the results page on file, and queueing
 * it spent real fetches to reach the same refusal. Fail-soft: no answer means no priority, never a stall.
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

/** The exact searches the frozen focus owes, in its own order (Evidence gets strings, never a topic). */
export function focusQueries(focus: ResearchFocus | null, nowMs: number): string[] {
  return due(focus, nowMs).map((t) => t.query).filter((q): q is string => !!q);
}

/** The ONE page of the account's OWN this run may go and read, or null. Evidence gets an address, never a topic.
 *  BOUND TO THE BASIS IT WAS FROZEN UNDER, exactly like the comparison. A run can span days, so a plan frozen
 *  before the operator changed their site or their goal would otherwise send me to read the OLD basis's page,
 *  and the new basis holds none of the retry memory that promised a date for it. */
export function focusOwnedUrl(focus: ResearchFocus | null, nowMs: number, basis: string | null): string | null {
  if (!basis || !focus || focus.basis !== basis) return null;
  return due(focus, nowMs).map((t) => t.ownedUrl).find((u): u is string => !!u) ?? null;
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
