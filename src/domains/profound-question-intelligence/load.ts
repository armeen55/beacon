/**
 * Profound Question Intelligence — loader (2026-06-26; cached-only 2026-07-20).
 *
 * Reads the tenant's AI-answer prompt intelligence from OUR OWN durable Supabase
 * tables (profound_answer_rows / profound_query_fanout_rows) via the shared cached
 * reader — NEVER any live account call. The live-pull branch was removed when the
 * account was fully disconnected; this surface now renders stored historical data
 * only. Fail-soft: empty tables → zero opportunities, never a throw.
 *
 * Ownership is decided by the owned domain (iranopedia.com), never a tracked asset.
 */
import "server-only";
import { cache } from "react";

import { loadCachedPromptOpportunities } from "@/domains/profound-coverage/load-cached";
import { type PromptOpportunity } from "./prompt-opportunity";

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
  const light = await loadCachedPromptOpportunities(tenantId);
  if (!light.scopeFound) return EMPTY;

  const opportunities: PromptOpportunity[] = light.opportunities;

  return {
    scopeFound: true,
    topicLabel: light.topicLabel,
    totalPrompts: opportunities.length,
    gapPrompts: opportunities.filter((o) => o.recommendedMove !== "expand_page").length,
    ownPresentPrompts: opportunities.filter((o) => o.ownCitationCount > 0 || o.ownMentionCount > 0).length,
    opportunities,
    answerRows: light.answerRows,
    fanoutRows: light.fanoutRows,
  };
}

/** Request-memoized loader (durable cached read, no live account call). */
export const loadProfoundPromptIntelligence = cache(loadUncached);
