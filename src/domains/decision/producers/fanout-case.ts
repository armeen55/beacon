import type { FanoutRow } from "@/domains/evidence/ai-visibility/fanout-evidence";
import type { AiCaseState } from "../ai-case-store";
import { count } from "./page-fit";

export type FanoutStage = "owned_retrieved_not_cited" | "rivals_cited_own_not_retrieved" | "own_not_in_reported_sources";
type FanoutCase = { caseKey: string; state: AiCaseState; stage?: FanoutStage; pageUrl?: string; reason: string };

/** Evidence in, one state out. Recurrence becomes work only when a second dimension shows consequence. */
export function resolveFanoutCase(row: FanoutRow, landing?: { pageUrl: string | null; refused: boolean },
  corroboration?: { googleDemand?: boolean }): FanoutCase {
  const caseKey = `fanout:${row.key}`;
  if (row.ownState === "cited") return { caseKey, state: "already_credited",
    reason: `Credited on ${count(row.ownCitedAnswers, "answer")} of the ${count(row.reportingAnswers, "answer")} that ran this search and reported their sources. Nothing to change here; watch that it holds.` };
  if (row.ownState === "unreported") return { caseKey, state: "unreported",
    reason: "The assistants that ran this search never reported which pages they used, so where this site stood on it is unknown. That is missing reporting, not a zero, and no page edit closes it." };
  if (!row.material) return { caseKey, state: "monitoring", reason: `${row.materialBecause}. Watched, and it becomes work the day it recurs.` };
  const dimension = row.parents.length >= 2 ? `behind ${count(row.parents.length, "tracked question")}`
    : row.engines.length >= 2 ? `across ${count(row.engines.length, "assistant")}`
      : row.retrievedNotCitedAnswers > 0 ? "with a page here read for it and passed over"
        : corroboration?.googleDemand ? "and people ask Google the same thing" : null;
  if (dimension == null) return { caseKey, state: "monitoring",
    reason: `${row.materialBecause}, on one question and one assistant with no consequence here yet. Watched, and it becomes work the day a second question, a second assistant, a read page or Google demand joins it.` };
  const stage: FanoutStage = row.ownState === "retrieved_not_cited" ? "owned_retrieved_not_cited"
    : row.retrievalReportingAnswers > 0 ? "rivals_cited_own_not_retrieved" : "own_not_in_reported_sources";
  if (landing && landing.pageUrl == null) return { caseKey, state: "no_page", stage,
    reason: `${row.materialBecause}, and no page of this account is for it yet, so no edit can win it. It is on the list of pages to build.` };
  return { caseKey, state: "actionable", stage, ...(landing?.pageUrl ? { pageUrl: landing.pageUrl } : {}),
    reason: stage === "owned_retrieved_not_cited"
      ? `${row.materialBecause} ${dimension}, and a page here was read for it and passed over ${count(row.retrievedNotCitedAnswers, "time")}.`
      : stage === "rivals_cited_own_not_retrieved"
        ? `${row.materialBecause} ${dimension}, and no assistant reports reading a page of this account for it.`
        : `${row.materialBecause} ${dimension}, and this site is not among the sources the assistants relied on for it. Whether any page here was read is not something these instruments report.` };
}
