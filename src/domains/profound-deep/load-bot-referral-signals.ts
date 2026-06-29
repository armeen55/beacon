import "server-only";
import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import {
  aggregateBotCoverageByPage,
  summarizeBots,
  type ProfoundBotRow,
  type BotCoverageByPage,
} from "./bot-coverage";
import {
  aggregateReferralsByPage,
  summarizeReferrals,
  overallReferralTrend,
  type ProfoundReferralRow,
  type AiReferralByPage,
} from "./referral-signals";

/**
 * load-bot-referral-signals (2026-06-28) — the I/O EDGE that turns the
 * `profound_bot_rows` + `profound_referral_rows` tables (synced by the Profound
 * connector, previously DEAD with zero readers) into the pure bot-coverage /
 * referral-signal aggregates so the product can show real AI-crawler + AI-referral
 * signals — per page, with freshness.
 *
 * CACHED per request (react.cache), tenant-scoped, NO live Profound API. Fail-soft:
 * a missing table / read error / EMPTY rows all collapse to `hasData: false` with
 * empty aggregates (NO fabricated "AI visits" — honest absence). Consumers must gate
 * on `hasData` and render nothing when false.
 *
 * NOTE (2026-06-28 ground truth): these tables are currently EMPTY for Iranopedia
 * (0 rows) AND across all tenants — the borrowed Profound workspace tracks OpenAI's
 * prompts, not iranopedia.com's own crawler/referral logs (Agent Analytics is the
 * site-scoped feed that would populate them). This loader + the pure modules are the
 * complete, dormant substrate: the moment a site-scoped Profound workspace is
 * connected and synced, every consumer lights up with zero further code.
 */

export type BotReferralSignals = {
  /** True only when at least one bot OR referral row exists for the tenant. */
  hasData: boolean;
  hasBotData: boolean;
  hasReferralData: boolean;
  botByPath: BotCoverageByPage[];
  referralByPath: AiReferralByPage[];
  botSummary: ReturnType<typeof summarizeBots>;
  referralSummary: ReturnType<typeof summarizeReferrals>;
  referralTrend: ReturnType<typeof overallReferralTrend>;
  /** Latest observed date across both feeds (ISO yyyy-mm-dd), or null. */
  latestDate: string | null;
  /** Raw rows (for proof before/after windows — referralOutcomeForPage). */
  referralRows: ProfoundReferralRow[];
  botRows: ProfoundBotRow[];
};

const EMPTY: BotReferralSignals = {
  hasData: false,
  hasBotData: false,
  hasReferralData: false,
  botByPath: [],
  referralByPath: [],
  botSummary: { totalHits: 0, pages: 0, topBots: [] },
  referralSummary: { totalVisits: 0, pages: 0, topSources: [] },
  referralTrend: { direction: "unknown", recentVisits: 0, priorVisits: 0 },
  latestDate: null,
  referralRows: [],
  botRows: [],
};

/** PostgREST "table/column not in schema cache" (PGRST205/PGRST204) or raw 42P01 →
 *  treat as table-missing so a not-yet-migrated install degrades to empty, not crash. */
function isMissingTable(error: { code?: string } | null): boolean {
  const c = error?.code;
  return c === "PGRST205" || c === "PGRST204" || c === "42P01";
}

async function loadUncached(tenantId: string): Promise<BotReferralSignals> {
  const db = getSupabaseAdmin();
  let botRows: ProfoundBotRow[] = [];
  let referralRows: ProfoundReferralRow[] = [];

  try {
    const { data, error } = await db
      .from("profound_bot_rows")
      .select("date, path, bot_name, bot_type, hit_count, citations")
      .eq("tenant_id", tenantId);
    if (error && !isMissingTable(error)) {
      log.warn("[bot-referral] bot read failed", { tenantId, error: error.message });
    } else if (data) {
      botRows = data.map((r) => ({
        date: String(r.date ?? ""),
        path: String(r.path ?? ""),
        botName: String(r.bot_name ?? ""),
        botType: String(r.bot_type ?? ""),
        hitCount: Number(r.hit_count ?? 0),
        citations: Number(r.citations ?? 0),
      }));
    }
  } catch (e) {
    log.warn("[bot-referral] bot read threw", { tenantId, error: e instanceof Error ? e.message : "?" });
  }

  try {
    const { data, error } = await db
      .from("profound_referral_rows")
      .select("date, path, referral_source, referral_type, visits")
      .eq("tenant_id", tenantId);
    if (error && !isMissingTable(error)) {
      log.warn("[bot-referral] referral read failed", { tenantId, error: error.message });
    } else if (data) {
      referralRows = data.map((r) => ({
        date: String(r.date ?? ""),
        path: String(r.path ?? ""),
        referralSource: String(r.referral_source ?? ""),
        referralType: String(r.referral_type ?? ""),
        visits: Number(r.visits ?? 0),
      }));
    }
  } catch (e) {
    log.warn("[bot-referral] referral read threw", { tenantId, error: e instanceof Error ? e.message : "?" });
  }

  return assembleBotReferralSignals(botRows, referralRows);
}

/** Pure assembler — rows → signals. Empty rows → EMPTY (hasData:false), never a
 *  fabricated signal. Exported so the empty/populated contract is unit-testable
 *  without a DB. PURE. */
export function assembleBotReferralSignals(
  botRows: ProfoundBotRow[],
  referralRows: ProfoundReferralRow[],
): BotReferralSignals {
  if (botRows.length === 0 && referralRows.length === 0) return EMPTY;

  const dates = [...botRows.map((r) => r.date), ...referralRows.map((r) => r.date)].filter(Boolean);
  const latestDate = dates.length ? dates.reduce((a, b) => (b > a ? b : a)) : null;

  return {
    hasData: true,
    hasBotData: botRows.length > 0,
    hasReferralData: referralRows.length > 0,
    botByPath: aggregateBotCoverageByPage(botRows),
    referralByPath: aggregateReferralsByPage(referralRows),
    botSummary: summarizeBots(botRows),
    referralSummary: summarizeReferrals(referralRows),
    referralTrend: overallReferralTrend(referralRows),
    latestDate,
    referralRows,
    botRows,
  };
}

/** Cached per-request loader. Fail-soft → EMPTY (hasData:false). */
export const loadBotReferralSignals = cache(
  async (tenantId: string): Promise<BotReferralSignals> => {
    try {
      return await loadUncached(tenantId);
    } catch (e) {
      log.warn("[bot-referral] load failed", { tenantId, error: e instanceof Error ? e.message : "?" });
      return EMPTY;
    }
  },
);
