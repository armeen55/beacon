import "server-only";

import { log } from "@/lib/logger";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { loadPageCandidates } from "./load-page-candidates";
import { dedupeFactoryCandidates, type ExistingMoveLabel } from "./dedupe-candidates";
import { validateCandidateDemand, type GraphDemandSignal } from "./validate-demand";
import { loadDatasetCandidatesForTenant } from "@/domains/datasets/dataset-candidates";
import { datasetCandidateToPageCandidate } from "@/domains/datasets/dataset-page-spec";
import type { PageCandidate } from "./entity-attribute-factory";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { loadFactoryBatchHistory, createFactoryBatch, type FactoryBatchItem, type FactoryBatchRecord } from "./batch-store";
import { draftCreatePageStructured } from "@/domains/llm/structured-drafter";
import { evaluateCreatePageBriefQuality } from "@/domains/drafts/draft-quality";
import { draftFullPageStructured, assembleDraftPage, serializeFullPageDraft, type FullPageBriefInput } from "@/domains/llm/draft-full-page";
import { saveMoveDraft } from "@/domains/demand-graph/move-draft-store";
import { stripBannedDashes } from "@/lib/copy/strip-dashes";

/**
 * page-factory/production-line (BEACON 500 item 62) - the governed weekly
 * production line that turns entity-attribute-factory.ts candidates into a
 * reviewable batch of STAGED, demand-validated, fully drafted pages.
 *
 * Chain: load candidates -> dedupe (owned pages + open Moves + prior batches)
 * -> validate demand at $0 (cached DataForSEO keyword volumes, or graph demand)
 * -> cap at MAX_DRAFTS_PER_WEEK -> draft (brief -> quality gate -> full page)
 * under a hard per-run LLM cost ceiling -> persist each drafted page + the
 * weekly batch record. NEVER publishes - every page lands as `status: pending`
 * for the operator to approve or skip on the New Pages board.
 *
 * Fail-soft per candidate: one candidate's draft failure never blocks the rest
 * of the week's batch. The whole run is fail-soft to the caller too (a thrown
 * error returns an empty/errored summary, never propagates to the cron route's
 * other tenants).
 */

/** Hard governance cap - constant, not tenant-configurable. */
export const MAX_DRAFTS_PER_WEEK = 5;

/** Hard LLM spend ceiling for one week's production run, across every
 *  candidate's brief + full-page draft combined. Fail-closed: once a
 *  candidate's spend would push the running total past this, the run stops
 *  drafting further candidates (whatever already drafted is kept). */
export const WEEKLY_LLM_CEILING_USD = 0.3;

export type ProductionLineSummary = {
  tenantId: string;
  weekOf: string;
  ran: boolean;
  /** "already_ran" | "no_candidates" | "ok" | "error: <message>" */
  reason: string;
  drafted: number;
  queued: number;
  rejected: number;
  costUsd: number;
  batch: FactoryBatchRecord | null;
};

export type ProductionLineDeps = {
  now?: () => Date;
  /** Injectable for tests - defaults to the real create-page brief drafter. */
  draftBrief?: typeof draftCreatePageStructured;
  /** Injectable for tests - defaults to the real section-by-section walker. */
  draftFullPage?: typeof draftFullPageStructured;
};

/** Monday of the week containing `now`, as an ISO date (YYYY-MM-DD), UTC. Mirrors
 *  /api/cron/strategy-review's mondayOfWeek exactly - the same stable weekOf key. */
export function mondayOfWeek(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d.toISOString().slice(0, 10);
}

/**
 * Run the weekly production line for ONE tenant. Idempotent per (tenant,
 * weekOf) via the batch store's createFactoryBatch - a second same-week call
 * (retry, manual re-trigger) is a no-op that reports the existing batch.
 */
export async function runProductionLineForTenant(
  tenantId: string,
  weekOf: string,
  deps: ProductionLineDeps = {},
): Promise<ProductionLineSummary> {
  const now = deps.now ?? (() => new Date());
  const draftBrief = deps.draftBrief ?? draftCreatePageStructured;
  const draftFullPage = deps.draftFullPage ?? draftFullPageStructured;

  const empty = (reason: string): ProductionLineSummary => ({
    tenantId,
    weekOf,
    ran: false,
    reason,
    drafted: 0,
    queued: 0,
    rejected: 0,
    costUsd: 0,
    batch: null,
  });

  try {
    const priorBatches = await loadFactoryBatchHistory(tenantId).catch(() => []);
    if (priorBatches.some((b) => b.weekOf === weekOf)) {
      return { ...empty("already_ran"), batch: priorBatches.find((b) => b.weekOf === weekOf) ?? null };
    }

    let graph;
    try {
      graph = (await loadDemandGraphForTenantCached(tenantId)).graph;
    } catch (e) {
      log.warn("[page-factory] graph load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
      return empty("error: graph load failed");
    }

    const rawCandidates = await loadPageCandidates(tenantId, { max: 40 }).catch(() => []);

    // BEACON 500 item 76 - citable dataset pages (additive candidate source).
    // Each dataset candidate already carries its OWN real, measured demand
    // number (summed GSC impressions across a page family, or a real query/
    // fanout count) computed by the datasets domain itself - stronger proof
    // than the entity-attribute stream's coincidental keyword-token match, so
    // these are treated as already-validated ("graph_demand") rather than run
    // back through validateCandidateDemand's generic label matcher.
    const datasetCandidates = await loadDatasetCandidatesForTenant(tenantId).catch(() => []);
    const datasetSlugs = new Set(datasetCandidates.map((d) => d.slug));

    if (rawCandidates.length === 0 && datasetCandidates.length === 0) return empty("no_candidates");

    const existingMoves: ExistingMoveLabel[] = graph.moves.map((m) => ({ label: m.label, gap: m.gap }));
    const deduped = dedupeFactoryCandidates(rawCandidates, existingMoves, priorBatches);
    // Dataset slugs are dedup-checked against prior batches the same way (a
    // dataset candidate already drafted in an earlier week never re-drafts).
    const priorSlugs = new Set(priorBatches.flatMap((b) => b.items.map((i) => i.slug)));
    const dedupedDatasetCandidates = datasetCandidates.filter((d) => !priorSlugs.has(d.slug));
    if (deduped.length === 0 && dedupedDatasetCandidates.length === 0) return empty("no_candidates");

    const keywords = await readAllCachedKeywordDemand().catch(() => []);
    const graphSignals: GraphDemandSignal[] = graph.moves.map((m) => ({ label: m.label, demand: m.components.demand }));

    const queued: Array<{ slug: string; title: string }> = [];
    const passed: Array<{ candidate: PageCandidate; verdict: Extract<ReturnType<typeof validateCandidateDemand>, { status: "pass" }> }> = [];
    let rejectedCount = 0;

    for (const c of deduped) {
      const verdict = validateCandidateDemand(c, keywords, graphSignals);
      if (verdict.status === "pass") passed.push({ candidate: c, verdict });
      else if (verdict.status === "queued") queued.push({ slug: c.slug, title: c.title });
      else rejectedCount += 1;
    }

    for (const d of dedupedDatasetCandidates) {
      passed.push({
        candidate: datasetCandidateToPageCandidate(d),
        verdict: { status: "pass", source: "graph_demand", matchedLabel: d.title, demand: d.demandScore },
      });
    }

    // Rank by real backing demand (cached volume, else graph demand), cap to the
    // hard weekly constant.
    const ranked = passed
      .sort((a, b) => {
        const av = a.verdict.source === "cached_keyword" ? a.verdict.searchVolume : a.verdict.demand;
        const bv = b.verdict.source === "cached_keyword" ? b.verdict.searchVolume : b.verdict.demand;
        return bv - av;
      })
      .slice(0, MAX_DRAFTS_PER_WEEK);

    const items: FactoryBatchItem[] = [];
    let totalCostUsd = 0;
    let ceilingHit = false;

    for (let rankIdx = 0; rankIdx < ranked.length; rankIdx += 1) {
      const { candidate, verdict } = ranked[rankIdx]!;
      if (totalCostUsd >= WEEKLY_LLM_CEILING_USD) {
        ceilingHit = true;
        queued.push({ slug: candidate.slug, title: candidate.title });
        continue;
      }

      const nowDate = now();
      let costUsd = 0;
      let brief: Awaited<ReturnType<typeof draftCreatePageStructured>> | null = null;
      try {
        brief = await draftBrief(
          {
            query: candidate.title,
            pageLabel: candidate.slug,
            competitorPages: [],
            fanoutQueries: [],
            evidenceHints: [candidate.why],
          },
          { now: nowDate },
        );
      } catch (e) {
        log.warn("[page-factory] brief draft threw (fail-soft, skipping candidate)", {
          tenantId,
          slug: candidate.slug,
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      if (!brief || brief.status === "off" || brief.status === "blocked_budget") {
        // Global LLM gate is off/over budget - every remaining candidate would
        // fail identically, so stop calling the drafter and requeue everything
        // left in the ranked list (this candidate included) for next week.
        for (let j = rankIdx; j < ranked.length; j += 1) {
          queued.push({ slug: ranked[j]!.candidate.slug, title: ranked[j]!.candidate.title });
        }
        break;
      }
      if (brief.status === "validation_failed") {
        totalCostUsd += brief.costUsd;
        continue; // fail-soft: this candidate just doesn't ship this week
      }

      costUsd += brief.costUsd;
      const briefValue = brief.value;
      const quality = evaluateCreatePageBriefQuality({
        title: briefValue.proposedTitle,
        meta: briefValue.metaDescription,
        opening: briefValue.openingAnswer,
        outline: briefValue.outline,
        faqQuestions: briefValue.faqQuestions,
        schemaTypes: briefValue.schemaTypes,
        hasSerpVerdict: false,
      });
      if (!quality.copyAllowed) {
        totalCostUsd += costUsd;
        continue; // rejected copy never enters the review batch
      }

      const fullPageBrief: FullPageBriefInput = {
        proposedTitle: briefValue.proposedTitle,
        metaDescription: briefValue.metaDescription,
        openingAnswer: briefValue.openingAnswer,
        outline: briefValue.outline,
        faqQuestions: briefValue.faqQuestions,
      };

      let fullPageResult: Awaited<ReturnType<typeof draftFullPageStructured>>;
      try {
        fullPageResult = await draftFullPage(
          fullPageBrief,
          { topic: candidate.title, evidenceFacts: [candidate.why] },
          { now: nowDate },
        );
      } catch (e) {
        log.warn("[page-factory] full-page draft threw (fail-soft, keeping brief-only)", {
          tenantId,
          slug: candidate.slug,
          error: e instanceof Error ? e.message : String(e),
        });
        fullPageResult = { status: "drafted", outcomes: [], totalCostUsd: 0, sectionsDrafted: 0, sectionsFallback: 0 };
      }

      if (fullPageResult.status === "drafted") {
        costUsd += fullPageResult.totalCostUsd;
        const assembled = assembleDraftPage(fullPageBrief, fullPageResult);
        const serialized = serializeFullPageDraft(assembled);
        await saveMoveDraft(tenantId, candidate.slug, "create_page_brief", JSON.stringify(briefValue)).catch(() => false);
        if (serialized) {
          await saveMoveDraft(tenantId, candidate.slug, "full_page_draft", serialized).catch(() => false);
        }
      } else {
        // "off" / "blocked_budget" for the section walker - the brief alone still
        // ships this week's batch (paste-ready outline), just without full prose.
        await saveMoveDraft(tenantId, candidate.slug, "create_page_brief", JSON.stringify(briefValue)).catch(() => false);
      }

      totalCostUsd += costUsd;

      const isDataset = datasetSlugs.has(candidate.slug);
      items.push({
        slug: candidate.slug,
        title: stripBannedDashes(briefValue.proposedTitle),
        entity: candidate.entity,
        attribute: candidate.attribute,
        matchedKeyword: verdict.source === "cached_keyword" ? verdict.matchedKeyword : null,
        searchVolume: verdict.source === "cached_keyword" ? verdict.searchVolume : null,
        demandSource: verdict.source,
        why: isDataset
          ? candidate.why
          : verdict.source === "cached_keyword"
            ? `I found real search demand for this: ${verdict.searchVolume.toLocaleString()} searches a month.`
            : `Your own site data shows real demand for "${verdict.matchedLabel}".`,
        ...(isDataset ? { datasetTag: "dataset_page" as const } : {}),
        status: "pending",
        targetUrl: null,
        costUsd,
        updatedAt: nowDate.toISOString(),
      });
    }

    const batch: FactoryBatchRecord = {
      tenant_id: tenantId,
      weekOf,
      items,
      queuedForKeywordBatch: queued,
      totalCostUsd,
      generatedAt: now().toISOString(),
    };
    const created = await createFactoryBatch(batch);

    log.info("[page-factory] weekly batch generated", {
      tenantId,
      weekOf,
      drafted: items.length,
      queued: queued.length,
      rejected: rejectedCount,
      costUsd: totalCostUsd,
      ceilingHit,
    });

    return {
      tenantId,
      weekOf,
      ran: created,
      reason: created ? "ok" : "already_ran",
      drafted: items.length,
      queued: queued.length,
      rejected: rejectedCount,
      costUsd: totalCostUsd,
      batch: created ? batch : priorBatches.find((b) => b.weekOf === weekOf) ?? batch,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn("[page-factory] production line failed for tenant", { tenantId, weekOf, error });
    return { ...empty(`error: ${error}`.slice(0, 300)) };
  }
}
