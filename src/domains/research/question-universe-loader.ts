import "server-only";

import { cache } from "react";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { loadTopTenantQueriesWithOwner } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { loadBackOfResultsRegister } from "@/domains/gsc/load-back-of-results";
import { loadFanoutSeedsForTenant } from "@/domains/demand-graph/load-fanout-seeds";
import { loadTenantQuestionLibrary } from "@/domains/ai-visibility/tenant-question-library";
import { featureStealHistoryRows } from "@/domains/serp/serp-history";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { resolveOwner } from "@/domains/ownership/registry";

import {
  buildQuestionUniverse,
  MAX_UNIVERSE_ROWS,
  type OwnerPageExtract,
  type QuestionUniverse,
  type UniverseQuestionRow,
} from "./question-universe";

/**
 * question-universe-loader (2026-07-03, BEACON_500 R11 / N30) - the I/O
 * boundary for research/question-universe.ts. Reads the four question-shaped
 * demand sources Beacon ALREADY stores ($0 - no new paid call anywhere here):
 *
 *   gsc          loadTopTenantQueriesWithOwner (gsc_daily_rows, 90d window)
 *   ai_fanout    loadFanoutSeedsForTenant (profound_fanout_rows + native poll)
 *   native_poll  loadTenantQuestionLibrary (tracked_prompts)
 *   paa          featureStealHistoryRows (dataforseo_serp_history paa_questions)
 *
 * plus the N2 ownership registry (who owns each question) and a bounded
 * page_snapshots extract read for the owner pages (headings + stored FAQ
 * questions + body sample) so coverage is checked against the pages' REAL
 * stored text, never guessed.
 *
 * Persisted to the "question-universe" json-store (GLOBAL classification,
 * rows carry tenant_id - written by the nightly cron fan-out with no request
 * context, same rationale as app-errors; Supabase-mirrored so the nightly
 * build survives Vercel lambda recycling). Rebuilt nightly as one isolated
 * fail-soft cron phase; consumers read the persisted rows and self-hide when
 * the store is empty.
 */

export const QUESTION_UNIVERSE_STORE = "question-universe";

/** Bound the inputs so one nightly build stays cheap and deterministic. */
const GSC_QUERY_LIMIT = 1000;
const FANOUT_LIMIT = 200;
/** At most this many owner pages get an extract read per build. */
const MAX_OWNER_EXTRACT_PAGES = 80;

type OwnedExtractRow = {
  url: string;
  h2_list: string[] | null;
  body_paragraph_sample: string[] | null;
  card_texts: string[] | null;
  faqs: { question?: string }[] | null;
};

/** Bounded page_snapshots extract read for a fixed URL set. Fail-soft -> {}.
 *  Keys are lowercased URLs (the pure module's ownerExtracts convention). */
async function readOwnerExtracts(tenantId: string, urls: readonly string[]): Promise<Map<string, OwnerPageExtract>> {
  const out = new Map<string, OwnerPageExtract>();
  const wanted = [...new Set(urls.filter(Boolean))].slice(0, MAX_OWNER_EXTRACT_PAGES);
  if (!isSupabaseConfigured() || wanted.length === 0) return out;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("page_snapshots")
      .select("url, h2_list, body_paragraph_sample, card_texts, faqs, fetched_at")
      .eq("tenant_id", tenantId)
      .in("url", wanted)
      .order("fetched_at", { ascending: false })
      .limit(wanted.length * 3);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as OwnedExtractRow[]) {
      const key = (r.url ?? "").toLowerCase();
      if (!key || out.has(key)) continue; // newest snapshot per URL wins (rows arrive newest first)
      const body = [...(r.body_paragraph_sample ?? []), ...(r.card_texts ?? [])].join(" ").trim();
      out.set(key, {
        url: r.url,
        headings: (r.h2_list ?? []).filter(Boolean),
        faqQuestions: (r.faqs ?? []).map((f) => f?.question ?? "").filter(Boolean),
        bodyText: body || null,
      });
    }
    return out;
  } catch (e) {
    log.warn("[question-universe] owner extract read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return out;
  }
}

/**
 * Build the full universe for one tenant from live source reads (no persist).
 * Two passes: pass 1 (no extracts) learns which pages own the questions; a
 * bounded extract read then feeds pass 2 so coverage is checked against the
 * owners' real stored text. Every source is individually fail-soft: a dead
 * source narrows the universe, it never empties it.
 */
export async function buildQuestionUniverseForTenant(tenantId: string): Promise<QuestionUniverse> {
  if (!tenantId) return { rows: [], stats: emptyStats() };

  const [gscQueries, backOfResults, fanoutSeeds, library, serpRows, registry] = await Promise.all([
    loadTopTenantQueriesWithOwner(tenantId, { limit: GSC_QUERY_LIMIT }).catch(() => []),
    // R17b (v1 428): the deep-rank register (position 30-100, real
    // impressions) as one more demand source. Fail-soft null = no lane.
    loadBackOfResultsRegister(tenantId).catch(() => null),
    loadFanoutSeedsForTenant(tenantId, FANOUT_LIMIT).catch(() => []),
    loadTenantQuestionLibrary(tenantId).catch(() => []),
    featureStealHistoryRows(tenantId).catch(() => []),
    loadOwnershipRegistryForTenant(tenantId).catch(() => null),
  ]);

  const paaQuestions = serpRows.flatMap((r) => r.paaQuestions.map((q) => ({ question: q.question })));
  const resolveOwnerFor = registry ? (q: string) => resolveOwner(registry, q)?.owner ?? null : null;

  // Deep-rank lane, deduped against the primary gsc lane by normalized text
  // (both read gsc_daily_rows, so a shared query must not double-count its
  // impressions - the pure module documents this loader-side contract).
  const seenGscQueries = new Set(gscQueries.map((q) => q.query.trim().toLowerCase()));
  const backOfResultsInputs = (backOfResults?.queries ?? [])
    .filter((q) => !seenGscQueries.has(q.query.trim().toLowerCase()))
    .map((q) => ({
      query: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      ownerPage: q.ownerPage,
    }));

  const baseArgs = {
    tenantId,
    gscQueries: gscQueries.map((q) => ({
      query: q.query,
      impressions: q.impressions,
      clicks: q.clicks,
      ownerPage: q.ownerPage,
    })),
    backOfResults: backOfResultsInputs,
    fanoutSeeds: fanoutSeeds.map((s) => ({ subQuery: s.subQuery, weight: s.weight })),
    nativeLibrary: library.map((l) => ({ text: l.prompt_text })),
    paaQuestions,
    resolveOwnerFor,
  };

  const pass1 = buildQuestionUniverse(baseArgs);
  const ownerUrls = [...new Set(pass1.rows.map((r) => r.ownership).filter((u): u is string => !!u))];
  const ownerExtracts = await readOwnerExtracts(tenantId, ownerUrls);
  if (ownerExtracts.size === 0) return pass1;
  return buildQuestionUniverse({ ...baseArgs, ownerExtracts });
}

function emptyStats(): QuestionUniverse["stats"] {
  return {
    total: 0,
    bySource: { gsc: 0, ai_fanout: 0, native_poll: 0, paa: 0 },
    answered: 0,
    partial: 0,
    notAnswered: 0,
    unchecked: 0,
    mergedAway: 0,
  };
}

export type QuestionUniverseRebuildResult = {
  tenantId: string;
  rows: number;
  uncovered: number;
  stats: QuestionUniverse["stats"];
};

/**
 * The nightly cron phase entry: rebuild the universe from sources and persist
 * it, replacing ONLY this tenant's rows in the shared store (other tenants'
 * rows are untouched). Never throws - the cron phase catch stays a formality.
 */
export async function rebuildQuestionUniverseForTenant(tenantId: string): Promise<QuestionUniverseRebuildResult> {
  const universe = await buildQuestionUniverseForTenant(tenantId);
  try {
    const all = await readStore<UniverseQuestionRow>(QUESTION_UNIVERSE_STORE, []);
    const others = all.filter((r) => r.tenant_id !== tenantId);
    await writeStore(QUESTION_UNIVERSE_STORE, [...others, ...universe.rows.slice(0, MAX_UNIVERSE_ROWS)]);
  } catch (e) {
    log.warn("[question-universe] persist failed (universe still built in-memory)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
  }
  return {
    tenantId,
    rows: universe.rows.length,
    uncovered: universe.stats.notAnswered + universe.stats.partial,
    stats: universe.stats,
  };
}

/**
 * The consumer read: this tenant's persisted universe rows, best-first (they
 * are persisted pre-ranked). Empty when the nightly phase has not built one
 * yet - every consumer treats empty as "feature silent" (self-hiding section,
 * byte-identical drafter input). React cache()-d per request. Never throws.
 */
export const loadQuestionUniverseForTenant = cache(async (tenantId: string): Promise<UniverseQuestionRow[]> => {
  if (!tenantId) return [];
  try {
    const all = await readStore<UniverseQuestionRow>(QUESTION_UNIVERSE_STORE, []);
    return all
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.priority - a.priority || b.demandScore - a.demandScore || a.question.localeCompare(b.question));
  } catch (e) {
    log.warn("[question-universe] read failed (fail-soft to empty)", {
      tenantId,
      error: e instanceof Error ? e.message.slice(0, 200) : String(e),
    });
    return [];
  }
});
