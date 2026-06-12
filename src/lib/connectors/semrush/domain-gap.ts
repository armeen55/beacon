/**
 * Keyword-gap slice (2026-06-12) — SEMrush domain_domains report:
 * keywords a COMPETITOR ranks top-10 that the tenant's domain does
 * not rank at all ("Missing" class in Semrush's gap-analysis guide).
 *
 * BUDGET DISCIPLINE (spec): this is the expensive report — 80 API
 * units per line — so it is fetched WEEKLY (gated upstream) with
 * display_limit ≤ 6: 6 lines × 80 = 480 units, inside the rotating
 * weekly slot of the ≤2,000-unit nightly budget.
 *
 * The `domains` parameter encodes the comparison: `*|or|<competitor>`
 * unioned with `-|or|<us>` = keywords the competitor has that we
 * don't (the guide's "Missing" filter). Columns: Ph keyword,
 * P0/P1 positions (per the domains order), Nq volume, Kd difficulty.
 *
 * Fail-soft null like every connector fetch.
 */

import "server-only";

import {
  parseSemrushCsv,
  semrushNum,
  semrushRawFetch,
  type SemrushRawFetchDeps,
} from "./client";

export type KeywordGapRow = {
  keyword: string;
  /** Competitor's position (P0 — first domain in the chain). */
  competitorPosition: number;
  volume: number;
  difficulty: number | null;
};

export const GAP_WEEKLY_LIMIT = 6;

export async function fetchKeywordGap(
  args: {
    tenantId: string;
    ourDomain: string;
    competitorDomain: string;
    displayLimit?: number;
  },
  deps: SemrushRawFetchDeps = {},
): Promise<KeywordGapRow[] | null> {
  // `domains` chain: <sign>|<operator>|<domain>. "*|or|comp" includes
  // the competitor's keywords; "-|or|us" excludes ours → Missing.
  const chain = `*|or|${args.competitorDomain}|-|or|${args.ourDomain}`;
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type: "domain_domains",
      // The client sets `domain=` from this field; domain_domains
      // ignores it in favor of `domains`, passed via exportColumns…
      // no — pass through the dedicated param below.
      domain: args.ourDomain,
      exportColumns: "Ph,P0,Nq,Kd",
      displayLimit: args.displayLimit ?? GAP_WEEKLY_LIMIT,
      displaySort: "nq_desc",
      extraParams: { domains: chain },
    },
    deps,
  );
  if (!res.ok) return null;
  const rows = parseSemrushCsv(res.csv);
  const out: KeywordGapRow[] = [];
  for (const r of rows) {
    const keyword = (r["Keyword"] ?? r["Ph"] ?? "").trim();
    const pos = semrushNum(r["P0"]);
    if (!keyword || pos == null) continue;
    out.push({
      keyword,
      competitorPosition: pos,
      volume: semrushNum(r["Search Volume"] ?? r["Nq"]) ?? 0,
      difficulty: semrushNum(r["Keyword Difficulty"] ?? r["Kd"]),
    });
  }
  return out;
}
