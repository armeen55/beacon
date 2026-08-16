/** evidence/demand-units - RELATED SEARCHES ARE ONE AUDIENCE. The decision floor used to read one query row at
 *  a time, so a page shown 2,922 times across 384 phrasings of one intent ("nowruz 2026", "when is nowruz",
 *  "nowruz persian new year") never cleared a 500-impression bar any single phrasing missed, and 63% of the
 *  site's demand was invisible to the only path that can authorise work. This module groups a page's query
 *  rows into DEMAND UNITS deterministically, with no model and no site-specific rule:
 *    - two queries whose distinguishing tokens are EQUAL are one unit ("persian girl names",
 *      "girl names persian", "persian names for girls" - the tokenizer already drops connectives);
 *    - a query whose tokens ADD at most one to a member's set joins it, but only when the shorter side
 *      carries at least three tokens, so "list of persian girl names" joins "persian girl names" while a
 *      two-token head like "persian names" stays its own unit rather than folding into every child intent.
 *  Unit metrics are the honest sums: impressions and clicks add, position is impressions-weighted, expected
 *  clicks are what each member's own position pays on the account's own curve, and recoverable is the unit's
 *  shortfall under that, floored at zero. The member phrasings ride along as `vocabulary`: the exact words
 *  searchers use, which is what the drafter may lead with and the one thing a page's own copy cannot supply.
 *  PURE and deterministic: same rows in any order, same units. */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { OwnedQuerySignal } from "@/domains/evidence/snapshot";

export type DemandUnit = {
  /** The unit's biggest member query: a real search, so SERP and readiness lookups stay exact. */
  label: string;
  /** Every member, impressions-descending. */
  queries: OwnedQuerySignal[];
  impressions: number;
  clicks: number;
  /** Impressions-weighted average position across members that carry one. */
  position: number | null;
  /** What the members' own positions pay on the supplied curve, summed. */
  expectedClicks: number;
  /** expectedClicks minus clicks, floored at zero. */
  recoverableClicks: number;
  /** Distinct member phrasings, biggest first: the searchers' own vocabulary for the drafter. */
  vocabulary: string[];
};

const keyOf = (tokens: string[]): string => [...new Set(tokens)].sort().join("|");

/** Group one page's query rows into demand units. `expectedCtrAt` is the account's own fitted curve. */
export function demandUnitsOf(
  queries: readonly OwnedQuerySignal[],
  expectedCtrAt: (position: number) => number,
): DemandUnit[] {
  const rows = queries
    .map((q) => ({ q, tokens: [...new Set(topicTokens(q.query))] }))
    .filter((r) => r.tokens.length > 0)
    .sort((a, b) => b.q.impressions - a.q.impressions || a.q.query.localeCompare(b.q.query));
  // Pass 1: exact token-set identity.
  const byKey = new Map<string, { tokens: string[]; members: OwnedQuerySignal[] }>();
  for (const r of rows) {
    const k = keyOf(r.tokens);
    const got = byKey.get(k);
    if (got) got.members.push(r.q);
    else byKey.set(k, { tokens: r.tokens, members: [r.q] });
  }
  // Pass 2: guarded subset absorption, biggest group first so the anchor is the demand center. A group joins
  // an anchor when its token set contains the anchor's whole set with at most one extra token, and the anchor
  // carries at least three tokens. Deterministic: groups are visited impressions-descending.
  const groups = [...byKey.values()].sort(
    (a, b) => sum(b.members) - sum(a.members) || keyOf(a.tokens).localeCompare(keyOf(b.tokens)));
  const units: { tokens: Set<string>; members: OwnedQuerySignal[] }[] = [];
  for (const g of groups) {
    const set = new Set(g.tokens);
    const host = units.find((u) =>
      u.tokens.size >= 3 && set.size <= u.tokens.size + 1 && [...u.tokens].every((t) => set.has(t)));
    if (host) host.members.push(...g.members);
    else units.push({ tokens: set, members: [...g.members] });
  }
  return units.map((u) => {
    const members = [...u.members].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
    const impressions = sum(members);
    const clicks = members.reduce((a, m) => a + m.clicks, 0);
    const withPos = members.filter((m) => m.position != null && Number.isFinite(m.position));
    const posWeight = withPos.reduce((a, m) => a + m.impressions, 0);
    const position = posWeight > 0 ? withPos.reduce((a, m) => a + (m.position as number) * m.impressions, 0) / posWeight : null;
    const expectedClicks = withPos.reduce((a, m) => a + expectedCtrAt(m.position as number) * m.impressions, 0);
    return {
      label: members[0]!.query,
      queries: members,
      impressions,
      clicks,
      position: position == null ? null : Math.round(position * 10) / 10,
      expectedClicks: Math.round(expectedClicks),
      recoverableClicks: Math.max(0, Math.round(expectedClicks - clicks)),
      vocabulary: [...new Set(members.map((m) => m.query))],
    };
  }).sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label));
}

const sum = (ms: readonly OwnedQuerySignal[]): number => ms.reduce((a, m) => a + m.impressions, 0);
