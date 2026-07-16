"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { log } from "@/lib/logger";
import { invalidateWorklistSurface } from "./worklist-surface-store";
import { invalidateChangesSurface } from "./changes-surface-store";
import { invalidateDemandGraph } from "@/domains/demand-graph/graph-snapshot-store";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import {
  draftAnswerBlockWithLLM,
  draftFaqSchemaWithLLM,
  type AnswerBlockDraftInput,
  type AnswerBlockDraftResult,
  type FaqDraftInput,
  type FaqDraftResult,
} from "@/domains/demand-graph/llm-answer-block";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { auditTopCompetitorsForTenant } from "@/domains/demand-graph/competitor-page-audit";
import { prepareTodayMovesForTenant, type PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";
export type { PrepareMovesSummary } from "@/domains/demand-graph/prepare-today-moves";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { autoMeasureDuePass, type AutoMeasurePassResult } from "@/domains/proof-gsc/auto-measure-pass";
import { harvestWinners } from "@/domains/llm/winner-memory";
import { buildTeamScoreboardSummary } from "@/domains/team-scoreboard/compute-scoreboard";
import { readChangesSurface } from "./changes-surface-store";

export type SharpenMovesResult =
  | { status: "off" }
  | { status: "ok"; audited: number; targets: number; cached: number };

export type PrepareTopMovesResult =
  | { ok: false; reason: string }
  | { ok: true; summary: PrepareMovesSummary };

async function rankedEntriesForPreparation(tenantId: string) {
  return (await readChangesSurface(tenantId).catch(() => null))
    ?.view.rankedPreparationEntries ?? [];
}

/**
 * prepareTopMovesAction (2026-06-25, P5) — "Prepare my top 10". One click runs the
 * full prepare pipeline (specialist opinions → router → structured draft →
 * experiment → proof plan → PreparedMovePack) for the tenant's top existing-page
 * Moves and persists each pack, so the cockpit arrives "ready to review" instead
 * of chore-ready. Operator-gated, fires only on explicit click (never on render),
 * cache-first + capped (one budgeted LLM draft per Move; re-runs are cheap). NO
 * publish, NO migration. RANK-3: it now also runs a LIVE Google-results
 * winnability check per existing-page Move (cache-first, behind runSerpQuery's
 * full money gauntlet, so it makes NO paid call when SERP is unconfigured or
 * dry-run); an effectively-unwinnable Move is held at "serp_checked" with an
 * honest line instead of a confident "ready" draft. Revalidates "/" so the hero
 * re-renders prepared.
 */
export async function prepareTopMovesAction(opts: { maxN?: number } = {}): Promise<PrepareTopMovesResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const summary = await prepareTodayMovesForTenant(tenantId, {
      maxN: opts.maxN ?? 10,
      rankedEntries: await rankedEntriesForPreparation(tenantId),
    });
    await invalidateWorklistSurface().catch(() => {}); // prepared state changed → recompute next /changes load
    await invalidateChangesSurface().catch(() => {}); // ...and the ranked /changes snapshot
    revalidatePath("/");
    revalidatePath("/changes");
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "prepare failed" };
  }
}

export type AutoAdvancePrepareResult =
  | { ok: false; reason: string }
  | { ok: true; scheduled: boolean };

/**
 * R20 (D6 dynamic auto-mode) - auto-advance prepare. When the operator ships a change in the
 * session flow, keep five quality-ready opportunities available. The maintenance
 * lane reranks after the action, prepares only missing capacity from cached evidence,
 * and atomically republishes Today + Changes. It remains bounded, fail-soft, and
 * never publishes a site edit.
 */
export async function autoAdvancePrepareAction(): Promise<AutoAdvancePrepareResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  let tenantId: string;
  try {
    tenantId = await currentTenantId();
  } catch {
    return { ok: false, reason: "No tenant context." };
  }
  try {
    after(async () => {
      try {
        const { replenishReadyQueueForTenant } = await import("@/domains/ops/ready-queue-replenishment");
        const result = await replenishReadyQueueForTenant(tenantId);
        revalidatePath("/");
        revalidatePath("/changes");
        log.info("[auto-advance-prepare] maintained ready queue", { tenantId, ...result });
      } catch (e) {
        log.warn("[auto-advance-prepare] pass failed (non-blocking)", {
          tenantId,
          error: e instanceof Error ? e.message.slice(0, 200) : String(e),
        });
      }
    });
    return { ok: true, scheduled: true };
  } catch {
    // after() is only valid inside a request scope - never fail the operator's action on it.
    return { ok: true, scheduled: false };
  }
}

export type EnrichResearchResult =
  | { status: "off" }
  | { status: "error"; reason: string }
  | { status: "ok"; result: import("@/domains/serp/research-enrichment-producer").EnrichmentRunResult };

/**
 * enrichTopResearchPacksAction (2026-06-29) — the operator-triggered DataForSEO PRODUCER
 * for the top-N PageResearchPack cards. DRY-RUN DEFAULT: reports the plan + exact spend
 * estimate and makes ZERO paid calls. Live (only when DATAFORSEO_DRY_RUN=false) fetches
 * the MISSING keyword volume + SERP winner-title/format patterns through the shared
 * capped + 14d-cached + ledgered gauntlet and caches them for the research module to read.
 * NEVER runs on the render path. NO Wix, NO proof mutation, NO env flip by me.
 */
export async function enrichTopResearchPacksAction(opts: { topN?: number } = {}): Promise<EnrichResearchResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const topN = opts.topN ?? 5;
  try {
    const { buildTodayMovesData } = await import("./today-moves-data");
    const { enrichResearchPacks } = await import("@/domains/serp/research-enrichment-producer");
    const data = await buildTodayMovesData(await currentTenantId(), { limit: topN });
    const packs = data.moves
      .filter((m) => m.researchPack)
      .slice(0, topN)
      .map((m) => ({
        url: m.targetUrl,
        primaryIntent: m.researchPack!.primaryIntent,
        own: m.researchPack!.own,
        sibling: m.researchPack!.sibling,
      }));
    const result = await enrichResearchPacks(packs);
    if (result.mode === "live" && result.patternsWritten > 0) {
      await invalidateWorklistSurface().catch(() => {}); // new SERP patterns → cards change → recompute
      await invalidateChangesSurface().catch(() => {});
      revalidatePath("/changes");
    }
    return { status: "ok", result };
  } catch (e) {
    return { status: "error", reason: e instanceof Error ? e.message.slice(0, 140) : "enrich failed" };
  }
}

/**
 * sharpenMovesWithTeardownAction (2026-06-25) — bring the core "reverse-engineer
 * the winner" IP into the cockpit. Runs the deterministic competitor teardown
 * (polite-fetch + extract: title/headings/schema/FAQ/answer-blocks/word-count)
 * for the tenant's top Moves, so cards gain their "what wins" + grounded gaps
 * instead of a bare "add an answer block". Previously only reachable via the
 * operator-gated /diagnostics/rank-revenue ?refresh=1 stopgap; crons are off, so
 * this is the on-demand path that matches the golden-path model.
 *
 * Operator-gated, fires only on an explicit click (never on render), read-only
 * against competitors (no Wix, no mutations to the tenant's site), and caches by
 * URL so a second click is cheap. Revalidates "/" so the hero re-renders enriched.
 */
export async function sharpenMovesWithTeardownAction(
  opts: { limit?: number } = {},
): Promise<SharpenMovesResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const tenantId = await currentTenantId();
  const { audited, targets, cached } = await auditTopCompetitorsForTenant({
    tenantId,
    limit: opts.limit ?? 12,
  });
  await invalidateWorklistSurface().catch(() => {}); // fresh teardown → "what wins" changes → recompute
  await invalidateChangesSurface().catch(() => {});
  revalidatePath("/");
  revalidatePath("/prompts");
  revalidatePath("/changes");
  return { status: "ok", audited: audited.length, targets, cached };
}

export type RegenerateFromTeardownResult =
  | { ok: false; reason: string }
  | { ok: true; summary: PrepareMovesSummary };

/**
 * regenerateTopDraftsFromTeardownAction (2026-06-28) — bounded "improve the top drafts
 * using the pages that currently win." Re-runs the structured drafter for the top
 * teardown-backed Moves with the competitor's real facts (title/sections/schema/word
 * count/FAQ) threaded into the prompt as "beat it, don't copy it." HARD per-run $ cap
 * (default $0.10, top 3); every regenerated draft must pass the existing quality gate
 * (a failure surfaces "Needs review", never a fake "ready"). The prior draft stays
 * recoverable (move_drafts is insert-only) + its quality/excerpt is captured in the
 * pack's regenMeta. Operator-gated, on-demand only, cache-bypassing. NO publish, NO
 * Wix, NO migration. Revalidates "/" + worklist + drafts so the chips render.
 */
export async function regenerateTopDraftsFromTeardownAction(
  opts: { limit?: number; maxUsd?: number } = {},
): Promise<RegenerateFromTeardownResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const summary = await prepareTodayMovesForTenant(tenantId, {
      maxN: Math.min(opts.limit ?? 3, 5),
      maxUsd: Math.min(opts.maxUsd ?? 0.1, 0.1),
      forceRegenerate: true,
      requireTeardown: true,
      rankedEntries: await rankedEntriesForPreparation(tenantId),
    });
    await invalidateWorklistSurface().catch(() => {}); // regenerated drafts → readiness changes → recompute
    await invalidateChangesSurface().catch(() => {});
    revalidatePath("/");
    revalidatePath("/changes");
    revalidatePath("/drafts");
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "regeneration failed" };
  }
}

export type PrepareTonightsPlanResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      prepared: number;
      readyToReview: number;
      improved: number;
      competitorPagesAnalyzed: number;
      competitorPagesRefreshed: number;
      enrichedPatterns: number;
      llmCostUsd: number;
      failed: number;
    };

/**
 * prepareTonightsPlanAction (UX3, 2026-07-02) — the ONE command that replaces the
 * Improve-top-3 / Enrich-research / Prepare-top-10 button cluster on /changes. Runs the
 * existing research + preparation pipelines, in the order that makes each one sharper for the
 * next: reverse-engineer the top competitor pages → enrich keyword/SERP research packs
 * (DataForSEO, dry-run unless already configured live) → prepare the top 10 Moves end to end →
 * improve the top 3 teardown-backed drafts with competitor facts.
 * Each step is independently capped/cached exactly as it is today; a failure in one step
 * never blocks the others (fail-soft per step, honest partial summary). The granular
 * buttons remain available in the overflow menu for an operator who wants just one step.
 */
export async function prepareTonightsPlanAction(): Promise<PrepareTonightsPlanResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  let competitorPagesAnalyzed = 0;
  let competitorPagesRefreshed = 0;
  try {
    const teardown = await sharpenMovesWithTeardownAction({ limit: 12 });
    if (teardown.status === "ok") {
      competitorPagesAnalyzed = teardown.audited;
      competitorPagesRefreshed = Math.max(0, teardown.audited - teardown.cached);
    }
  } catch {
    // Fail-soft: cached teardown evidence may still exist, and preparation remains useful.
  }
  let enrichedPatterns = 0;
  try {
    const enrich = await enrichTopResearchPacksAction({ topN: 5 });
    if (enrich.status === "ok" && enrich.result.mode === "live") enrichedPatterns = enrich.result.patternsWritten;
  } catch {
    // fail-soft: research enrichment is a nice-to-have ahead of drafting, never a blocker
  }
  const prepare = await prepareTopMovesAction({ maxN: 10 });
  if (!prepare.ok) return { ok: false, reason: prepare.reason };
  let improved = 0;
  let regenCostUsd = 0;
  try {
    const regen = await regenerateTopDraftsFromTeardownAction({ limit: 3, maxUsd: 0.1 });
    if (regen.ok) {
      improved = regen.summary.regenerated ?? 0;
      regenCostUsd = regen.summary.llmCostUsd ?? 0;
    }
  } catch {
    // fail-soft: the base prepare pass already produced a reviewable plan without this
  }
  return {
    ok: true,
    prepared: prepare.summary.prepared,
    readyToReview: prepare.summary.readyToReview,
    improved,
    competitorPagesAnalyzed,
    competitorPagesRefreshed,
    enrichedPatterns,
    llmCostUsd: prepare.summary.llmCostUsd + regenCostUsd,
    failed: prepare.summary.failed,
  };
}

export type MarkAppliedResult =
  | { ok: false; reason: string }
  | { ok: true; recorded: boolean; reason: string };

/**
 * markMoveAppliedAction (2026-06-25, Sprint 3) — the operator marks a prepared Move
 * as APPLIED (they made the change, possibly outside Beacon). Captures the GSC
 * baseline + starts the measurement clock by recording a proof-ledger entry
 * (reusing the ship→proof bridge with verifiedLive=true). Does NOT publish or
 * touch any CMS — it only records that the operator says the change is live, so
 * Beacon can measure it. Operator-gated; idempotent (path+Pacific-date); fail-soft.
 * Revalidates "/" so the card flips to "measuring".
 */
export async function markMoveAppliedAction(args: {
  pageUrl: string;
  actionType?: string | null;
  query?: string | null;
}): Promise<MarkAppliedResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const res = await autoRecordShippedChangeForRec({
      tenantId: await currentTenantId(),
      pageUrl: args.pageUrl,
      actionType: args.actionType ?? null,
      targetQuery: args.query ?? null,
      verifiedLive: true,
      notes: "Operator marked applied",
    });
    // A new shipped change is a GRAPH input (the page enters measurement →
    // applyProofOutcomeCautionToMoves holds/demotes it) → invalidate the graph (clears
    // the derived worklist surface too).
    await invalidateDemandGraph("change shipped → page enters measurement").catch(() => {});
    await invalidateChangesSurface().catch(() => {}); // measuring count on /changes changed
    revalidatePath("/");
    revalidatePath("/changes");
    return { ok: true, recorded: res.recorded, reason: res.reason };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "mark-applied failed" };
  }
}

export type MeasureNowResult =
  | { ok: false; reason: string }
  | { ok: true; result: AutoMeasurePassResult };

/**
 * measureAppliedMovesAction (2026-06-25, Sprint 3) — operator-triggered re-measure
 * of all applied Moves due for a fresh reading (GSC/GA4 already-synced data only;
 * NO paid calls). Cache-first, bounded, fail-soft per record. Revalidates "/" +
 * "/results" so settled outcomes + the learned re-ranking show. Operator-gated.
 */
export async function measureAppliedMovesAction(opts: { maxRecords?: number } = {}): Promise<MeasureNowResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const tenantId = await currentTenantId();
    const result = await autoMeasureDuePass(tenantId, { maxRecords: opts.maxRecords ?? 15 });
    // Settled proof outcomes change the graph's learning priors + page cautions
    // (applyExperimentPriorToMoves / applyProofOutcomeCautionToMoves) → invalidate the
    // graph (clears the derived worklist surface too).
    await invalidateDemandGraph("proof settled → outcome priors changed").catch(() => {});
    // BEACON_500 item 30: a fresh "won" verdict from this pass should be available to the
    // drafter's few-shot injection on the very next draft. Isolated + fail-soft - a harvest
    // error must never surface as a measure-pass failure.
    if (result.settled > 0) {
      await harvestWinners(tenantId).catch(() => {});
      // BEACON_500 item 38: equally isolated - full-recompute the specialist scoreboard so a
      // fresh won/lost verdict updates each teammate's Brier score on the next Today render.
      await buildTeamScoreboardSummary(tenantId).catch(() => {});
    }
    await invalidateChangesSurface().catch(() => {}); // settled verdicts → decided/measuring counts changed
    revalidatePath("/");
    revalidatePath("/changes");
    revalidatePath("/results");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "measure failed" };
  }
}

/**
 * draftMoveAnswerBlockAction (2026-06-24) — on-demand LLM answer-block draft for a
 * Today's Moves card. Operator-gated; the underlying drafter is OFF unless
 * BEACON_LLM_PROVIDER=openai, budget-gated, and safety-firewalled (see
 * llm-answer-block.ts). Fires only on an explicit click — never on render — so it
 * costs nothing until the operator asks for it.
 */
export async function draftMoveAnswerBlockAction(
  input: AnswerBlockDraftInput & { recId?: string },
): Promise<AnswerBlockDraftResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const result = await draftAnswerBlockWithLLM(input);
  if (result.status === "ok" && input.recId) {
    try {
      await saveMoveDraft(await currentTenantId(), input.recId, "answer_block", result.text);
    } catch {
      /* persistence is best-effort — never fail the draft on a store hiccup */
    }
  }
  return result;
}

/** On-demand FAQPage JSON-LD draft (LLM answers the grounded fanout questions →
 *  valid schema). Same gating/budget/firewall as the answer-block drafter.
 *  Persists the result (best-effort) so it survives reload. */
export async function draftMoveFaqAction(
  input: FaqDraftInput & { recId?: string },
): Promise<FaqDraftResult> {
  if (!(await isOperatorModeServer())) return { status: "off" };
  const result = await draftFaqSchemaWithLLM(input);
  if (result.status === "ok" && input.recId) {
    try {
      await saveMoveDraft(await currentTenantId(), input.recId, "faq", result.jsonLd);
    } catch {
      /* best-effort */
    }
  }
  return result;
}
