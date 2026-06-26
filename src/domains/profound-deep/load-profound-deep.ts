import "server-only";
import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import {
  aggregateReferralsByPage,
  summarizeReferrals,
  overallReferralTrend,
  type ProfoundReferralRow,
  type AiReferralByPage,
} from "./referral-signals";
import {
  aggregateBotCoverageByPage,
  findCrawlabilityGaps,
  summarizeBots,
  type ProfoundBotRow,
  type BotCoverageByPage,
  type CrawlabilityGap,
  type ValuablePage,
} from "./bot-coverage";

/**
 * load-profound-deep (2026-06-25, Sprint 6) — fail-soft, tenant-scoped readers for
 * the previously-DEAD Profound bot + referral tables, plus a composed signal view.
 * Read-only, $0 (already-synced rows). Empty tables → empty signal (honest).
 */

// uses the shared structured logger (log.warn)

export const loadProfoundReferralRows = cache(async (tenantId: string): Promise<ProfoundReferralRow[]> => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_referral_rows")
      .select("date, path, referral_source, referral_type, visits")
      .eq("tenant_id", tenantId)
      .limit(20000);
    if (error) {
      log.warn("referral read failed", { tenantId, error: error.message });
      return [];
    }
    return (data ?? []).map((r) => ({
      date: (r as { date?: string }).date ?? "",
      path: (r as { path?: string }).path ?? "",
      referralSource: (r as { referral_source?: string }).referral_source ?? "",
      referralType: (r as { referral_type?: string }).referral_type ?? "",
      visits: (r as { visits?: number }).visits ?? 0,
    }));
  } catch {
    return [];
  }
});

export const loadProfoundBotRows = cache(async (tenantId: string): Promise<ProfoundBotRow[]> => {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_bot_rows")
      .select("date, path, bot_name, bot_type, hit_count, citations")
      .eq("tenant_id", tenantId)
      .limit(20000);
    if (error) {
      log.warn("bot read failed", { tenantId, error: error.message });
      return [];
    }
    return (data ?? []).map((r) => ({
      date: (r as { date?: string }).date ?? "",
      path: (r as { path?: string }).path ?? "",
      botName: (r as { bot_name?: string }).bot_name ?? "",
      botType: (r as { bot_type?: string }).bot_type ?? "",
      hitCount: (r as { hit_count?: number }).hit_count ?? 0,
      citations: (r as { citations?: number }).citations ?? 0,
    }));
  } catch {
    return [];
  }
});

export type ProfoundDeepSignals = {
  hasData: boolean;
  referralsByPage: AiReferralByPage[];
  referralSummary: ReturnType<typeof summarizeReferrals>;
  referralTrend: ReturnType<typeof overallReferralTrend>;
  botCoverage: BotCoverageByPage[];
  botSummary: ReturnType<typeof summarizeBots>;
  crawlabilityGaps: CrawlabilityGap[];
};

/**
 * Composed deep-Profound signal view. Pass the tenant's valuable pages (GSC/demand)
 * to surface crawlability gaps. Fail-soft + $0.
 */
export async function loadProfoundDeepSignals(
  tenantId: string,
  valuablePages: ValuablePage[] = [],
): Promise<ProfoundDeepSignals> {
  const [referralRows, botRows] = await Promise.all([
    loadProfoundReferralRows(tenantId),
    loadProfoundBotRows(tenantId),
  ]);
  const referralsByPage = aggregateReferralsByPage(referralRows);
  const botCoverage = aggregateBotCoverageByPage(botRows);
  const crawlabilityGaps = findCrawlabilityGaps(botRows, valuablePages, { minValue: 1 });
  return {
    hasData: referralRows.length > 0 || botRows.length > 0,
    referralsByPage,
    referralSummary: summarizeReferrals(referralRows),
    referralTrend: overallReferralTrend(referralRows),
    botCoverage,
    botSummary: summarizeBots(botRows),
    crawlabilityGaps,
  };
}
