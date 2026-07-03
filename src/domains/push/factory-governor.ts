/**
 * factory-governor (2026-07-03, BEACON_500 R8 / N28 - the scaled-content law).
 *
 * PURE / no I/O. Before ANY factory batch produces pages, this governor
 * enforces the four rules that keep a page factory from becoming scaled-content
 * spam (the reason the factories were frozen until N5 + N28 existed):
 *
 *   1. INFORMATION GAIN (N5): a batch page whose info-gain verdict is
 *      duplicate_of_serp or thin_addition is refused - every produced page must
 *      either pass adds_something or be honestly UNCHECKED (no teardown
 *      evidence for its topic; the gate never blocks on missing data).
 *   2. NO SELF-OVERLAP: no two pages in one batch may share a distinguishing
 *      topic token (the ownership registry's own topicTokens rule) - one
 *      opportunity, one page.
 *   3. WEEKLY PACE: at most MAX_NEW_PAGES_PER_WEEK new pages per tenant per
 *      week, counting what the shipped ledger + factory batch history already
 *      produced this week (the caller counts; this module enforces).
 *   4. SITE-GROWTH RATIO: this month's new pages must stay under
 *      MAX_MONTHLY_GROWTH_RATIO of the tenant's indexed page count
 *      (page_snapshots). Unknown page count -> the guard honestly skips
 *      (never block on missing data).
 *
 * Output is `{ allowed, refusals: [{ slug, plainReason }] }` plus one summary
 * sentence for the batch card: "I skipped 3 of 8: two would repeat what the
 * winners already say, one would push this month's new pages past a healthy
 * pace." Beacon voice, no dashes, no lab words.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { InfoGainVerdict } from "@/domains/drafts/info-gain-gate";

/** Hard governance caps - constants, not tenant-configurable. */
export const MAX_NEW_PAGES_PER_WEEK = 5;
export const MAX_MONTHLY_GROWTH_RATIO = 0.1;

export type GovernorCandidate = {
  slug: string;
  title: string;
  /** N5 verdict when the caller has one; defaults to "unchecked" (allowed). */
  infoGainVerdict?: InfoGainVerdict;
  /** The N5 sentence, used verbatim as the refusal reason when present. */
  infoGainSentence?: string | null;
};

export type GovernorRefusalCategory =
  | "repeats_winners"
  | "too_little_new"
  | "overlaps_batch"
  | "weekly_pace"
  | "monthly_growth";

export type GovernorRefusal = {
  slug: string;
  plainReason: string;
  category: GovernorRefusalCategory;
};

export type GovernorInput = {
  /** Batch candidates in ranked order (rank decides who wins a capped slot). */
  candidates: readonly GovernorCandidate[];
  /** New pages already produced THIS WEEK (shipped ledger + batch history),
   *  excluding this batch. */
  newPagesThisWeek: number;
  /** New pages already produced THIS MONTH, excluding this batch. */
  newPagesThisMonth: number;
  /** Indexed page count from page_snapshots; null/0 = unknown -> growth guard
   *  skips honestly instead of blocking everything on missing data. */
  indexedPageCount: number | null;
  maxPerWeek?: number;
};

export type GovernorResult = {
  allowed: GovernorCandidate[];
  refusals: GovernorRefusal[];
  /** "I skipped 3 of 8: ..." for the batch card; null when nothing refused. */
  summary: string | null;
};

function smallCount(n: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return n >= 0 && n < words.length ? words[n]! : String(n);
}

/** Build the batch-card summary from refusal categories. Exported so a caller
 *  merging its own N5 refusals into the list can rebuild one honest sentence. */
export function summarizeRefusals(refusals: readonly GovernorRefusal[], considered: number): string | null {
  if (refusals.length === 0) return null;
  const counts = new Map<GovernorRefusalCategory, number>();
  for (const r of refusals) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const parts: string[] = [];
  const repeat = (counts.get("repeats_winners") ?? 0) + (counts.get("too_little_new") ?? 0);
  if (repeat > 0) parts.push(`${smallCount(repeat)} would repeat what the winners already say`);
  const overlap = counts.get("overlaps_batch") ?? 0;
  if (overlap > 0) parts.push(`${smallCount(overlap)} would double up on another page in this batch`);
  const week = counts.get("weekly_pace") ?? 0;
  if (week > 0) parts.push(`${smallCount(week)} would push this week's new pages past a healthy pace`);
  const month = counts.get("monthly_growth") ?? 0;
  if (month > 0) parts.push(`${smallCount(month)} would push this month's new pages past a healthy pace`);
  return `I skipped ${smallCount(refusals.length)} of ${smallCount(considered)}: ${parts.join(", ")}.`;
}

/**
 * Enforce the four laws over one ranked batch. Deterministic, pure.
 * Checks run per candidate in order: info gain, batch overlap, weekly pace,
 * monthly growth - so a page that would be refused anyway never consumes a
 * capped slot.
 */
export function governFactoryBatch(input: GovernorInput): GovernorResult {
  const maxPerWeek = input.maxPerWeek ?? MAX_NEW_PAGES_PER_WEEK;
  const allowed: GovernorCandidate[] = [];
  const refusals: GovernorRefusal[] = [];
  const allowedTokenSets: Array<{ title: string; tokens: Set<string> }> = [];

  const pageCount =
    typeof input.indexedPageCount === "number" && input.indexedPageCount > 0
      ? input.indexedPageCount
      : null;
  const monthlyCeiling = pageCount != null ? Math.floor(pageCount * MAX_MONTHLY_GROWTH_RATIO) : null;

  for (const c of input.candidates) {
    const verdict = c.infoGainVerdict ?? "unchecked";

    // 1. N5 information gain.
    if (verdict === "duplicate_of_serp") {
      refusals.push({
        slug: c.slug,
        category: "repeats_winners",
        plainReason:
          c.infoGainSentence ??
          `I skipped "${c.title}" because it would repeat what the winning pages already say.`,
      });
      continue;
    }
    if (verdict === "thin_addition") {
      refusals.push({
        slug: c.slug,
        category: "too_little_new",
        plainReason:
          c.infoGainSentence ??
          `I skipped "${c.title}" because it adds too little beyond what the winning pages already say.`,
      });
      continue;
    }

    // 2. No two batch pages on ONE topic: the ownership registry's own
    //    distinguishing-token rule (resolveOwner) - two titles are the same
    //    topic when every token of the smaller side appears in the larger.
    //    A single shared token ("Tahdig Recipe" vs "Ash Reshteh Recipe") is
    //    NOT a clash - the entity-attribute factory legitimately produces
    //    sibling pages sharing one attribute word.
    const tokens = new Set(topicTokens(`${c.title} ${c.slug.replace(/[-_/]+/g, " ")}`));
    const clash = allowedTokenSets.find((a) => {
      if (tokens.size === 0 || a.tokens.size === 0) return false;
      const [smaller, larger] = a.tokens.size <= tokens.size ? [a.tokens, tokens] : [tokens, a.tokens];
      for (const t of smaller) if (!larger.has(t)) return false;
      return true;
    });
    if (clash) {
      refusals.push({
        slug: c.slug,
        category: "overlaps_batch",
        plainReason: `I skipped "${c.title}" because it covers the same ground as "${clash.title}" in this batch; one page should own one topic.`,
      });
      continue;
    }

    // 3. Weekly pace.
    if (input.newPagesThisWeek + allowed.length >= maxPerWeek) {
      refusals.push({
        slug: c.slug,
        category: "weekly_pace",
        plainReason: `I skipped "${c.title}" because this week already has ${smallCount(input.newPagesThisWeek + allowed.length)} of ${smallCount(maxPerWeek)} new pages; a steady pace beats a flood.`,
      });
      continue;
    }

    // 4. Monthly site-growth ratio (skipped honestly when the page count is unknown).
    if (monthlyCeiling != null && input.newPagesThisMonth + allowed.length + 1 > monthlyCeiling) {
      refusals.push({
        slug: c.slug,
        category: "monthly_growth",
        plainReason: `I skipped "${c.title}" because this month's new pages would pass 10 percent of your ${pageCount} indexed pages; growing faster than that reads as scaled content to search engines.`,
      });
      continue;
    }

    allowed.push(c);
    if (tokens.size > 0) allowedTokenSets.push({ title: c.title, tokens });
  }

  return {
    allowed,
    refusals,
    summary: summarizeRefusals(refusals, input.candidates.length),
  };
}

// ── pure date-window counters for the callers ────────────────────────────────

/** Monday (UTC) of the week containing `now`, as YYYY-MM-DD. Mirrors the
 *  page-factory production line's weekOf key exactly. */
export function mondayOfWeekUtc(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

/** How many ISO timestamps fall in the same Monday-to-Sunday UTC week as `now`. */
export function countInWeekOf(isoDates: readonly (string | null | undefined)[], now: Date): number {
  const monday = Date.parse(`${mondayOfWeekUtc(now)}T00:00:00.000Z`);
  const nextMonday = monday + 7 * 24 * 60 * 60 * 1000;
  let n = 0;
  for (const d of isoDates) {
    const t = Date.parse(d ?? "");
    if (Number.isFinite(t) && t >= monday && t < nextMonday) n += 1;
  }
  return n;
}

/** How many ISO timestamps fall in the same UTC calendar month as `now`. */
export function countInMonthOf(isoDates: readonly (string | null | undefined)[], now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let n = 0;
  for (const d of isoDates) {
    const t = Date.parse(d ?? "");
    if (!Number.isFinite(t)) continue;
    const dt = new Date(t);
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m) n += 1;
  }
  return n;
}
