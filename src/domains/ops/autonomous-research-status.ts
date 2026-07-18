import type { AutonomousPipelineStage, WarmRunReceipt } from "./warm-receipt-store";

export type AutonomousResearchHeaderStatus = {
  label: string;
  tone: "idle" | "running" | "ready" | "partial";
  title: string;
  progress: { completed: number; total: number; percent: number; nextLabel: string } | null;
};

const PIPELINE_STAGES: readonly AutonomousPipelineStage[] = [
  "baseline", "graph", "competitors", "keywords", "ai", "knowledge", "opportunities", "finalize",
];

const STAGE_LABEL: Record<AutonomousPipelineStage, string> = {
  baseline: "checking your site",
  graph: "mapping demand",
  competitors: "studying competitors",
  keywords: "expanding keywords",
  ai: "checking AI answers",
  knowledge: "checking facts",
  opportunities: "ranking opportunities",
  finalize: "saving the strongest moves",
};

/** Factual pipeline progress only. This never estimates time or pretends an
 * external Google reporting window is a controllable loading job. */
export function autonomousResearchProgress(receipt: WarmRunReceipt | null) {
  if (!receipt?.pipeline || receipt.pipeline.version !== 1 || receipt.pipeline.nextStage == null) return null;
  const completed = new Set(receipt.pipeline.completedStages.filter((stage) => PIPELINE_STAGES.includes(stage))).size;
  return {
    completed,
    total: PIPELINE_STAGES.length,
    percent: Math.round((completed / PIPELINE_STAGES.length) * 100),
    nextLabel: STAGE_LABEL[receipt.pipeline.nextStage],
  };
}

/** A "running after this response" receipt older than this never got its
 * terminal receipt written - the lambda that scheduled the after() work was
 * killed (e.g. a page maxDuration under the cycle's 210s deadline). Past this we
 * stop calling it "running" and tell the truth: the pass was cut short and picks
 * back up on the next visit. */
export const STALE_RUNNING_MS = 15 * 60_000;

/** The exact copy for a background pass that never finished. First person, no
 * jargon, no dashes. Shared with autonomous-health.ts. */
export const CUT_SHORT_COPY =
  "My last background pass was cut short. I will pick it up on your next visit.";

function hasRunningNote(receipt: WarmRunReceipt): boolean {
  return receipt.steps.some((step) => step.name === "autonomous-research" && step.note === "running after this response");
}

/** True only while the "running" receipt is still FRESH (its lambda could still
 * be alive). A stale one reads as stalled, never as running. */
function isRunning(receipt: WarmRunReceipt, now: Date): boolean {
  if (!hasRunningNote(receipt)) return false;
  const ranAt = Date.parse(receipt.ran_at);
  if (Number.isFinite(ranAt) && now.getTime() - ranAt >= STALE_RUNNING_MS) return false;
  return true;
}

/** A "running" receipt whose lambda is long dead: the terminal receipt never
 * arrived. Only fires for the note-based started receipt, never for a resumable
 * checkpointed pipeline (that legitimately persists across navigations). */
function isStalledRunning(receipt: WarmRunReceipt, now: Date): boolean {
  if (!hasRunningNote(receipt)) return false;
  const ranAt = Date.parse(receipt.ran_at);
  return Number.isFinite(ranAt) && now.getTime() - ranAt >= STALE_RUNNING_MS;
}

function hasMorePipelineWork(receipt: WarmRunReceipt): boolean {
  return receipt.pipeline?.version === 1 && receipt.pipeline.nextStage != null;
}

export function autonomousResearchStatusLine(receipt: WarmRunReceipt | null, now: Date = new Date()): string {
  if (!receipt) return "Beacon will research, compare, rank, and prepare your next moves automatically after this visit.";
  // A stalled "running" receipt with no resumable pipeline is a dead lambda, not
  // live work: say so honestly instead of an eternal "preparing in background".
  if (isStalledRunning(receipt, now) && !hasMorePipelineWork(receipt)) return CUT_SHORT_COPY;
  if ((isRunning(receipt, now) || hasMorePipelineWork(receipt)) && receipt.summary) {
    const progress = autonomousResearchProgress(receipt);
    return `Your saved results are ready. Beacon is refreshing the evidence${progress ? ` (${progress.completed} of ${progress.total}: ${progress.nextLabel})` : ""} and will replace them only when the newer pass is complete.`;
  }
  if (isRunning(receipt, now) || hasMorePipelineWork(receipt)) {
    const progress = autonomousResearchProgress(receipt);
    return `Beacon is preparing the first saved result in the background${progress ? ` (${progress.completed} of ${progress.total}: ${progress.nextLabel})` : ""}. You can keep using the app.`;
  }
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

export function autonomousResearchHeaderStatus(receipt: WarmRunReceipt | null, now: Date = new Date()): AutonomousResearchHeaderStatus {
  const title = autonomousResearchStatusLine(receipt, now);
  const progress = autonomousResearchProgress(receipt);
  if (!receipt) return { label: "Research starts on visit", tone: "idle", title, progress: null };
  // A cut-short pass (dead lambda, no resumable pipeline) is honestly partial.
  if (isStalledRunning(receipt, now) && !hasMorePipelineWork(receipt)) return { label: "Last pass cut short", tone: "partial", title, progress: null };
  if ((isRunning(receipt, now) || hasMorePipelineWork(receipt)) && receipt.summary) return { label: progress ? `Refreshing · ${progress.completed}/${progress.total}` : "Up to date · refreshing", tone: "ready", title, progress };
  if (isRunning(receipt, now) || hasMorePipelineWork(receipt)) return { label: progress ? `Preparing · ${progress.completed}/${progress.total}` : "Preparing in background", tone: "running", title, progress };
  if (!receipt.summary && !receipt.ok) return { label: "Preparing in background", tone: "running", title, progress: null };
  if (!receipt.ok) return { label: "Research partially refreshed", tone: "partial", title, progress: null };
  const ready = receipt.summary?.readyToReview ?? 0;
  return {
    label: ready > 0 ? `${ready.toLocaleString()} move${ready === 1 ? "" : "s"} ready` : "Research up to date",
    tone: "ready",
    title,
    progress: null,
  };
}
