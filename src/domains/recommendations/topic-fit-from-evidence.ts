/**
 * Expert-rec-engine PHASE I (2026-06-16) — derive a PageTopicFit for a live
 * recommendation row from the evidence it already carries.
 *
 * The page-topic intent-fit scorer (Slice 3) is pure over a generic input; this
 * adapter feeds it the BEST available signal for a `RecommendationActionRow`
 * WITHOUT the (not-yet-persisted) page snapshot:
 *   • primary query  ← the GSC headline query, else a tracked prompt;
 *   • supporting queries ← the rest of the GSC evidence + prompts (the
 *     page's real search footprint — an independent topical signal);
 *   • page topic proxy ← the clean target label + URL path.
 * Brand/locale terms are PASSED IN from tenant config (never baked).
 *
 * Returns null when the row carries no quotable query (nothing to score).
 *
 * The richer generation-time wiring (scoring against the full page snapshot +
 * gating resolution confidence) is the planned hot-path follow-up; this adapter
 * is the safe read-side surface that needs no new data dependency.
 *
 * PURE / deterministic. Pinned by tests/domains/recommendations/topic-fit-from-evidence.test.ts.
 */

import { scorePageTopicFit, type PageTopicFit } from "./page-topic-fit";
import type { RecommendationActionRow } from "./recommendation-action-rows";

function unquote(value: string): string {
  return value.trim().replace(/^[“"']+/, "").replace(/[”"']+$/, "").trim();
}

function pathnameOf(url: string | null): string | null {
  if (typeof url !== "string" || url.length === 0 || url === "needs_new_page") {
    return null;
  }
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export function deriveRowTopicFit(
  row: RecommendationActionRow,
  affectedPromptTexts: ReadonlyArray<string>,
  opts: { brandTerms?: ReadonlyArray<string>; localeTerms?: ReadonlyArray<string> } = {},
): PageTopicFit | null {
  const gsc = row.detail.gscEvidenceLines ?? [];

  const gscQ = gsc[0] ? unquote(gsc[0].value) : null;
  const promptQ = affectedPromptTexts[0] ?? null;

  const primary = [gscQ, promptQ].find(
    (q): q is string => typeof q === "string" && q.trim().length > 1,
  );
  if (primary == null) return null;

  const supporting = [
    ...gsc.slice(1).map((l) => unquote(l.value)),
    ...affectedPromptTexts,
  ]
    .map((q) => q.trim())
    .filter((q) => q.length > 1 && q !== primary);

  return scorePageTopicFit({
    page: {
      title: row.targetLabel,
      urlPath: pathnameOf(row.targetUrl),
    },
    query: primary,
    supportingQueries: supporting,
    brandTerms: opts.brandTerms,
    localeTerms: opts.localeTerms,
  });
}
