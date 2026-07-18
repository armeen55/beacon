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
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { autoMeasureDuePass, type AutoMeasurePassResult } from "@/domains/proof-gsc/auto-measure-pass";
import { harvestWinners } from "@/domains/llm/winner-memory";
import { buildTeamScoreboardSummary } from "@/domains/team-scoreboard/compute-scoreboard";

export type SharpenMovesResult =
  | { status: "off" }
  | { status: "ok"; audited: number; targets: number; cached: number };

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
