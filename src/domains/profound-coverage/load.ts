/**
 * Profound Prompt-to-Page Coverage — owned-page universe + shared types (2026-06-26, I/O).
 *
 * Builds the tenant's OWNED-page universe (GSC per-page metrics + queries, page
 * snapshots, GA4 visits, Clarity friction) and defines the coverage result
 * shape. The DURABLE cached reader (`load-cached.ts`) reuses `loadOwnedPageCandidates`
 * and the `ProfoundCoverage` type; it reconstructs the coverage plan from the
 * synced profound_answer_rows / profound_query_fanout_rows tables (never the
 * live Profound API on render).
 *
 * Read-only. NO storage, NO writes, NO bots/referrals. Fail-soft everywhere: any
 * store miss → fewer owned pages, never a throw.
 *
 * Borrowed-account safe: ownership is decided by the owned domain
 * (iranopedia.com), never the tracked ChatGPT asset.
 */
import "server-only";

import { log } from "@/lib/logger";
import { loadGscPageSignalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { getRepository } from "@/lib/persistence/repositories";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import type { PageSnapshot } from "@/domains/pages/types";

import type { AeoActionPack, OwnedPageCandidate, PromptPageAssignment } from "./types";

/** Bound the owned-page universe to the top GSC pages by clicks (egress-safe). */
const OWNED_PAGE_CAP = 300;

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
