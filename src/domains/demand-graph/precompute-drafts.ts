import "server-only";

import { buildTodayMovesData } from "@/app/(shell)/today-moves-data";
import { draftAnswerBlockWithLLM, draftFaqSchemaWithLLM } from "@/domains/demand-graph/llm-answer-block";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { log } from "@/lib/logger";

/**
 * precompute-drafts (2026-06-25) — the plan's §6 "make it feel instant" step:
 * pre-generate + persist the AI answer-block (+ FAQ schema) for a tenant's top
 * AI-citation Moves so the cockpit opens with READY drafts instead of buttons.
 *
 * Safe by construction:
 *  - The drafters are OFF unless BEACON_LLM_PROVIDER=openai (no key → no-op).
 *  - Every call is checkBudget/recordSpend gated (the shared $10/mo fail-closed
 *    cap) + numeric-fidelity firewalled. This loop adds NO new spend path — it
 *    just front-runs the same on-demand calls the operator would click.
 *  - Hard per-run cap (maxMoves) so a tenant with a huge queue can't blow the
 *    nightly budget; only Moves WITHOUT a saved draft are (re)generated, so a
 *    second nightly run is ~free (everything already cached).
 *  - Fully fail-soft: any error is logged + skipped; never throws to the cron.
 */
export type PrecomputeResult = {
  tenantId: string;
  consideredCitationMoves: number;
  answerBlocksSaved: number;
  faqSchemasSaved: number;
  spendUsd: number;
  skipped: boolean; // true when LLM drafting is off (nothing attempted)
};

function llmOn(): boolean {
  return (
    (process.env.BEACON_LLM_PROVIDER ?? "").trim().toLowerCase() === "openai" &&
    Boolean(process.env.OPENAI_API_KEY)
  );
}

export async function precomputeMoveDraftsForTenant(
  tenantId: string,
  opts: { maxMoves?: number } = {},
): Promise<PrecomputeResult> {
  const base: PrecomputeResult = {
    tenantId,
    consideredCitationMoves: 0,
    answerBlocksSaved: 0,
    faqSchemasSaved: 0,
    spendUsd: 0,
    skipped: true,
  };
  if (!llmOn()) return base; // drafting off → no-op (the cockpit still drafts on demand)

  const maxMoves = Math.max(1, Math.min(opts.maxMoves ?? 8, 25));
  let data;
  try {
    data = await buildTodayMovesData(tenantId, { limit: 60 });
  } catch (e) {
    log.warn("[precompute-drafts] load failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return base;
  }

  // Only AI-citation Moves that don't already have a saved answer block.
  const targets = data.moves
    .filter((m) => m.actionTone === "citation" && !m.savedAnswerBlock)
    .slice(0, maxMoves);

  const result: PrecomputeResult = { ...base, skipped: false, consideredCitationMoves: targets.length };

  for (const m of targets) {
    // Answer block.
    try {
      const r = await draftAnswerBlockWithLLM({
        query: m.query,
        pageLabel: m.pageLabel,
        brief: m.answerBrief,
        outline: m.outline,
        faqs: m.faqs,
      });
      if (r.status === "ok") {
        result.spendUsd += r.costUsd;
        if (await saveMoveDraft(tenantId, m.id, "answer_block", r.text)) result.answerBlocksSaved += 1;
      } else if (r.status === "blocked_budget") {
        log.info("[precompute-drafts] budget reached — stopping", { tenantId });
        break; // cap hit; stop the whole run (further calls would also block)
      }
    } catch (e) {
      log.warn("[precompute-drafts] answer-block failed", {
        tenantId,
        move: m.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // FAQ schema (only when the Move carries fanout questions + none saved yet).
    if (m.faqs.length > 0 && !m.savedFaqJsonLd) {
      try {
        const r = await draftFaqSchemaWithLLM({ query: m.query, pageLabel: m.pageLabel, faqs: m.faqs });
        if (r.status === "ok") {
          result.spendUsd += r.costUsd;
          if (await saveMoveDraft(tenantId, m.id, "faq", r.jsonLd)) result.faqSchemasSaved += 1;
        } else if (r.status === "blocked_budget") {
          log.info("[precompute-drafts] budget reached (faq) — stopping", { tenantId });
          break;
        }
      } catch (e) {
        log.warn("[precompute-drafts] faq failed", {
          tenantId,
          move: m.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  if (result.answerBlocksSaved > 0 || result.faqSchemasSaved > 0) {
    log.info("[precompute-drafts] done", {
      tenantId,
      answerBlocks: result.answerBlocksSaved,
      faqSchemas: result.faqSchemasSaved,
      spendUsd: Number(result.spendUsd.toFixed(4)),
    });
  }
  return result;
}
