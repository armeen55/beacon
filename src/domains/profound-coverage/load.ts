/**
 * Profound Prompt-to-Page Coverage — loader (2026-06-26, I/O).
 *
 * On-demand (react.cache) read that fuses the LIVE Profound prompt intelligence
 * (answers + query-fanouts, topic-scoped) with the tenant's OWNED-page universe
 * (GSC per-page metrics + queries, page snapshots, GA4 visits, Clarity friction)
 * and runs the pure `compileCoverage` decision engine. Output is the ranked
 * page-action plan: which AI prompts map to an existing page, a new page, a hub,
 * an internal-link fix, or noise.
 *
 * Read-only. NO storage, NO writes, NO bots/referrals. Fail-soft everywhere: any
 * API/store miss → fewer owned pages or fewer opportunities, never a throw.
 *
 * Borrowed-account safe: only the topic's prompts/answers/fanouts are pulled;
 * Agent Analytics is NEVER called here; ownership is decided by the owned domain
 * (iranopedia.com), never the tracked ChatGPT asset.
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
import { buildPromptOpportunities, type FanoutRow } from "@/domains/profound-question-intelligence/prompt-opportunity";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { getRepository } from "@/lib/persistence/repositories";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";

import { compileCoverage } from "./compiler";
import type { AeoActionPack, OwnedPageCandidate, PromptPageAssignment } from "./types";

const WINDOW_DAYS = 30;
const ANSWER_CAP = 3000;
/** Bound the owned-page universe to the top GSC pages by clicks (egress-safe). */
const OWNED_PAGE_CAP = 300;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type ProfoundCoverageSummary = {
  totalPrompts: number;
  existingPage: number;
  newPage: number;
  hubPage: number;
  internalLinkFix: number;
  ignoredNoise: number;
};

export type ProfoundCoverage = {
  /** False when the tenant has no Profound prompt-intelligence scope. */
  scopeFound: boolean;
  topicLabel: string | null;
  summary: ProfoundCoverageSummary;
  actionPacks: AeoActionPack[];
  assignments: PromptPageAssignment[];
  /** Diagnostics. */
  ownedPageCount: number;
  opportunityCount: number;
  answerRows: number;
  fanoutRows: number;
};

const EMPTY_SUMMARY: ProfoundCoverageSummary = {
  totalPrompts: 0,
  existingPage: 0,
  newPage: 0,
  hubPage: 0,
  internalLinkFix: 0,
  ignoredNoise: 0,
};

const EMPTY: ProfoundCoverage = {
  scopeFound: false,
  topicLabel: null,
  summary: EMPTY_SUMMARY,
  actionPacks: [],
  assignments: [],
  ownedPageCount: 0,
  opportunityCount: 0,
  answerRows: 0,
  fanoutRows: 0,
};

/** Build the owned-page universe (GSC spine, enriched with snapshot/GA4/Clarity).
 *  Exported so the durable cached reader reuses the exact same owned-page logic. */
export async function loadOwnedPageCandidates(tenantId: string): Promise<OwnedPageCandidate[]> {
  // GSC is the spine: a page must attract search demand to plausibly own a prompt.
  let gsc: Awaited<ReturnType<typeof loadGscPageSignalsForTenant>> = new Map();
  try {
    gsc = await loadGscPageSignalsForTenant(tenantId);
  } catch (e) {
    log.warn("[profound-coverage] gsc page signals failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  if (gsc.size === 0) return [];

  // Enrichment sources (all fail-soft to empty maps).
  let ga4: Awaited<ReturnType<typeof loadGa4PageValuesForTenant>> = new Map();
  let clarity: Awaited<ReturnType<typeof loadClarityPageSignalsForTenant>> = new Map();
  try {
    ga4 = await loadGa4PageValuesForTenant(tenantId);
  } catch (e) {
    log.warn("[profound-coverage] ga4 page values failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  try {
    clarity = await loadClarityPageSignalsForTenant(tenantId);
  } catch (e) {
    log.warn("[profound-coverage] clarity page signals failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  // Snapshots → title/h1/h2/meta/wordCount/schema, keyed by canonical URL.
  const snapByUrl = new Map<string, PageSnapshot>();
  try {
    const repo = getRepository().forTenant(tenantId);
    const all = repo.getAllPageSnapshotsForGeneration
      ? await repo.getAllPageSnapshotsForGeneration()
      : await repo.getPageSnapshots();
    for (const s of Array.isArray(all) ? all : []) {
      if (!s?.url) continue;
      const key = canonicalizeCitationUrl(s.url);
      if (!key) continue;
      if (!snapByUrl.has(key)) snapByUrl.set(key, s);
    }
  } catch (e) {
    log.warn("[profound-coverage] snapshots read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  // Top GSC pages by clicks (bounded), enriched.
  const top = [...gsc.values()].sort((a, b) => b.clicks90d - a.clicks90d).slice(0, OWNED_PAGE_CAP);
  return top.map((sig): OwnedPageCandidate => {
    const canon = canonicalizeCitationUrl(sig.page) ?? sig.page;
    const snap = snapByUrl.get(canon);
    const g = ga4.get(canon);
    const c = clarity.get(canon);
    const friction = c ? round2((c.rageRate ?? 0) + (c.deadRate ?? 0) + (c.quickbackRate ?? 0)) : 0;
    return {
      url: sig.page,
      title: snap?.title ?? null,
      h1: snap?.h1 ?? null,
      h2s: Array.isArray(snap?.h2_list) ? snap!.h2_list : [],
      metaDescription: snap?.meta_description ?? null,
      wordCount: snap?.word_count ?? 0,
      gscQueries: sig.topQueries.map((q) => q.query),
      clicks90d: sig.clicks90d,
      impressions90d: sig.impressions90d,
      position90d: sig.position90d ?? null,
      ctr90d: sig.ctr90d,
      ga4Visits28d: g?.sessions28d ?? 0,
      ga4Value: 0, // GA4 has no revenue metric wired (conversions/traffic only).
      clarityFriction: friction,
      existingSchemaTypes: Array.isArray(snap?.schema_types) ? snap!.schema_types : [],
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function loadUncached(tenantId: string): Promise<ProfoundCoverage> {
  const scope = getProfoundTenantScope(tenantId);
  if (!scope) return EMPTY;

  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
  const startDate = ymd(start);
  const endDate = ymd(end);
  const filters = profoundTopicFilter(scope);

  // ── Live Profound pull (answers + fanouts), identical scoping to the QI loader.
  let answers: Awaited<ReturnType<typeof pullProfoundAnswers>> = null;
  try {
    answers = await pullProfoundAnswers({ tenantId, categoryId: scope.categoryId, startDate, endDate, filters, maxRows: ANSWER_CAP });
  } catch (e) {
    log.warn("[profound-coverage] answers pull failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  const answerRowsArr = answers?.rows ?? [];

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
    fanouts = (fanRes?.rows ?? []).map((r) => ({ prompt: r.dims.prompt ?? "", query: r.dims.query ?? "", model: r.dims.model ?? null }));
  } catch (e) {
    log.warn("[profound-coverage] fanouts pull failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }

  const opportunities = buildPromptOpportunities({
    answers: answerRowsArr,
    fanouts,
    ownedDomain: scope.ownedDomain,
    ownedMentionAliases: scope.ownedMentionAliases,
    isNoisePrompt: isProfoundNoisePrompt,
  });

  // ── Owned-page universe + the pure decision engine.
  const ownedPages = await loadOwnedPageCandidates(tenantId);
  const { assignments, actionPacks, summary } = compileCoverage(opportunities, ownedPages);

  return {
    scopeFound: true,
    topicLabel: scope.topicLabel,
    summary,
    actionPacks,
    assignments,
    ownedPageCount: ownedPages.length,
    opportunityCount: opportunities.length,
    answerRows: answerRowsArr.length,
    fanoutRows: fanouts.length,
  };
}

/** Request-memoized loader (one live pull + compile per render). */
export const loadProfoundCoverageForTenant = cache(loadUncached);
