import "server-only";

/**
 * GA4 AI-referral sync (2026-07-01, BEACON_500 item 6).
 *
 * The existing traffic sync pulls (date, pagePath) totals but never splits
 * `sessionSource`, so visitors arriving FROM ChatGPT / Perplexity / Gemini /
 * Copilot / Claude were invisible. This step runs a SEPARATE Data API report
 * dimensioned by sessionSource, keeps only AI assistant sources
 * (classifyAiSource), collapses variants ("chat.openai.com" + "chatgpt.com")
 * into canonical buckets, and upserts per-page per-day rows into
 * `ga4_ai_referral_daily`. That table is the substrate for the number that
 * sells the AEO wedge: "this page got 214 visitors from ChatGPT".
 *
 * Contract (mirrors sync-url-traffic.ts):
 *   - DORMANT-UNTIL-KEY: no token -> { synced:false, reason:"no_token" };
 *     token without a property -> { synced:false, reason:"no_property" }.
 *   - Fail-soft: report/persist failures return { synced:false, reason };
 *     the cron logs one line and continues. NEVER throws on documented paths.
 *   - ISOLATED from the traffic sync: separate report request, separate
 *     cron-sync step; a failure here can never slow or break traffic.
 *   - Idempotent: upsert on (tenant_id, page_path, day, source_domain);
 *     re-running a night is safe.
 *   - Bounded window: `days` back from today UTC (default 60), hard-capped
 *     at 420 days to match the traffic sync's retention posture.
 *
 * Pinned by tests/lib/connectors/ga4/sync-ai-referrals.test.ts.
 */

import { log } from "@/lib/logger";
import { getGoogleConnectorToken } from "@/lib/connector-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

import { classifyAiSource } from "./ai-sources";
import { runGa4AiReferralReport } from "./data-api";
import type { Ga4AiReferralRow } from "./types";

const TABLE = "ga4_ai_referral_daily";
const DEFAULT_DAYS = 60;
const MAX_DAYS = 420;
const ONE_DAY_MS = 86_400_000;

export type Ga4AiReferralSyncResult =
  | { synced: false; reason: string }
  | {
      synced: true;
      property: string;
      /** Raw (date, pagePath, sessionSource) rows GA4 returned pre-classification. */
      rows_fetched: number;
      /** Canonical (page, day, source_domain) rows upserted after classification. */
      rows_upserted: number;
      /** Total AI-referred sessions across the upserted rows. */
      sessions: number;
      /** Distinct canonical source domains seen (e.g. ["chatgpt.com"]). */
      sources: string[];
      /** True when the underlying report was a partial (paginated) pull. */
      truncated?: boolean;
    };

/** One canonical row bound for `ga4_ai_referral_daily`. */
export type AiReferralUpsertRow = {
  tenant_id: string;
  page_path: string;
  day: string;
  source_domain: string;
  sessions: number;
  engaged_sessions: number;
  key_events: number;
  last_synced_at: string;
};

/**
 * Classify + aggregate raw GA4 rows into canonical upsert rows. Rows whose
 * sessionSource is NOT an AI assistant are dropped (the request-side filter
 * over-fetches by design); variants of the same assistant on the same
 * (page, day) are summed into one row. Pure; exported for tests.
 */
export function aggregateAiReferralRows(args: {
  rows: ReadonlyArray<Ga4AiReferralRow>;
  tenantId: string;
  nowIso: string;
}): AiReferralUpsertRow[] {
  const byKey = new Map<string, AiReferralUpsertRow>();
  for (const row of args.rows) {
    const source = classifyAiSource(row.sessionSource);
    if (source == null) continue;
    const pagePath = row.pagePath.trim() === "" ? "/" : row.pagePath.trim();
    const key = `${pagePath}\n${row.date}\n${source.domain}`;
    const existing = byKey.get(key);
    if (existing != null) {
      existing.sessions += row.sessions;
      existing.engaged_sessions += row.engaged_sessions;
      existing.key_events += row.key_events;
    } else {
      byKey.set(key, {
        tenant_id: args.tenantId,
        page_path: pagePath,
        day: row.date,
        source_domain: source.domain,
        sessions: row.sessions,
        engaged_sessions: row.engaged_sessions,
        key_events: row.key_events,
        last_synced_at: args.nowIso,
      });
    }
  }
  return [...byKey.values()];
}

/** Compute the inclusive [startDate, endDate] window: `days` back from today
 *  UTC, capped at MAX_DAYS. Pure; exported for tests. */
export function computeAiReferralDateRange(
  days: number,
  now: Date,
): { startDate: string; endDate: string } {
  const todayUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const boundedDays = Math.min(Math.max(Math.trunc(days), 1), MAX_DAYS);
  return {
    startDate: new Date(todayUtcMs - boundedDays * ONE_DAY_MS).toISOString().slice(0, 10),
    endDate: new Date(todayUtcMs).toISOString().slice(0, 10),
  };
}

/**
 * Pull AI-referral sessions for one tenant and upsert them into
 * `ga4_ai_referral_daily`. Dormant until a GA4 key + property exist.
 */
export async function pullGa4AiReferralsForTenant(args: {
  tenantId: string;
  days?: number;
  now?: Date;
}): Promise<Ga4AiReferralSyncResult> {
  const { tenantId } = args;
  const now = args.now ?? new Date();

  const token = await getGoogleConnectorToken("ga4", tenantId);
  if (token == null) {
    return { synced: false, reason: "no_token" };
  }
  const propertyId = token.ga4_property_id;
  if (propertyId == null || propertyId === "") {
    return { synced: false, reason: "no_property" };
  }

  const { startDate, endDate } = computeAiReferralDateRange(args.days ?? DEFAULT_DAYS, now);
  const report = await runGa4AiReferralReport({ tenantId, propertyId, startDate, endDate });
  if (!report.ok) {
    return { synced: false, reason: report.reason };
  }

  const upsertRows = aggregateAiReferralRows({
    rows: report.rows,
    tenantId,
    nowIso: now.toISOString(),
  });

  if (upsertRows.length === 0) {
    // Honest zero: the report ran and found no AI-referred sessions in the
    // window. Still a successful sync (idempotent no-op).
    return {
      synced: true,
      property: propertyId,
      rows_fetched: report.rows.length,
      rows_upserted: 0,
      sessions: 0,
      sources: [],
      ...(report.truncated ? { truncated: true } : {}),
    };
  }

  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch (e) {
    log.warn("[ga4-ai-referrals] Supabase admin unavailable", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return { synced: false, reason: "admin_unavailable" };
  }

  const { error } = await admin
    .from(TABLE)
    .upsert(upsertRows, { onConflict: "tenant_id,page_path,day,source_domain" });
  if (error != null) {
    log.warn("[ga4-ai-referrals] upsert failed", {
      tenantId,
      rowsAttempted: upsertRows.length,
      error: typeof error.message === "string" ? error.message : "upsert failed",
      code: (error as { code?: unknown }).code,
    });
    return { synced: false, reason: "persist_failed" };
  }

  const sessions = upsertRows.reduce((sum, r) => sum + r.sessions, 0);
  const sources = [...new Set(upsertRows.map((r) => r.source_domain))].sort();
  if (report.truncated) {
    log.warn("[ga4-ai-referrals] report truncated; stored a PARTIAL window", {
      tenantId,
      property: propertyId,
      rows_fetched: report.rows.length,
    });
  }
  return {
    synced: true,
    property: propertyId,
    rows_fetched: report.rows.length,
    rows_upserted: upsertRows.length,
    sessions,
    sources,
    ...(report.truncated ? { truncated: true } : {}),
  };
}

/** Test-only export of internals. */
export const __testing = {
  TABLE,
  DEFAULT_DAYS,
  MAX_DAYS,
};
