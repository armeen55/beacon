/**
 * revenue_facts readers (2026-07-01, BEACON_500 item 3).
 *
 * Per-page and per-day loaders over the honest dollar substrate, request
 * memoized with react cache() like the sibling loaders (ga4-page-values).
 * Fail-soft: a missing table, missing rows, or any Supabase error returns
 * empty, so every consuming surface degrades exactly as it did before the
 * revenue pipe existed (no fake zeros, no crashes).
 *
 * HONESTY CONTRACT: every dollar leaving this module carries its source,
 * and `revenueBasisPhrase` / `combinedBasisPhrase` are the ONLY approved
 * labels. Estimated dollars (unit_economics) must never read as measured.
 */

import "server-only";

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { reportingDay } from "@/lib/reporting-day";
import { log } from "@/lib/logger";
import type { RevenueSource } from "./compute-unit-economics";

type RevenueFact = {
  pagePath: string;
  /** YYYY-MM-DD. */
  day: string;
  source: RevenueSource;
  revenueUsd: number;
  basis: string;
};

type DayRevenueSummary = {
  day: string;
  revenueUsd: number;
  sources: RevenueSource[];
};

/** Raw row shape from PostgREST. Internal: the mapping below is the only reader. */
type RawRevenueFactRow = {
  page_path: string;
  day: string;
  source: string;
  revenue_usd: number | string;
  basis: string;
};

const KNOWN_SOURCES: ReadonlySet<string> = new Set([
  "ad_network",
  "unit_economics",
  "affiliate",
  "operator_manual",
]);

/** Pure row mapping: numeric coercion + unknown-source drop. */
function mapRevenueFactRow(row: RawRevenueFactRow): RevenueFact | null {
  if (!row || !row.page_path || !row.day) return null;
  if (!KNOWN_SOURCES.has(row.source)) return null;
  const revenueUsd = Number(row.revenue_usd);
  if (!Number.isFinite(revenueUsd)) return null;
  return {
    pagePath: row.page_path,
    day: String(row.day).slice(0, 10),
    source: row.source as RevenueSource,
    revenueUsd,
    basis: row.basis ?? "",
  };
}

const WINDOW_DAYS = 60;
const READ_PAGE = 1000;
const MAX_READ_ROWS = 40_000;

/** All facts in the trailing window, request-memoized per (tenant, window). */
const loadRevenueFactsForTenant = cache(loadRevenueFactsForTenantUncached);

async function loadRevenueFactsForTenantUncached(
  tenantId: string,
  windowDays: number = WINDOW_DAYS,
  now: Date = new Date(),
): Promise<RevenueFact[]> {
  const out: RevenueFact[] = [];
  try {
    const since = reportingDay(now.getTime() - windowDays * 86_400_000);
    const sb = getSupabaseAdmin();
    for (let from = 0; from < MAX_READ_ROWS; from += READ_PAGE) {
      const { data, error } = await sb
        .from("revenue_facts")
        .select("page_path, day, source, revenue_usd, basis")
        .eq("tenant_id", tenantId)
        .gte("day", since)
        .order("day")
        .order("page_path")
        .range(from, from + READ_PAGE - 1);
      if (error) {
        // Pre-migration (42P01 / PGRST205) or any read failure: degrade to
        // "no revenue facts" exactly like before the pipe existed.
        log.warn("[load-revenue] read failed (no revenue shown)", {
          tenantId,
          error: error.message,
        });
        return [];
      }
      const batch = (data ?? []) as unknown as RawRevenueFactRow[];
      for (const raw of batch) {
        const fact = mapRevenueFactRow(raw);
        if (fact) out.push(fact);
      }
      if (batch.length < READ_PAGE) break;
    }
  } catch {
    return [];
  }
  return out;
}

/** Pure aggregation to per-day summaries (ascending by day). */
function summarizeRevenueByDay(facts: ReadonlyArray<RevenueFact>): DayRevenueSummary[] {
  type Acc = { revenueUsd: number; sources: Set<RevenueSource> };
  const accs = new Map<string, Acc>();
  for (const f of facts) {
    const acc = accs.get(f.day) ?? { revenueUsd: 0, sources: new Set<RevenueSource>() };
    acc.revenueUsd += f.revenueUsd;
    acc.sources.add(f.source);
    accs.set(f.day, acc);
  }
  return [...accs.entries()]
    .map(([day, acc]) => ({
      day,
      revenueUsd: Math.round(acc.revenueUsd * 100) / 100,
      sources: [...acc.sources].sort() as RevenueSource[],
    }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** Per-day dollars over the trailing window, ascending. */
export const loadRevenueByDayForTenant = cache(async function loadRevenueByDayForTenantImpl(
  tenantId: string,
  windowDays: number = WINDOW_DAYS,
): Promise<DayRevenueSummary[]> {
  return summarizeRevenueByDay(await loadRevenueFactsForTenant(tenantId, windowDays));
});
