/**
 * SEMrush phrase_related + phrase_questions reports (2026-06-18) — the broader
 * QUERY context for a page's top query: synonym/variant keywords people also
 * search (phrase_related) and the question-form keywords (phrase_questions)
 * that are answer-block / FAQ fodder. This is what lets a Page Surgeon brief
 * say not just "GSC shows X is happening on the page" but "the wider market
 * also searches Y and asks Z" — grounding wording research in real demand.
 *
 * Columns: Ph keyword, Nq monthly volume, Cp CPC, Kd difficulty, In intent.
 * Keyword reports are pricier than domain reports — ~40 API units per line —
 * so callers cap display_limit tightly.
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

export type SemrushPhraseKeyword = {
  keyword: string;
  volume: number;
  cpc: number | null;
  difficulty: number | null;
  intent: string | null;
};

/** Tight per-seed cap: 10 lines × ~40 units = ~400 units per phrase report. */
export const PHRASE_EXPANSION_DIAGNOSTIC_LIMIT = 10;

async function fetchPhraseReport(
  type: "phrase_related" | "phrase_questions",
  args: { tenantId: string; phrase: string; database?: string; displayLimit?: number },
  deps: SemrushRawFetchDeps,
): Promise<SemrushPhraseKeyword[] | null> {
  const phrase = args.phrase.trim();
  if (!phrase) return null;
  const res = await semrushRawFetch(
    {
      tenantId: args.tenantId,
      type,
      phrase,
      database: args.database,
      exportColumns: "Ph,Nq,Cp,Kd,In",
      displayLimit: args.displayLimit ?? PHRASE_EXPANSION_DIAGNOSTIC_LIMIT,
      displaySort: "nq_desc",
    },
    deps,
  );
  if (!res.ok) return null;

  const rows = parseSemrushCsv(res.csv);
  const out: SemrushPhraseKeyword[] = [];
  for (const r of rows) {
    const keyword = (r["Keyword"] ?? r["Ph"] ?? "").trim();
    if (!keyword) continue;
    out.push({
      keyword,
      volume: semrushNum(r["Search Volume"] ?? r["Nq"]) ?? 0,
      cpc: semrushNum(r["CPC"] ?? r["Cp"]),
      difficulty: semrushNum(r["Keyword Difficulty"] ?? r["Kd"]),
      intent: (r["Intent"] ?? r["In"] ?? "").trim() || null,
    });
  }
  return out;
}

export function fetchPhraseRelated(
  args: { tenantId: string; phrase: string; database?: string; displayLimit?: number },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushPhraseKeyword[] | null> {
  return fetchPhraseReport("phrase_related", args, deps);
}

export function fetchPhraseQuestions(
  args: { tenantId: string; phrase: string; database?: string; displayLimit?: number },
  deps: SemrushRawFetchDeps = {},
): Promise<SemrushPhraseKeyword[] | null> {
  return fetchPhraseReport("phrase_questions", args, deps);
}
