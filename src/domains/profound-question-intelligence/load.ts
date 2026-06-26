/**
 * Profound Question Intelligence — loader (2026-06-26, I/O).
 *
 * On-demand (react.cache) pull of the tenant's Iranopedia-topic answers +
 * query-fanouts, scoped to the topic, run through the pure PromptOpportunity
 * builder. NO storage needed for the read surface — this is a live read (the
 * nightly sync + durable tables are a separate slice). Fail-soft everywhere:
 * any API miss → fewer/zero opportunities, never a throw.
 *
 * Borrowed-account safe: only the topic's prompts/answers/fanouts are pulled;
 * Agent Analytics (bots/referrals/domains) is NEVER called here; ownership is
 * decided by iranopedia.com, never the tracked ChatGPT asset.
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { pullProfoundAnswers, queryProfoundReport } from "@/lib/connectors/profound/client";
import {
  getProfoundTenantScope,
  profoundTopicFilter,
  isProfoundNoisePrompt,
} from "@/lib/connectors/profound/tenant-scope";
import {
  buildPromptOpportunities,
  type PromptOpportunity,
  type FanoutRow,
} from "./prompt-opportunity";

const WINDOW_DAYS = 30;
const ANSWER_CAP = 3000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type ProfoundPromptIntelligence = {
  /** False when the tenant has no Profound prompt-intelligence scope. */
  scopeFound: boolean;
  topicLabel: string | null;
  totalPrompts: number;
  /** Prompts that are an opportunity (answer_block / create_page / source_gap). */
  gapPrompts: number;
  /** Prompts where you're already mentioned or cited. */
  ownPresentPrompts: number;
  opportunities: PromptOpportunity[];
  /** Diagnostics: raw rows pulled. */
  answerRows: number;
  fanoutRows: number;
};

const EMPTY: ProfoundPromptIntelligence = {
  scopeFound: false,
  topicLabel: null,
  totalPrompts: 0,
  gapPrompts: 0,
  ownPresentPrompts: 0,
  opportunities: [],
  answerRows: 0,
  fanoutRows: 0,
};

async function loadUncached(tenantId: string): Promise<ProfoundPromptIntelligence> {
  const scope = getProfoundTenantScope(tenantId);
  if (!scope) return EMPTY;

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);
  const filters = profoundTopicFilter(scope);

  // Answers — the per-prompt gold (mentions + cited URLs + themes).
  let answers: Awaited<ReturnType<typeof pullProfoundAnswers>> = null;
  try {
    answers = await pullProfoundAnswers(
      { tenantId, categoryId: scope.categoryId, startDate, endDate, filters, maxRows: ANSWER_CAP },
    );
  } catch (e) {
    log.warn("[profound-qi] answers pull failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  const answerRowsArr = answers?.rows ?? [];

  // Query-fanouts. IMPORTANT: Profound canonicalizes dimension order to
  // [date, model, prompt, query] regardless of request order, and the decoder
  // maps POSITIONALLY against the requested order — so request that exact order.
  let fanouts: FanoutRow[] = [];
  try {
    const fanRes = await queryProfoundReport({
      tenantId,
      report: "query-fanouts",
      categoryId: scope.categoryId,
      startDate,
      endDate,
      dimensions: ["date", "model", "prompt", "query"],
      metrics: ["total_fanouts", "share"],
      filters,
    });
    fanouts = (fanRes?.rows ?? []).map((r) => ({
      prompt: r.dims.prompt ?? "",
      query: r.dims.query ?? "",
      model: r.dims.model ?? null,
    }));
  } catch (e) {
    log.warn("[profound-qi] fanouts pull failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  const opportunities = buildPromptOpportunities({
    answers: answerRowsArr,
    fanouts,
    ownedDomain: scope.ownedDomain,
    ownedMentionAliases: scope.ownedMentionAliases,
    isNoisePrompt: isProfoundNoisePrompt,
  });

  return {
    scopeFound: true,
    topicLabel: scope.topicLabel,
    totalPrompts: opportunities.length,
    gapPrompts: opportunities.filter((o) => o.recommendedMove !== "expand_page").length,
    ownPresentPrompts: opportunities.filter((o) => o.ownCitationCount > 0 || o.ownMentionCount > 0).length,
    opportunities,
    answerRows: answerRowsArr.length,
    fanoutRows: fanouts.length,
  };
}

/** Request-memoized loader (one live pull per render). */
export const loadProfoundPromptIntelligence = cache(loadUncached);
