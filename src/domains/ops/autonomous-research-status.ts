import type { WarmRunReceipt } from "./warm-receipt-store";

export type AutonomousResearchHeaderStatus = {
  label: string;
  tone: "idle" | "running" | "ready" | "partial";
  title: string;
};

export function autonomousResearchStatusLine(receipt: WarmRunReceipt | null): string {
  if (!receipt) return "Beacon will research, compare, rank, and prepare your next moves automatically after this visit.";
  if (!receipt.summary) {
    return receipt.ok
      ? "Beacon’s automatic research pass is complete."
      : "Beacon is refreshing evidence and preparing your strongest moves in the background.";
  }
  const s = receipt.summary;
  const evidence = [
    `${s.keywordTermsPlanned.toLocaleString()} keyword signals`,
    ...((s.finalKeywordTermsChecked ?? 0) > 0
      ? [`${(s.finalKeywordTermsChecked ?? 0).toLocaleString()} final keyword volumes`]
      : []),
    `${s.keywordGapsFound.toLocaleString()} competitor keyword gaps`,
    `${s.competitorPagesAnalyzed.toLocaleString()} competitor pages`,
    ...((s.finalSerpWinnersAnalyzed ?? 0) > 0
      ? [`${(s.finalSerpWinnersAnalyzed ?? 0).toLocaleString()} final Google winners`]
      : []),
    `${s.aiTopicsPolled.toLocaleString()} AI topics`,
    `${s.questionsRanked.toLocaleString()} questions`,
  ].join(", ");
  const outcome = `${s.readyToReview.toLocaleString()} move${s.readyToReview === 1 ? "" : "s"} ready to review`;
  const dataForSeo =
    s.dataForSeoStatus === "disabled"
      ? " DataForSEO is not connected, so competitor keyword mining stayed off."
      : s.dataForSeoStatus === "dry_run"
        ? " DataForSEO is in dry-run, so its paid lookups were planned but not called."
        : "";
  const aiPoll = s.aiEnginePollStatus === "already_ran"
    ? " AI-engine answers were already refreshed today."
    : s.aiEnginePollStatus === "no_prompts"
      ? " AI-engine polling needs tracked questions before it can run."
      : s.aiEnginePollStatus === "error" || s.aiEnginePollStatus === "not_run"
        ? " AI-engine polling did not complete and will retry safely."
        : "";
  return receipt.ok
    ? `Automatic research complete: ${evidence}; ${outcome}.${dataForSeo}${aiPoll}`
    : `Automatic research partially completed: ${evidence}; ${outcome}. Beacon will retry safely.${dataForSeo}${aiPoll}`;
}

export function autonomousResearchHeaderStatus(receipt: WarmRunReceipt | null): AutonomousResearchHeaderStatus {
  const title = autonomousResearchStatusLine(receipt);
  if (!receipt) return { label: "Research starts on visit", tone: "idle", title };
  if (!receipt.summary && !receipt.ok) return { label: "Researching now", tone: "running", title };
  if (!receipt.ok) return { label: "Research partially refreshed", tone: "partial", title };
  const ready = receipt.summary?.readyToReview ?? 0;
  return {
    label: ready > 0 ? `${ready.toLocaleString()} move${ready === 1 ? "" : "s"} ready` : "Research up to date",
    tone: "ready",
    title,
  };
}
