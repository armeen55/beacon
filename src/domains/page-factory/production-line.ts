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
import { governFactoryBatch, summarizeRefusals, type GovernorRefusal } from "@/domains/push/factory-governor";
import {
  loadGovernorContextForTenant,
  loadTeardownTopicEntriesForTenant,
  EMPTY_GOVERNOR_CONTEXT,
  type GovernorContext,
  type TeardownTopicEntry,
} from "@/domains/push/factory-governor-context";
import { scoreInfoGain, extractsForTopic } from "@/domains/drafts/info-gain-gate";

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
  /** N28 (2026-07-03): pages the governor or the info-gain law refused this
   *  run (their plain reasons persist on the batch record). */
  refused?: number;
  costUsd: number;
  batch: FactoryBatchRecord | null;
};

export type ProductionLineDeps = {
  now?: () => Date;
  /** Injectable for tests - defaults to the real create-page brief drafter. */
  draftBrief?: typeof draftCreatePageStructured;
  /** Injectable for tests - defaults to the real section-by-section walker. */
  draftFullPage?: typeof draftFullPageStructured;
  /** N28 (2026-07-03): injectable pace/growth counts for the scaled-content
   *  governor; defaults to the real shipped-ledger + batch-history read. */
  governorContext?: GovernorContext;
  /** N5 (2026-07-03): injectable topic-keyed teardown extracts for the
   *  info-gain check; defaults to the steal-brief + audit-cache join. */
  teardownEntries?: TeardownTopicEntry[];
  /** Optional narrower landing strip for an on-visit recovery. The scheduled
   * weekly run keeps the five-page default; recovery may create one useful
   * review item without attempting a whole multi-page LLM batch inside a
   * request's post-response lifetime. */
  maxDrafts?: number;
  /** Full-page prose is valuable but much slower than a reviewable grounded
   * brief. On-visit recovery can persist the brief and let normal preparation
   * complete prose later. Defaults to true for the regular weekly run. */
  draftFullPages?: boolean;
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
  const maxDrafts = Math.max(1, Math.min(MAX_DRAFTS_PER_WEEK, deps.maxDrafts ?? MAX_DRAFTS_PER_WEEK));
  const shouldDraftFullPages = deps.draftFullPages ?? true;

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
    const rankedAll = passed.sort((a, b) => {
      const av = a.verdict.source === "cached_keyword" ? a.verdict.searchVolume : a.verdict.demand;
      const bv = b.verdict.source === "cached_keyword" ? b.verdict.searchVolume : b.verdict.demand;
      return bv - av;
    });

    // N28 scaled-content governor (2026-07-03, R8): before any LLM spend,
    // enforce the weekly pace (shipped ledger + batch history, not just this
    // batch), the no-two-pages-on-one-topic rule, and the monthly site-growth
    // ratio. Refused pages are skipped WITH their plain reason persisted to
    // the batch record below. Fail-soft context - unknown counts enforce only
    // what they can see, never block on missing data.
    const governorCtx =
      deps.governorContext ??
      (await loadGovernorContextForTenant(tenantId, now()).catch(() => EMPTY_GOVERNOR_CONTEXT));
    const considered = rankedAll.slice(0, maxDrafts);
    const govern = governFactoryBatch({
      candidates: considered.map((r) => ({ slug: r.candidate.slug, title: r.candidate.title })),
      newPagesThisWeek: governorCtx.newPagesThisWeek,
      newPagesThisMonth: governorCtx.newPagesThisMonth,
      indexedPageCount: governorCtx.indexedPageCount,
    });
    const refusals: GovernorRefusal[] = [...govern.refusals];
    const allowedSlugs = new Set(govern.allowed.map((c) => c.slug));
    const ranked = considered.filter((r) => allowedSlugs.has(r.candidate.slug));

    // N5 comparison evidence: topic-keyed teardown extracts ($0, cache-only).
    const teardownEntries =
      deps.teardownEntries ?? (await loadTeardownTopicEntriesForTenant(tenantId).catch(() => []));

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
        // W5 P1-4 (2026-07-09): pass the brief's OWN (generation-time verified)
        // sources so its factual openingAnswer clears the new source gate; an
        // unsourced factual brief is honestly held out of the batch.
        sources: briefValue.sources,
      });
      if (!quality.copyAllowed) {
        totalCostUsd += costUsd;
        continue; // rejected copy never enters the review batch
      }

      // N5 information-gain law (2026-07-03, R8): a batch page must ADD
      // something the winning pages for its topic do not already say. Scored
      // only when teardown evidence exists for this topic (unchecked = pass,
      // never block on missing data); a repeat or a thin addition is skipped
      // WITH the honest sentence persisted to the batch record.
      const infoGain = scoreInfoGain(
        {
          title: briefValue.proposedTitle,
          outline: briefValue.outline,
          answer: briefValue.openingAnswer,
          faqQuestions: briefValue.faqQuestions,
        },
        extractsForTopic(candidate.title, teardownEntries),
        { topicLabel: candidate.title },
      );
      if (infoGain.verdict === "duplicate_of_serp" || infoGain.verdict === "thin_addition") {
        totalCostUsd += costUsd;
        refusals.push({
          slug: candidate.slug,
          category: infoGain.verdict === "duplicate_of_serp" ? "repeats_winners" : "too_little_new",
          plainReason: infoGain.sentence,
        });
        continue;
      }

      const fullPageBrief: FullPageBriefInput = {
        proposedTitle: briefValue.proposedTitle,
        metaDescription: briefValue.metaDescription,
        openingAnswer: briefValue.openingAnswer,
        outline: briefValue.outline,
        faqQuestions: briefValue.faqQuestions,
      };

      let fullPageResult: Awaited<ReturnType<typeof draftFullPageStructured>> = {
        status: "off",
      };
      if (shouldDraftFullPages) {
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
        ...(infoGain.verdict !== "unchecked"
          ? { infoGain: { verdict: infoGain.verdict, sentence: infoGain.sentence } }
          : {}),
        status: "pending",
        targetUrl: null,
        costUsd,
        updatedAt: nowDate.toISOString(),
      });
    }

    const governorSummary = summarizeRefusals(refusals, considered.length);
    const batch: FactoryBatchRecord = {
      tenant_id: tenantId,
      weekOf,
      items,
      queuedForKeywordBatch: queued,
      totalCostUsd,
      generatedAt: now().toISOString(),
      ...(refusals.length > 0
        ? {
            governorRefusals: refusals.map((r) => ({ slug: r.slug, plainReason: r.plainReason })),
            governorSummary,
          }
        : {}),
    };
    const created = await createFactoryBatch(batch);

    log.info("[page-factory] weekly batch generated", {
      tenantId,
      weekOf,
      drafted: items.length,
      queued: queued.length,
      rejected: rejectedCount,
      refused: refusals.length,
      costUsd: totalCostUsd,
      ceilingHit,
      ...(governorSummary ? { governorSummary } : {}),
    });

    return {
      tenantId,
      weekOf,
      ran: created,
      reason: created ? "ok" : "already_ran",
      drafted: items.length,
      queued: queued.length,
      rejected: rejectedCount,
      refused: refusals.length,
      costUsd: totalCostUsd,
      batch: created ? batch : priorBatches.find((b) => b.weekOf === weekOf) ?? batch,
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log.warn("[page-factory] production line failed for tenant", { tenantId, weekOf, error });
    return { ...empty(`error: ${error}`.slice(0, 300)) };
  }
}
