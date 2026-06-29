"use server";

import { revalidatePath } from "next/cache";
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
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { autoMeasureDuePass, type AutoMeasurePassResult } from "@/domains/proof-gsc/auto-measure-pass";

export type SharpenMovesResult =
  | { status: "off" }
  | { status: "ok"; audited: number; targets: number; cached: number };

export type PrepareTopMovesResult =
  | { ok: false; reason: string }
  | { ok: true; summary: PrepareMovesSummary };

/**
 * prepareTopMovesAction (2026-06-25, P5) — "Prepare my top 10". One click runs the
 * full prepare pipeline (specialist opinions → router → structured draft →
 * experiment → proof plan → PreparedMovePack) for the tenant's top existing-page
 * Moves and persists each pack, so the cockpit arrives "ready to review" instead
 * of chore-ready. Operator-gated, fires only on explicit click (never on render),
 * cache-first + capped (one budgeted LLM draft per Move; re-runs are cheap). NO
 * publish, NO SERP, NO migration. Revalidates "/" so the hero re-renders prepared.
 */
export async function prepareTopMovesAction(opts: { maxN?: number } = {}): Promise<PrepareTopMovesResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const summary = await prepareTodayMovesForTenant(await currentTenantId(), { maxN: opts.maxN ?? 10 });
    revalidatePath("/");
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 120) : "prepare failed" };
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
  revalidatePath("/");
  revalidatePath("/competitors");
  revalidatePath("/worklist");
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
    revalidatePath("/");
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
 * "/proof" so settled outcomes + the learned re-ranking show. Operator-gated.
 */
export async function measureAppliedMovesAction(opts: { maxRecords?: number } = {}): Promise<MeasureNowResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  try {
    const result = await autoMeasureDuePass(await currentTenantId(), { maxRecords: opts.maxRecords ?? 15 });
    revalidatePath("/");
    revalidatePath("/proof");
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
