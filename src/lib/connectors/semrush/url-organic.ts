/**
 * SEMrush url_organic report (2026-06-18) — every keyword a SPECIFIC URL ranks
 * for. This is the per-page complement to domain_organic: instead of the
 * domain's top keywords (which may bury a given page), it returns the keyword
 * portfolio for exactly one page — the precise market context the Page Surgeon
 * brief needs for each diagnostic page. 10 API units per line.
 *
 * Columns: Ph keyword, Po position, Nq monthly volume, Cp CPC, Kd difficulty,
 * In intent (0 commercial / 1 informational / 2 navigational / 3 transactional).
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
import type { SemrushOrganicKeyword } from "./domain-organic";

/** Tight per-page diagnostic cap: 25 lines × 10 units = 250 units per page. */
export const URL_ORGANIC_DIAGNOSTIC_LIMIT = 25;

export async function fetchUrlOrganicKeywords(
  args: { tenantId: string; url: string; database?: string; displayLimit?: number },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushOrganicKeyword[] | null> {
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type: "url_organic",
      url: args.url,
      database: args.database,
      exportColumns: "Ph,Po,Nq,Cp,Kd,In",
      displayLimit: args.displayLimit ?? URL_ORGANIC_DIAGNOSTIC_LIMIT,
      displaySort: "nq_desc",
    },
    deps,
  );
  if (!res.ok) return null;

  const rows = parseSemrushCsv(res.csv);
  const out: SemrushOrganicKeyword[] = [];
  for (const r of rows) {
    const keyword = (r["Keyword"] ?? r["Ph"] ?? "").trim();
    const position = semrushNum(r["Position"] ?? r["Po"]);
    if (!keyword || position == null) continue;
    out.push({
      keyword,
      position,
      prevPosition: null,
      volume: semrushNum(r["Search Volume"] ?? r["Nq"]) ?? 0,
      cpc: semrushNum(r["CPC"] ?? r["Cp"]),
      url: args.url,
      trafficPct: null,
      difficulty: semrushNum(r["Keyword Difficulty"] ?? r["Kd"]),
      intent: (r["Intent"] ?? r["In"] ?? "").trim() || null,
    });
  }
  return out;
}
