/**
 * Profound Prompt-to-Page Coverage — DURABLE cached reader (2026-06-26, I/O).
 *
 * The fast path: reconstructs the coverage decision plan from the durable
 * profound_answer_rows / profound_query_fanout_rows tables (populated by the
 * on-demand sync) instead of the ~22s live Profound pull. Same pure engine
 * (buildPromptOpportunities → compileCoverage) and same owned-page universe as
 * the live loader, so output is identical given the same underlying data — only
 * the source of the Profound rows differs (Supabase read vs live API).
 *
 * Target: sub-100ms to a few hundred ms. Read-only, fail-soft (empty tables →
 * empty plan with rowsCached=0, never a throw). This is the reader customer-
 * facing surfaces (New Pages, EvidencePackets, Today Moves) consume — they must
 * NEVER hit the live Profound API on render.
 */
import "server-only";
import { cache } from "react";

import { log } from "@/lib/logger";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import type { ProfoundAnswerRow } from "@/lib/connectors/profound/answer-row";
import { getProfoundTenantScope, isProfoundNoisePrompt } from "@/lib/connectors/profound/tenant-scope";
import { buildPromptOpportunities, type FanoutRow } from "@/domains/profound-question-intelligence/prompt-opportunity";

import type { PromptOpportunity } from "@/domains/profound-question-intelligence/prompt-opportunity";

import { compileCoverage } from "./compiler";
import { loadOwnedPageCandidates, type ProfoundCoverage } from "./load";

const PAGE = 1000;
const MAX_PAGES = 12; // 12k rows ceiling — far above the real per-tenant volume.

const EMPTY: ProfoundCoverage = {
  scopeFound: false,
  topicLabel: null,
  summary: { totalPrompts: 0, existingPage: 0, newPage: 0, hubPage: 0, internalLinkFix: 0, ignoredNoise: 0 },
  actionPacks: [],
  assignments: [],
  ownedPageCount: 0,
  opportunityCount: 0,
  answerRows: 0,
  fanoutRows: 0,
};

/** Paginated select of one tenant-scoped table (avoids the 1000-row default cap). */
async function readAll(table: string, columns: string, tenantId: string): Promise<Record<string, unknown>[]> {
  const sb = getSupabaseAdmin();
  const out: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .eq("tenant_id", tenantId)
      .range(from, from + PAGE - 1);
    if (error) {
      log.warn("[profound-coverage-cached] read failed", { table, error: error.message });
      break;
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export type CachedPromptOpportunities = {
  scopeFound: boolean;
  topicLabel: string | null;
  opportunities: PromptOpportunity[];
  answerRows: number;
  fanoutRows: number;
};

/** LIGHT, fast primitive: read the durable Profound rows and build the
 *  PromptOpportunity list — NO owned-page load, NO compiler. This is what
 *  customer-facing fusion (New Pages / EvidencePackets / Today Moves) consumes:
 *  it needs the prompt → competitors → fan-outs → gap signal, not the page
 *  assignment (consumers already hold their own page/demand-graph context). */
async function loadOpportunitiesUncached(tenantId: string): Promise<CachedPromptOpportunities> {
  const scope = getProfoundTenantScope(tenantId);
  if (!scope) return { scopeFound: false, topicLabel: null, opportunities: [], answerRows: 0, fanoutRows: 0 };
  if (!isSupabaseConfigured()) return { scopeFound: true, topicLabel: scope.topicLabel, opportunities: [], answerRows: 0, fanoutRows: 0 };

  let answerDocs: Record<string, unknown>[] = [];
  let fanoutDocs: Record<string, unknown>[] = [];
  try {
    [answerDocs, fanoutDocs] = await Promise.all([
      readAll("profound_answer_rows", "prompt,topic,model,mentions,citation_urls,citation_hosts,themes", tenantId),
      readAll("profound_query_fanout_rows", "prompt,query,model", tenantId),
    ]);
  } catch (e) {
    log.warn("[profound-coverage-cached] durable read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  const answers: ProfoundAnswerRow[] = answerDocs.map((d) => ({
    promptId: null,
    prompt: typeof d.prompt === "string" ? d.prompt : "",
    response: typeof d.response_excerpt === "string" ? d.response_excerpt : "",
    mentions: strArr(d.mentions),
    citationUrls: strArr(d.citation_urls),
    citationHostnames: strArr(d.citation_hosts),
    themes: strArr(d.themes),
    topic: typeof d.topic === "string" ? d.topic : null,
    model: typeof d.model === "string" ? d.model : null,
    asset: null,
    createdAt: null,
  }));

  const fanouts: FanoutRow[] = fanoutDocs.map((d) => ({
    prompt: typeof d.prompt === "string" ? d.prompt : "",
    query: typeof d.query === "string" ? d.query : "",
    model: typeof d.model === "string" ? d.model : null,
  }));

  const opportunities = buildPromptOpportunities({
    answers,
    fanouts,
    ownedDomain: scope.ownedDomain,
    ownedMentionAliases: scope.ownedMentionAliases,
    isNoisePrompt: isProfoundNoisePrompt,
  });

  return { scopeFound: true, topicLabel: scope.topicLabel, opportunities, answerRows: answers.length, fanoutRows: fanouts.length };
}

/** Request-memoized light read (durable Profound → PromptOpportunity[], no pages). */
export const loadCachedPromptOpportunities = cache(loadOpportunitiesUncached);

async function loadUncached(tenantId: string): Promise<ProfoundCoverage> {
  const light = await loadCachedPromptOpportunities(tenantId);
  if (!light.scopeFound) return EMPTY;

  const ownedPages = await loadOwnedPageCandidates(tenantId);
  const { assignments, actionPacks, summary } = compileCoverage(light.opportunities, ownedPages);

  return {
    scopeFound: true,
    topicLabel: light.topicLabel,
    summary,
    actionPacks,
    assignments,
    ownedPageCount: ownedPages.length,
    opportunityCount: light.opportunities.length,
    answerRows: light.answerRows,
    fanoutRows: light.fanoutRows,
  };
}

/** Request-memoized DURABLE coverage read (no live Profound API call). */
export const loadCachedProfoundCoverageForTenant = cache(loadUncached);
