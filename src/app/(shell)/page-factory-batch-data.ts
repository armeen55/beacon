import "server-only";

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";
import { loadLatestFactoryBatch, type FactoryBatchRecord } from "@/domains/page-factory/batch-store";
import { getLatestMoveDrafts } from "@/domains/demand-graph/move-draft-store";
import { deserializeFullPageDraft, reassembleFromPersisted, type AssembledDraftPage } from "@/domains/llm/draft-full-page";
import type { CreatePageBrief } from "@/domains/llm/schemas";

/**
 * page-factory-batch-data (BEACON 500 item 62) - the loader behind the "This
 * week's page factory batch" review card on the New Pages board. Read-only,
 * $0, fail-soft; self-hides when no batch has been generated yet or the
 * latest batch is fully actioned (nothing left pending).
 */

export type FactoryBatchCardItem = {
  slug: string;
  title: string;
  entity: string;
  attribute: string;
  matchedKeyword: string | null;
  searchVolume: number | null;
  demandSource: "cached_keyword" | "graph_demand";
  why: string;
  status: FactoryBatchRecord["items"][number]["status"];
  targetUrl: string | null;
  costUsd: number;
  /** The persisted brief (title/meta/opening/outline/faq), when the draft succeeded. */
  brief: CreatePageBrief | null;
  /** The re-assembled full paste-ready page, when the section walker produced one. */
  fullPage: AssembledDraftPage | null;
};

export type FactoryBatchCardData = {
  weekOf: string;
  generatedAt: string;
  totalCostUsd: number;
  queuedCount: number;
  items: FactoryBatchCardItem[];
};

// FP5b (2026-07-02) - react.cache()'d: /worklist now reads this twice per request (the
// batch card itself + the New Pages board's exclude-topics dedupe), so the store read
// happens once and both consumers see the same rows.
export const loadFactoryBatchCardData = cache(async (): Promise<FactoryBatchCardData | null> => {
  const tenantId = await currentTenantId();
  const batch = await loadLatestFactoryBatch(tenantId).catch(() => null);
  if (!batch || batch.items.length === 0) return null;

  const drafts = await getLatestMoveDrafts(tenantId).catch(() => new Map());

  const items: FactoryBatchCardItem[] = batch.items.map((item) => {
    let brief: CreatePageBrief | null = null;
    const rawBrief = drafts.get(`${item.slug}::create_page_brief`)?.content;
    if (rawBrief) {
      try {
        brief = JSON.parse(rawBrief) as CreatePageBrief;
      } catch {
        brief = null;
      }
    }
    let fullPage: AssembledDraftPage | null = null;
    if (brief) {
      const persisted = deserializeFullPageDraft(drafts.get(`${item.slug}::full_page_draft`)?.content);
      if (persisted) {
        fullPage = reassembleFromPersisted(
          {
            proposedTitle: brief.proposedTitle,
            metaDescription: brief.metaDescription,
            openingAnswer: brief.openingAnswer,
            outline: brief.outline,
            faqQuestions: brief.faqQuestions,
          },
          persisted,
        );
      }
    }
    return {
      slug: item.slug,
      title: item.title,
      entity: item.entity,
      attribute: item.attribute,
      matchedKeyword: item.matchedKeyword,
      searchVolume: item.searchVolume,
      demandSource: item.demandSource,
      why: item.why,
      status: item.status,
      targetUrl: item.targetUrl,
      costUsd: item.costUsd,
      brief,
      fullPage,
    };
  });

  return {
    weekOf: batch.weekOf,
    generatedAt: batch.generatedAt,
    totalCostUsd: batch.totalCostUsd,
    queuedCount: batch.queuedForKeywordBatch.length,
    items,
  };
});
