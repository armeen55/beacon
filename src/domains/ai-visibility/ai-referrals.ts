import "server-only";

/**
 * AI-referral readers (2026-07-01, BEACON_500 item 6).
 *
 * Loads `ga4_ai_referral_daily` (written nightly by
 * src/lib/connectors/ga4/sync-ai-referrals.ts) and turns it into the number
 * that sells the AEO wedge: how many real visitors AI assistants sent, to
 * which pages, from which assistant. Request memoized with react cache()
 * like the sibling loaders (load-revenue, load-bot-referral-signals).
 *
 * Fail-soft: a missing table (PGRST205/PGRST204/42P01), a read error, or
 * zero rows all collapse to `hasData: false` with empty aggregates. NO
 * fabricated visits; consumers gate on hasData and stay silent at zero.
 *
 * Pinned by tests/domains/ai-visibility/ai-referrals.test.ts.
 */

import { cache } from "react";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { aiSourceLabel } from "@/lib/connectors/ga4/ai-sources";

const TABLE = "ga4_ai_referral_daily";
const DEFAULT_WINDOW_DAYS = 30;
const MAX_ROWS = 10_000;
const ONE_DAY_MS = 86_400_000;

export type AiReferralFact = {
  pagePath: string;
  /** YYYY-MM-DD. */
  day: string;
  /** Canonical assistant domain (e.g. "chatgpt.com"). */
  sourceDomain: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
};

export type AiReferralSourceSummary = {
  sourceDomain: string;
  /** Operator-facing name (e.g. "ChatGPT"). */
  label: string;
  sessions: number;
};

export type AiReferralPageSummary = {
  pagePath: string;
  sessions: number;
  engagedSessions: number;
  keyEvents: number;
  /** The assistant that sent this page the most sessions. */
  topSource: AiReferralSourceSummary | null;
};

export type AiReferralDayPoint = {
  day: string;
  sessions: number;
};

export type AiReferralSummary = {
  /** True only when at least one AI-referred session exists in the window. */
  hasData: boolean;
  windowDays: number;
  totalSessions: number;
  totalEngagedSessions: number;
  totalKeyEvents: number;
  /** Sessions per assistant, highest first. */
  bySource: AiReferralSourceSummary[];
  /** Pages by AI-referred sessions, highest first (capped at 10). */
  topPages: AiReferralPageSummary[];
  /** Per-day sessions, ascending by day. */
  byDay: AiReferralDayPoint[];
  /** Latest day with an AI-referred session, or null. */
  latestDay: string | null;
};

const EMPTY_BASE: Omit<AiReferralSummary, "windowDays"> = {
  hasData: false,
  totalSessions: 0,
  totalEngagedSessions: 0,
  totalKeyEvents: 0,
  bySource: [],
  topPages: [],
  byDay: [],
  latestDay: null,
};

export function emptyAiReferralSummary(windowDays: number): AiReferralSummary {
  return { ...EMPTY_BASE, windowDays };
}

/** Map a raw table row into a fact; null when malformed. Pure; exported for tests. */
export function mapAiReferralRow(raw: Record<string, unknown>): AiReferralFact | null {
  const pagePath = typeof raw.page_path === "string" ? raw.page_path : null;
  const day = typeof raw.day === "string" ? raw.day.slice(0, 10) : null;
  const sourceDomain = typeof raw.source_domain === "string" ? raw.source_domain : null;
  if (pagePath == null || day == null || sourceDomain == null) return null;
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : 0;
  };
  return {
    pagePath,
    day,
    sourceDomain,
    sessions: num(raw.sessions),
    engagedSessions: num(raw.engaged_sessions),
    keyEvents: num(raw.key_events),
  };
}

/** Aggregate facts into the summary shape. Pure; exported for tests. */
export function summarizeAiReferrals(
  facts: ReadonlyArray<AiReferralFact>,
  windowDays: number,
): AiReferralSummary {
  if (facts.length === 0) return emptyAiReferralSummary(windowDays);

  let totalSessions = 0;
  let totalEngagedSessions = 0;
  let totalKeyEvents = 0;
  const bySourceMap = new Map<string, number>();
  const byDayMap = new Map<string, number>();
  const byPageMap = new Map<
    string,
    { sessions: number; engagedSessions: number; keyEvents: number; perSource: Map<string, number> }
  >();
  let latestDay: string | null = null;

  for (const f of facts) {
    totalSessions += f.sessions;
    totalEngagedSessions += f.engagedSessions;
    totalKeyEvents += f.keyEvents;
    bySourceMap.set(f.sourceDomain, (bySourceMap.get(f.sourceDomain) ?? 0) + f.sessions);
    byDayMap.set(f.day, (byDayMap.get(f.day) ?? 0) + f.sessions);
    const page = byPageMap.get(f.pagePath) ?? {
      sessions: 0,
      engagedSessions: 0,
      keyEvents: 0,
      perSource: new Map<string, number>(),
    };
    page.sessions += f.sessions;
    page.engagedSessions += f.engagedSessions;
    page.keyEvents += f.keyEvents;
    page.perSource.set(f.sourceDomain, (page.perSource.get(f.sourceDomain) ?? 0) + f.sessions);
    byPageMap.set(f.pagePath, page);
    if (f.sessions > 0 && (latestDay == null || f.day > latestDay)) latestDay = f.day;
  }

  const toSourceSummary = (domain: string, sessions: number): AiReferralSourceSummary => ({
    sourceDomain: domain,
    label: aiSourceLabel(domain),
    sessions,
  });

  const bySource = [...bySourceMap.entries()]
    .map(([domain, sessions]) => toSourceSummary(domain, sessions))
    .sort((a, b) => b.sessions - a.sessions);

  const topPages = [...byPageMap.entries()]
    .map(([pagePath, agg]) => {
      const top = [...agg.perSource.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        pagePath,
        sessions: agg.sessions,
        engagedSessions: agg.engagedSessions,
        keyEvents: agg.keyEvents,
        topSource: top != null ? toSourceSummary(top[0], top[1]) : null,
      };
    })
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 10);

  const byDay = [...byDayMap.entries()]
    .map(([day, sessions]) => ({ day, sessions }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

  return {
    hasData: totalSessions > 0,
    windowDays,
    totalSessions,
    totalEngagedSessions,
    totalKeyEvents,
    bySource,
    topPages,
    byDay,
    latestDay,
  };
}

/** Shorten a page path for a one-line surface. Pure; exported for tests. */
export function shortAiReferralPath(pagePath: string): string {
  const p = (pagePath.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/\/$/, "") || "/";
  return p.length > 48 ? p.slice(0, 45) + "..." : p;
}

/**
 * The one Today line. Null at zero (silence is the honest state); otherwise
 * plain first-person business language with the concrete number, e.g.
 * "AI assistants sent you 214 visitors these 30 days, most from ChatGPT,
 * most to /iran-cheetah." Pure; exported for tests. No banned dashes.
 */
export function aiReferralTodayLine(summary: AiReferralSummary): string | null {
  if (!summary.hasData || summary.totalSessions <= 0) return null;
  const n = summary.totalSessions;
  let line = `AI assistants sent you ${n.toLocaleString("en-US")} visitor${n === 1 ? "" : "s"} these ${summary.windowDays} days`;
  const topSource = summary.bySource[0];
  if (topSource != null && topSource.sessions > 0) {
    line += `, most from ${topSource.label}`;
  }
  const topPage = summary.topPages[0];
  if (topPage != null && topPage.sessions > 0) {
    line += `, most to ${shortAiReferralPath(topPage.pagePath)}`;
  }
  return line + ".";
}

/** PostgREST "not in schema cache" or raw undefined-table -> treat as
 *  table-missing so a not-yet-migrated install degrades to empty, not crash. */
function isMissingTable(error: { code?: string } | null): boolean {
  const c = error?.code;
  return c === "PGRST205" || c === "PGRST204" || c === "42P01";
}

async function loadUncached(tenantId: string, windowDays: number): Promise<AiReferralSummary> {
  try {
    const db = getSupabaseAdmin();
    const cutoffMs =
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      ) -
      windowDays * ONE_DAY_MS;
    const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
    const { data, error } = await db
      .from(TABLE)
      .select("page_path, day, source_domain, sessions, engaged_sessions, key_events")
      .eq("tenant_id", tenantId)
      .gte("day", cutoff)
      .limit(MAX_ROWS);
    if (error != null) {
      if (!isMissingTable(error)) {
        log.warn("[ai-referrals] read failed", { tenantId, error: error.message });
      }
      return emptyAiReferralSummary(windowDays);
    }
    const facts = (data ?? [])
      .map((row) => mapAiReferralRow(row as Record<string, unknown>))
      .filter((f): f is AiReferralFact => f != null);
    return summarizeAiReferrals(facts, windowDays);
  } catch (e) {
    log.warn("[ai-referrals] loader threw; returning empty", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return emptyAiReferralSummary(windowDays);
  }
}

/**
 * Request-memoized per (tenantId, windowDays). Default window: 30 days,
 * matching the Today line's wording.
 */
export const loadAiReferralSummary = cache(
  async (tenantId: string, windowDays: number = DEFAULT_WINDOW_DAYS): Promise<AiReferralSummary> =>
    loadUncached(tenantId, windowDays),
);

/** Test-only export of internals. */
export const __testing = {
  TABLE,
  DEFAULT_WINDOW_DAYS,
  MAX_ROWS,
};
