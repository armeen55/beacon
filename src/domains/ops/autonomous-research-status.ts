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
 * arrived. Note-based only. A resumable pipeline is judged separately, by its own
 * PROGRESS freshness (hasStalledPipeline / hasAdvancingPipeline below), because
 * startedReceipt rewrites ran_at on every visit and would otherwise keep a dead
 * pipeline looking fresh forever. */
function isStalledRunning(receipt: WarmRunReceipt, now: Date): boolean {
  if (!hasRunningNote(receipt)) return false;
  const ranAt = Date.parse(receipt.ran_at);
  return Number.isFinite(ranAt) && now.getTime() - ranAt >= STALE_RUNNING_MS;
}

function hasMorePipelineWork(receipt: WarmRunReceipt): boolean {
  return receipt.pipeline?.version === 1 && receipt.pipeline.nextStage != null;
}

/** The pipeline object carries an extra progress stamp written by on-visit-refresh
 * (kept off the shared store type so this fix stays inside its own files). */
type PipelineWithAdvance = NonNullable<WarmRunReceipt["pipeline"]> & { pipelineAdvancedAt?: string };

/** Epoch ms of the last time this pipeline's completedStages actually GREW. New
 * receipts carry pipelineAdvancedAt, which on-visit-refresh stamps only on real
 * stage growth (updatedAt is unreliable here: autonomous-research bumps it on
 * every checkpoint, including a failing stage that adds nothing). Legacy receipts
 * that predate the field fall back to updatedAt: a genuinely advancing pipeline
 * still has a recent updatedAt, and the very next checkpoint stamps the precise
 * field, so the fallback can never pin a healthy pipeline as stalled for long. */
function pipelineProgressMs(receipt: WarmRunReceipt): number | null {
  const p = receipt.pipeline as PipelineWithAdvance | undefined;
  if (!p) return null;
  const ms = Date.parse(p.pipelineAdvancedAt ?? p.updatedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** A resumable pipeline that still has a next stage AND advanced recently: real
 * background work the next visit resumes. An unparseable stamp is trusted as
 * advancing so a bad timestamp never invents a cut-short state. */
function hasAdvancingPipeline(receipt: WarmRunReceipt, now: Date): boolean {
  if (!hasMorePipelineWork(receipt)) return false;
  const advancedMs = pipelineProgressMs(receipt);
  return advancedMs == null || now.getTime() - advancedMs < STALE_RUNNING_MS;
}

/** A resumable pipeline that has stopped advancing for longer than the stale
 * window: its background pass keeps dying before it can finish a new stage. This
 * is an honest cut-short, not an eternal "Refreshing 0/8" chip. */
function hasStalledPipeline(receipt: WarmRunReceipt, now: Date): boolean {
  if (!hasMorePipelineWork(receipt)) return false;
  const advancedMs = pipelineProgressMs(receipt);
  return advancedMs != null && now.getTime() - advancedMs >= STALE_RUNNING_MS;
}

/** One truthful "the last pass was cut short" test, whether the dead pass was a
 * note-only started receipt or a checkpointed pipeline that stopped advancing.
 * Both render the same honest copy and never coexist with a "refreshing" state. */
function isCutShort(receipt: WarmRunReceipt, now: Date): boolean {
  return hasStalledPipeline(receipt, now) || (isStalledRunning(receipt, now) && !hasMorePipelineWork(receipt));
}

export function autonomousResearchStatusLine(receipt: WarmRunReceipt | null, now: Date = new Date()): string {
  if (!receipt) return "Beacon will research, compare, rank, and prepare your next moves automatically after this visit.";
  // A pass that never wrote its terminal receipt - a dead note-only lambda OR a
  // pipeline that stopped advancing - is not live work. Say so honestly instead
  // of an eternal "preparing in background" or "Refreshing 0/8". This returns
  // before any "will retry safely" summary copy, so the two can never contradict.
  if (isCutShort(receipt, now)) return CUT_SHORT_COPY;
  const live = isRunning(receipt, now) || hasAdvancingPipeline(receipt, now);
  if (live && receipt.summary) {
    const progress = autonomousResearchProgress(receipt);
    return `Your saved results are ready. Beacon is refreshing the evidence${progress ? ` (${progress.completed} of ${progress.total}: ${progress.nextLabel})` : ""} and will replace them only when the newer pass is complete.`;
  }
  if (live) {
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
  // One-count rule (2026-07-20): this "ready to review" tally counts DRAFTS the research pass
  // prepared, which is a DIFFERENT thing from the Changes list's "Ready" execution band (picks
  // prepared into today's plan). Naming both "ready" made "4 moves ready to review" read as
  // queue-Ready while the band said "Ready 0". Say "drafts waiting for your review" so the word
  // "ready" is never overloaded across the two surfaces.
  const outcome = `${s.readyToReview.toLocaleString()} draft${s.readyToReview === 1 ? "" : "s"} waiting for your review`;
  // Vendor-name honesty (2026-07-20): "DataForSEO" is an internal provider name, not a phrase a
  // business owner reads. State the capability plainly instead.
  const dataForSeo =
    s.dataForSeoStatus === "disabled"
      ? " Competitor keyword mining is off right now."
      : s.dataForSeoStatus === "dry_run"
        ? " Competitor keyword mining ran in preview only, so no paid lookups were made."
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
  // A cut-short pass (dead note-only lambda OR a pipeline that stopped advancing)
  // is honestly partial. No progress bar - it is not moving.
  if (isCutShort(receipt, now)) return { label: "Last pass cut short", tone: "partial", title, progress: null };
  const live = isRunning(receipt, now) || hasAdvancingPipeline(receipt, now);
  if (live && receipt.summary) return { label: progress ? `Refreshing · ${progress.completed}/${progress.total}` : "Up to date · refreshing", tone: "ready", title, progress };
  if (live) return { label: progress ? `Preparing · ${progress.completed}/${progress.total}` : "Preparing in background", tone: "running", title, progress };
  if (!receipt.summary && !receipt.ok) return { label: "Preparing in background", tone: "running", title, progress: null };
  if (!receipt.ok) return { label: "Research partially refreshed", tone: "partial", title, progress: null };
  const ready = receipt.summary?.readyToReview ?? 0;
  return {
    // "drafts to review", not "moves ready" - see the one-count note in autonomousResearchStatusLine
    // above: this is a prepared-draft tally, never the Changes list's queue-Ready count.
    label: ready > 0 ? `${ready.toLocaleString()} draft${ready === 1 ? "" : "s"} to review` : "Research up to date",
    tone: "ready",
    title,
    progress: null,
  };
}
