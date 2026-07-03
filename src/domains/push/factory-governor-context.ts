import "server-only";

/**
 * factory-governor-context (2026-07-03, R8 / N28) - the I/O edge for the pure
 * factory governor (factory-governor.ts). Loads, per tenant:
 *
 *   - newPagesThisWeek / newPagesThisMonth: counted from the shipped ledger
 *     (shipped_change_proof rows with action_type create_page) PLUS the page
 *     factory's own batch history (items produced, skipped ones excluded).
 *     A page that appears in both counts twice - for a spam governor,
 *     over-counting is the fail-safe direction (a slightly slower pace can
 *     never hurt the site; an under-count could).
 *   - indexedPageCount: the tenant's `pages` row count (the crawl's one row
 *     per page), for the 10 percent monthly growth guard. Unknown -> null and
 *     the guard honestly skips (never block on missing data).
 *
 * Also loads the topic-keyed teardown extracts the production line's N5 check
 * compares briefs against: every steal-brief keyword joined to its torn-down
 * competitor audit ($0 - reads existing caches, never fetches).
 *
 * Every read is fail-soft: no Supabase env, missing tables, or empty stores
 * degrade to zero counts / null / empty lists - the governor then only
 * enforces what it can actually see.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { loadFactoryBatchHistory } from "@/domains/page-factory/batch-store";
import { loadStealBriefsForTenant } from "@/domains/serp/serp-steal-lane";
import { getCompetitorAuditsForTenant } from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { auditToExtract, type CompetitorExtract } from "@/domains/drafts/info-gain-gate";
import { countInWeekOf, countInMonthOf } from "./factory-governor";

export type GovernorContext = {
  newPagesThisWeek: number;
  newPagesThisMonth: number;
  indexedPageCount: number | null;
};

export const EMPTY_GOVERNOR_CONTEXT: GovernorContext = {
  newPagesThisWeek: 0,
  newPagesThisMonth: 0,
  indexedPageCount: null,
};

export async function loadGovernorContextForTenant(tenantId: string, now: Date): Promise<GovernorContext> {
  const dates: string[] = [];

  // Shipped ledger: create_page changes the operator actually shipped.
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("shipped_change_proof")
      .select("shipped_at, action_type")
      .eq("tenant_id", tenantId);
    if (!error && Array.isArray(data)) {
      for (const r of data as Array<{ shipped_at: string; action_type: string }>) {
        if (r.action_type === "create_page" && r.shipped_at) dates.push(r.shipped_at);
      }
    }
  } catch {
    /* fail-soft - the governor only enforces what it can see */
  }

  // Factory batch history: pages the weekly line already produced.
  try {
    const batches = await loadFactoryBatchHistory(tenantId);
    for (const b of batches) {
      for (const item of b.items) {
        if (item.status !== "skipped") dates.push(b.generatedAt);
      }
    }
  } catch {
    /* fail-soft */
  }

  // Indexed page count (one `pages` row per crawled page).
  let indexedPageCount: number | null = null;
  try {
    const admin = getSupabaseAdmin();
    const { count, error } = await admin
      .from("pages")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (!error && typeof count === "number") indexedPageCount = count;
  } catch {
    /* unknown -> growth guard skips */
  }

  return {
    newPagesThisWeek: countInWeekOf(dates, now),
    newPagesThisMonth: countInMonthOf(dates, now),
    indexedPageCount,
  };
}

export type TeardownTopicEntry = { topics: string[]; extract: CompetitorExtract };

/** Topic-keyed teardown extracts for the production line's N5 comparison:
 *  each steal-brief keyword joined to its torn-down competitor audit. $0,
 *  cache-only, fail-soft to []. */
export async function loadTeardownTopicEntriesForTenant(tenantId: string): Promise<TeardownTopicEntry[]> {
  try {
    const [briefs, audits] = await Promise.all([
      loadStealBriefsForTenant(tenantId),
      getCompetitorAuditsForTenant(),
    ]);
    const out: TeardownTopicEntry[] = [];
    for (const b of briefs) {
      if (!b.competitorUrl) continue;
      const audit =
        audits.get(canonicalizeCitationUrl(b.competitorUrl) ?? b.competitorUrl) ??
        audits.get(b.competitorUrl);
      if (!audit) continue;
      const extract = auditToExtract(audit);
      if (extract) out.push({ topics: [b.keyword], extract });
    }
    return out;
  } catch {
    return [];
  }
}
