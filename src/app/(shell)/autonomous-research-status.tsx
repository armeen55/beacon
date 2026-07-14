import "server-only";

import { readLastWarmReceipt, type WarmRunReceipt } from "@/domains/ops/warm-receipt-store";

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
    `${s.keywordGapsFound.toLocaleString()} competitor keyword gaps`,
    `${s.competitorPagesAnalyzed.toLocaleString()} competitor pages`,
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

export async function AutonomousResearchStatus({ tenantId }: { tenantId: string }) {
  const receipt = await readLastWarmReceipt(tenantId, "visit");
  return (
    <p className="-mt-4 text-xs text-muted-foreground" data-testid="autonomous-research-status">
      {autonomousResearchStatusLine(receipt)}
    </p>
  );
}
