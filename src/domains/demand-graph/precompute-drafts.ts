import "server-only";

import { buildTodayMovesData } from "@/app/(shell)/today-moves-data";
import { buildNewPagesData } from "@/app/(shell)/today-newpages-data";
import { draftAnswerBlockWithLLM, draftFaqSchemaWithLLM } from "@/domains/demand-graph/llm-answer-block";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { seedQuestionsForTopic, type UniverseQuestionRow } from "@/domains/research/question-universe";
import { loadQuestionUniverseForTenant } from "@/domains/research/question-universe-loader";
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
  newPageOpeningsSaved: number;
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
    newPageOpeningsSaved: 0,
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

  // AI-citation Moves OR pages actively LOSING clicks (≥40% drop) — both want a
  // ready, paste-able answer/refresh block. Skip ones that already have one saved.
  const targets = data.moves
    .filter(
      (m) =>
        !m.savedAnswerBlock &&
        (m.actionTone === "citation" || m.declines.some((d) => d.dropPct >= 40)),
    )
    .slice(0, maxMoves);

  const result: PrecomputeResult = { ...base, skipped: false, consideredCitationMoves: targets.length };

  // N30 (2026-07-03): the demand-ranked question universe, read once per run.
  // Empty (not built yet / store missing) leaves every drafter call below
  // byte-identical to before this feature existed (seedQuestionsForTopic
  // returns [] and the merge is skipped) - pinned in question-universe.test.ts.
  let universeRows: UniverseQuestionRow[] = [];
  try {
    universeRows = await loadQuestionUniverseForTenant(tenantId);
  } catch {
    universeRows = [];
  }

  for (const m of targets) {
    // Answer block. For a declining page, seed the brief with the LOST queries so
    // the refreshed answer directly targets what the page is shedding clicks on.
    const decliningQs = m.declines.filter((d) => d.dropPct >= 40).map((d) => d.query);
    const brief =
      decliningQs.length > 0
        ? `This page is losing Google clicks on: ${decliningQs.join(", ")}. ${m.answerBrief ?? ""} Write an updated, comprehensive answer that directly and strongly covers these so the page can recover.`.trim()
        : m.answerBrief;
    const faqsBase = decliningQs.length > 0 ? [...new Set([...m.faqs, ...decliningQs])] : m.faqs;
    // N30 seed: top uncovered universe questions for this Move's topic, additive
    // and deduped against what the Move already carries.
    const universeSeeds = seedQuestionsForTopic(universeRows, `${m.query} ${m.pageLabel}`, {
      existing: faqsBase,
      limit: 4,
    });
    const faqs = universeSeeds.length > 0 ? [...faqsBase, ...universeSeeds] : faqsBase;
    try {
      const r = await draftAnswerBlockWithLLM({
        query: m.query,
        pageLabel: m.pageLabel,
        brief,
        outline: m.outline,
        faqs,
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
    // N30: universe seeds ride along additively; with an empty universe this is
    // the exact same m.faqs reference and gate as before (pinned byte-identical).
    const faqSchemaList = universeSeeds.length > 0 ? [...new Set([...m.faqs, ...universeSeeds])] : m.faqs;
    if (faqSchemaList.length > 0 && !m.savedFaqJsonLd) {
      try {
        const r = await draftFaqSchemaWithLLM({ query: m.query, pageLabel: m.pageLabel, faqs: faqSchemaList });
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

  // New Pages openings — same store (keyed by the opportunity's demandKey), so the
  // create-page wedge cards also open with a ready opener. Capped + idempotent.
  try {
    const np = await buildNewPagesData(tenantId);
    const npTargets = np.opportunities.filter((o) => !o.savedOpening).slice(0, maxMoves);
    for (const o of npTargets) {
      try {
        const r = await draftAnswerBlockWithLLM({
          query: o.topic,
          pageLabel: o.topic,
          brief: `Write the opening paragraph for a NEW encyclopedia/content page about "${o.topic}". Define the topic directly and factually so a reader (and an AI assistant) gets the answer up top.`,
          outline: o.whatWins ? [`Match the depth of cited pages: ${o.whatWins}`] : [],
          // N30: the board already attached the top uncovered universe questions
          // for this topic (universeQuestions); absent (universe empty) this is
          // the exact [] the drafter always received - pinned byte-identical.
          faqs: o.universeQuestions ?? [],
        });
        if (r.status === "ok") {
          result.spendUsd += r.costUsd;
          if (await saveMoveDraft(tenantId, o.id, "answer_block", r.text)) result.newPageOpeningsSaved += 1;
        } else if (r.status === "blocked_budget") {
          break;
        }
      } catch (e) {
        log.warn("[precompute-drafts] new-page opening failed", {
          tenantId,
          opp: o.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  } catch (e) {
    log.warn("[precompute-drafts] new-pages load failed", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  if (result.answerBlocksSaved > 0 || result.faqSchemasSaved > 0 || result.newPageOpeningsSaved > 0) {
    log.info("[precompute-drafts] done", {
      tenantId,
      answerBlocks: result.answerBlocksSaved,
      faqSchemas: result.faqSchemasSaved,
      newPageOpenings: result.newPageOpeningsSaved,
      spendUsd: Number(result.spendUsd.toFixed(4)),
    });
  }
  return result;
}
