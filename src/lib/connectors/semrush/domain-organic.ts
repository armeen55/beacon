/**
 * Insight Graph slice 2 (2026-06-12) — SEMrush domain_organic report:
 * every keyword the domain ranks for WITH the ranking URL (`Ur`) —
 * THE per-page join, 10 API units per line (the cheap report; the
 * 80-unit/line gap report is deliberately NOT used nightly).
 *
 * Columns requested (official report reference, cited in the slice
 * commit): Ph keyword, Po position, Pp previous position, Nq monthly
 * volume, Cp CPC, Ur ranking URL, Tr traffic share %, Kd difficulty,
 * In intent (0 commercial / 1 informational / 2 navigational /
 * 3 transactional).
 *
 * Fail-soft: returns null on no-key/disconnected/API error.
 */

import "server-only";

import {
  parseSemrushCsv,
  semrushNum,
  semrushRawFetch,
  type SemrushRawFetchDeps,
} from "./client";

export type SemrushOrganicKeyword = {
  keyword: string;
  position: number;
  prevPosition: number | null;
  volume: number;
  cpc: number | null;
  url: string;
  trafficPct: number | null;
  difficulty: number | null;
  intent: string | null;
};

/** Nightly per-tenant line cap: 150 lines × 10 units = 1,500 units —
 *  inside the ≤2,000-unit nightly budget from the research spec. */
export const DOMAIN_ORGANIC_NIGHTLY_LIMIT = 150;

export async function fetchDomainOrganicKeywords(
  args: { tenantId: string; domain: string; displayLimit?: number },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushOrganicKeyword[] | null> {
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type: "domain_organic",
      domain: args.domain,
      exportColumns: "Ph,Po,Pp,Nq,Cp,Ur,Tr,Kd,In",
      displayLimit: args.displayLimit ?? DOMAIN_ORGANIC_NIGHTLY_LIMIT,
      displaySort: "tr_desc",
    },
    deps,
  );
  if (!res.ok) return null;

  const rows = parseSemrushCsv(res.csv);
  const out: SemrushOrganicKeyword[] = [];
  for (const r of rows) {
    const keyword = (r["Keyword"] ?? r["Ph"] ?? "").trim();
    const url = (r["Url"] ?? r["Ur"] ?? "").trim();
    const position = semrushNum(r["Position"] ?? r["Po"]);
    if (!keyword || !url || position == null) continue;
    out.push({
      keyword,
      position,
      prevPosition: semrushNum(r["Previous Position"] ?? r["Pp"]),
      volume: semrushNum(r["Search Volume"] ?? r["Nq"]) ?? 0,
      cpc: semrushNum(r["CPC"] ?? r["Cp"]),
      url,
      trafficPct: semrushNum(r["Traffic (%)"] ?? r["Tr"]),
      difficulty: semrushNum(r["Keyword Difficulty"] ?? r["Kd"]),
      intent: (r["Intent"] ?? r["In"] ?? "").trim() || null,
    });
  }
  return out;
}
