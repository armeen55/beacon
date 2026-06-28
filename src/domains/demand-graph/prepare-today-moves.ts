import "server-only";
import { loadChangePacksForTenant } from "./gap-compiler";
import { attachOpinions, type Specialist } from "./specialist-opinions";
import { routeMove, type MoveRouterDecision } from "./move-router";
import {
  buildPreparedMovePack,
  toPersistedPack,
  parsePreparedPack,
  isPackStale,
  type PreparedMovePack,
  type StructuredDraft,
  type PreparedStatus,
} from "./prepared-move-pack";
import { saveMoveDraft, getLatestMoveDrafts } from "./move-draft-store";
import {
  draftAnswerBlockStructured,
  draftAtomicEditStructured,
  draftCreatePageStructured,
  type CompleteFn,
  type StructuredDraftResult,
} from "@/domains/llm/structured-drafter";
import { evaluatePreparedPackQuality } from "@/domains/drafts/draft-quality";
import { ExperimentPlanSchema, type ExperimentPlan, type ImplementationStep } from "@/domains/llm/schemas";
import type { EvidencePacket } from "./evidence-packet";
import { log } from "@/lib/logger";

/**
 * prepare-today-moves (2026-06-25, P5 — "Prepare my top 10") — turn the top
 * existing-page Iranopedia Moves into PreparedMovePacks that arrive
 * "ready_to_review": specialist opinions (P1) + router decision (P2) + a
 * Zod-validated structured draft (P4) + an experiment + a proof plan, persisted
 * via move_drafts (kind=prepared_pack, NO migration).
 *
 * Operator-triggered + capped: one paid LLM draft per Move (gpt-5-mini, ~$0.01),
 * fail-soft per Move (one failure never aborts the batch), and CACHE-FIRST — a
 * non-stale pack that already has a draft is skipped (zero re-spend). NO publish,
 * NO SERP, NO migration. Existing-page Moves only (create_page lives on the New
 * Pages board). Tenant-agnostic.
 */

const ALL_SPECIALISTS: Specialist[] = ["gsc", "ga4", "clarity", "profound", "dataforseo", "wix", "llm", "commerce_asset"];
const MAX_PERSIST_CHARS = 11_500; // under the move_drafts 12k content cap

export type PrepareMoveOutcome = {
  moveId: string;
  label: string;
  targetUrl: string | null;
  gap: string;
  action: string;
  preparedStatus: PreparedStatus;
  draftKind: string | null;
  evidenceRefsCount: number;
  proofPlanPresent: boolean;
  risksCount: number;
  missingEvidence: Specialist[];
  note: string;
};

export type PrepareMovesSummary = {
  considered: number;
  prepared: number;
  readyToReview: number;
  draftReady: number;
  cached: number;
  failed: number;
  llmCostUsd: number;
  outcomes: PrepareMoveOutcome[];
};

/** Deterministic experiment for a Move (no extra LLM cost) — validated against the
 *  schema; null if it somehow can't satisfy the contract. */
function buildExperimentPlan(
  packet: EvidencePacket,
  decision: MoveRouterDecision,
  draftValue: { evidenceRefs?: unknown; operatorSteps?: string[] },
): ExperimentPlan | null {
  const gap = packet.move.gapType;
  const primaryMetric =
    gap === "answer_block"
      ? "profound_citations"
      : gap === "edit_page"
        ? "gsc_ctr"
        : gap === "create_page"
          ? "gsc_impressions"
          : "clarity_friction";
  const expectedDirection = gap === "fix_experience" ? "down" : "up";
  const candidate = {
    hypothesis: decision.rationale.slice(0, 300) || `Shipping this ${gap} move improves ${primaryMetric}.`,
    primaryMetric,
    expectedDirection,
    windowsDays: packet.proofPlan.windowsDays,
    controlDescription: packet.proofPlan.controls.slice(0, 300),
    evidenceRefs: Array.isArray(draftValue.evidenceRefs) ? draftValue.evidenceRefs : [],
    confidence: decision.confidenceLevel,
    operatorSteps: (draftValue.operatorSteps ?? ["Ship the prepared change and record it for proof."]).slice(0, 12),
  };
  const res = ExperimentPlanSchema.safeParse(candidate);
  return res.success ? res.data : null;
}

function evidenceHintsFor(packet: EvidencePacket): string[] {
  return [
    packet.competitor.domain && !packet.competitor.looselyMatched ? `AI cites ${packet.competitor.domain} for this topic, not you` : "",
    packet.yourPage.gsc ? "the page already ranks on Google but isn't the cited source" : "",
    packet.competitor.facts ? "a competitor teardown is available for what wins this topic" : "",
  ].filter(Boolean);
}

async function draftForPacket(
  packet: EvidencePacket,
  opts: { complete?: CompleteFn },
): Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>> {
  const evidenceHints = evidenceHintsFor(packet);
  const common = { query: packet.move.label, pageLabel: packet.yourPage.url ?? packet.move.label, outline: packet.draft.outline, evidenceHints };
  if (packet.move.gapType === "answer_block") {
    return draftAnswerBlockStructured(
      { ...common, brief: packet.draft.answerBlockBrief, faqs: packet.draft.faqQuestions.length ? packet.draft.faqQuestions : packet.demand.fanoutSeeds },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  if (packet.move.gapType === "edit_page") {
    return draftAtomicEditStructured(
      { ...common, field: "title", currentValue: packet.yourPage.facts?.title ?? null },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  if (packet.move.gapType === "create_page") {
    return draftCreatePageStructured(
      {
        query: packet.move.label,
        pageLabel: packet.yourPage.url ?? packet.move.label,
        competitorPages: [packet.competitor.topUrl, ...(packet.competitor.otherUrls ?? [])].filter((u): u is string => !!u),
        fanoutQueries: packet.demand.fanoutSeeds ?? [],
        evidenceHints,
      },
      opts,
    ) as Promise<StructuredDraftResult<{ evidenceRefs: unknown[]; operatorSteps: string[]; risks: string[] }>>;
  }
  // fix_experience has no structured drafter wired in Sprint 2 (CRO is later) —
  // the pack still gets opinions + router + proof, just no draft.
  return { status: "off" };
}

function outcomeOf(pack: PreparedMovePack, packet: EvidencePacket, opinions: ReturnType<typeof attachOpinions>, note: string): PrepareMoveOutcome {
  const present = new Set(opinions.map((o) => o.specialist));
  const draftVal = (pack.structuredDraft as { value?: { evidenceRefs?: unknown[]; risks?: unknown[] } } | null)?.value;
  return {
    moveId: pack.moveId,
    label: packet.move.label,
    targetUrl: pack.targetUrl,
    gap: pack.moveType,
    action: pack.routerDecision.action,
    preparedStatus: pack.preparedStatus,
    draftKind: (pack.structuredDraft as { kind?: string } | null)?.kind ?? null,
    evidenceRefsCount: Array.isArray(draftVal?.evidenceRefs) ? draftVal!.evidenceRefs!.length : 0,
    proofPlanPresent: (pack.proofPlan?.metrics?.length ?? 0) > 0,
    risksCount: Array.isArray(draftVal?.risks) ? draftVal!.risks!.length : 0,
    missingEvidence: ALL_SPECIALISTS.filter((s) => !present.has(s)),
    note,
  };
}

export async function prepareTodayMovesForTenant(
  tenantId: string,
  opts: { maxN?: number; now?: () => Date; complete?: CompleteFn } = {},
): Promise<PrepareMovesSummary> {
  const max = opts.maxN ?? 10;
  const nowIso = (opts.now ?? (() => new Date()))().toISOString();
  const summary: PrepareMovesSummary = {
    considered: 0,
    prepared: 0,
    readyToReview: 0,
    draftReady: 0,
    cached: 0,
    failed: 0,
    llmCostUsd: 0,
    outcomes: [],
  };

  const { packets } = await loadChangePacksForTenant(tenantId, { limit: Math.max(max, 25) }).catch(() => ({ packets: [] as EvidencePacket[] }));
  const targets = packets
    .filter(
      (p) =>
        p.move.gapType === "answer_block" ||
        p.move.gapType === "edit_page" ||
        p.move.gapType === "fix_experience" ||
        p.move.gapType === "create_page",
    )
    .sort((a, b) => b.move.score - a.move.score)
    .slice(0, max);
  summary.considered = targets.length;

  const saved = await getLatestMoveDrafts(tenantId).catch(() => new Map());

  for (const packet of targets) {
    const moveId = packet.move.key;
    try {
      const opinions = attachOpinions(packet, { nowIso });
      const decision = routeMove({ packet, opinions });

      // Cache-first: serve a non-stale persisted pack that already has a draft —
      // UNLESS that cached draft fails the quality gate (generic / too-thin / off-topic
      // / meta non-answer). A quality-rejected draft is treated like a stale one and
      // re-drafted with the hardened prompt, so "Prepare" upgrades bad output in place.
      const existing = parsePreparedPack(saved.get(`${moveId}::prepared_pack`)?.content);
      if (existing && existing.structuredDraft && !isPackStale(existing, packet.evidenceHash, nowIso)) {
        const q = evaluatePreparedPackQuality({
          structuredDraft: existing.structuredDraft as { kind?: string; value?: unknown },
          preparedStatus: existing.preparedStatus,
          moveType: existing.moveType,
        });
        if (q.copyAllowed) {
          summary.cached += 1;
          if (existing.preparedStatus === "ready_to_review") summary.readyToReview += 1;
          else if (existing.preparedStatus === "draft_ready") summary.draftReady += 1;
          summary.outcomes.push(outcomeOf(existing, packet, opinions, "cached (unchanged)"));
          continue;
        }
        // else fall through → regenerate this low-quality cached draft.
      }

      const draftRes = await draftForPacket(packet, { complete: opts.complete });
      let structuredDraft: StructuredDraft = null;
      let experiment: ExperimentPlan | null = null;
      let checklist: ImplementationStep[] = [];
      let llmCost = 0;
      let note = "";
      if (draftRes.status === "drafted") {
        structuredDraft = { kind: draftRes.kind, value: draftRes.value };
        llmCost = draftRes.costUsd;
        checklist = (draftRes.value.operatorSteps ?? []).slice(0, 12).map((step) => ({ step, pushMethod: "manual" as const, done: false }));
        experiment = buildExperimentPlan(packet, decision, draftRes.value);
        note = draftRes.retried ? "drafted (retried)" : "drafted";
      } else {
        llmCost = draftRes.status === "validation_failed" ? draftRes.costUsd : 0;
        note = draftRes.status === "off" ? "draft skipped (LLM off / no drafter)" : draftRes.status === "blocked_budget" ? "draft skipped (budget cap)" : `draft failed: ${(draftRes as { reason?: string }).reason ?? "invalid"}`;
      }
      summary.llmCostUsd += llmCost;

      const pack = buildPreparedMovePack({
        tenantId,
        packet,
        opinions,
        decision,
        nowIso,
        structuredDraft,
        experiment,
        implementationChecklist: checklist,
        costSpent: { llmUsd: llmCost, serpUsd: 0 },
      });

      const serialized = toPersistedPack(pack);
      if (serialized.length <= MAX_PERSIST_CHARS) {
        await saveMoveDraft(tenantId, moveId, "prepared_pack", serialized).catch(() => false);
      } else {
        log.warn("[prepare-today-moves] pack too large to persist", { tenantId, moveId, size: serialized.length });
        note += " (not persisted: too large)";
      }

      summary.prepared += 1;
      if (pack.preparedStatus === "ready_to_review") summary.readyToReview += 1;
      else if (pack.preparedStatus === "draft_ready") summary.draftReady += 1;
      if (draftRes.status !== "drafted") summary.failed += 1;
      summary.outcomes.push(outcomeOf(pack, packet, opinions, note));
    } catch (e) {
      summary.failed += 1;
      summary.outcomes.push({
        moveId,
        label: packet.move.label,
        targetUrl: packet.yourPage.url,
        gap: packet.move.gapType,
        action: "wait",
        preparedStatus: "failed",
        draftKind: null,
        evidenceRefsCount: 0,
        proofPlanPresent: false,
        risksCount: 0,
        missingEvidence: ALL_SPECIALISTS,
        note: `threw: ${e instanceof Error ? e.message.slice(0, 80) : "error"}`,
      });
    }
  }

  return summary;
}
