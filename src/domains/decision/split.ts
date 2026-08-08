/**
 * decision/split: what two of an account's own pages coming up for ONE search actually proves, and what it
 * does not. It proves they both receive views for it. It NEVER proves the clicks are being divided, and it
 * never says which page should survive: a live change told an operator their clicks were splitting and then
 * admitted in the next sentence that Beacon could not tell which page held the stronger position.
 *
 * So this file reads the ONE thing that can settle it and that the operator can inspect: what each of those
 * pages earns for that EXACT search, off this account's own search data. A survivor is proven only when every
 * competing page has figures of its own and one of them is ahead on BOTH clicks and position. Anything else
 * is an investigation, and the honest answer is that no change is written yet.
 *
 * PURE: no store, no clock, no model call.
 */

import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { canonicalUrlKey, type EvidenceSnapshot } from "@/domains/evidence/snapshot";

/** ONE competing page on the exact search, with its own figures or the honest absence of them. */
export type SplitRow = { url: string; clicks: number | null; impressions: number | null; position: number | null };

/** PURE: every page of this account that comes up for this exact search, and what each earns for it. */
export function splitComparison(snapshot: EvidenceSnapshot, query: string): SplitRow[] {
  const key = canonicalQueryKey(query);
  const group = snapshot.cannibalization.find((g) => canonicalQueryKey(g.query) === key);
  if (!group) return [];
  return group.competingUrls.map((url) => {
    const own = snapshot.ownedPages.find((p) => canonicalUrlKey(p.url) === canonicalUrlKey(url));
    const row = (own?.search?.topQueries ?? []).find((q) => canonicalQueryKey(q.query) === key);
    return { url, clicks: row?.clicks ?? null, impressions: row?.impressions ?? null, position: row?.position ?? null };
  });
}

/**
 * PURE: the page the account's OWN figures say should survive, or null. This used to demand that one page beat
 * every other on clicks AND position, so the strongest live case in the account (two pages on one search, 832
 * clicks a month behind it) sat for ever on "let me read what each page earns" while those exact earnings were
 * already on file. THREE HONEST ANSWERS, and only the third is a deferral: where every competing page is
 * measured, the one ahead on clicks wins; where they earn the SAME (usually nothing at all), the page Google
 * already ranks higher wins, because that is the one decision the operator can act on without me inventing a
 * number; and ONE-SIDED KNOWLEDGE SETTLES NOTHING. A page I hold no row for is unmeasured, not behind, and a
 * survivor "ahead" of a page nobody weighed would send that page away for good on my ignorance. An exact tie on
 * both settles nothing either: there is no honest way to pick, so I do not pretend there is.
 */
export function provenSurvivor(rows: readonly SplitRow[]): string | null {
  if (rows.length < 2 || rows.some((r) => r.clicks == null || r.position == null)) return null;
  const best = [...rows].sort((a, b) => b.clicks! - a.clicks! || a.position! - b.position!)[0]!;
  const ahead = rows.every((r) => r.url === best.url || best.clicks! > r.clicks!
    || (best.clicks! === r.clicks! && best.position! < r.position!));
  return ahead ? best.url : null;
}
