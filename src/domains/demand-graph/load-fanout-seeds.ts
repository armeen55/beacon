import "server-only";
import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { summarizeFanouts, type FanoutRow, type FanoutSeed } from "@/lib/connectors/profound/summarize-fanouts";
import { loadNativeIntelForTenant } from "@/domains/ai-visibility/native-intel-loader";

/**
 * load-fanout-seeds (2026-06-25, Phase 5; native source added 2026-07-02,
 * DREAM SITE V1 item D1), the fanout INPUT loader every content Move,
 * evidence packet, and the FAQ drafter reads from.
 *
 * The fanout wedge was starved: the whole output pipeline (evidence-packet, FAQ
 * drafter) consumes fanout seeds, but the demand graph's DemandInput.fanoutSubQueries
 * was always []. This reads the synced profound_fanout_rows, runs summarizeFanouts,
 * and produces ranked sub-queries, so content Moves can be grounded in the actual AI
 * sub-questions, not just GSC/SEMrush. Request-cached + fail-soft (-> []). Honest
 * empty state when no fanouts are synced (NEVER fabricated).
 *
 * D1: Profound is not the only source of real AI sub-questions anymore. The
 * native 4-engine poll's own answers raise their own follow-up questions
 * (native-intel.ts's rollUpNativeQuestions: question-mark sentences and
 * "people also ask"-style structures extracted straight from the answer
 * text, no LLM). Those are merged in here as an ADDITIVE, source-tagged
 * second source: same FanoutSeed shape, `source: "native"` instead of
 * "profound", deduped against the Profound set by normalized sub-query text
 * so the same real question surfaced by both sources counts once, weight
 * summed. Every consumer of loadFanoutSeedsForTenant (the demand graph,
 * evidence packets, keyword research, the FAQ drafter) gets native fanouts
 * for free with no call-site change.
 */

export type { FanoutSeed };

export const loadFanoutSeedsForTenant = cache(loadFanoutSeedsImpl);

function normSubQuery(text: string): string {
  return text.trim().toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ");
}

/** Merge Profound fanout seeds with native question-expansion seeds. Same
 *  sub-query (normalized) collapses into ONE seed: weight summed, prompts
 *  unioned, source stays "profound" when the question exists in both (the
 *  Profound seed is the more authoritative original source; "native" only
 *  when Beacon's own poll is the sole source of that question). Pure. */
export function mergeFanoutSources(
  profoundSeeds: readonly FanoutSeed[],
  nativeSeeds: readonly FanoutSeed[],
): FanoutSeed[] {
  const byKey = new Map<string, FanoutSeed>();
  for (const seed of profoundSeeds) {
    const key = normSubQuery(seed.subQuery);
    if (!key) continue;
    byKey.set(key, { ...seed, source: "profound" });
  }
  for (const seed of nativeSeeds) {
    const key = normSubQuery(seed.subQuery);
    if (!key) continue;
    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        weight: existing.weight + seed.weight,
        prompts: [...new Set([...existing.prompts, ...seed.prompts])],
      });
    } else {
      byKey.set(key, { ...seed, source: "native" });
    }
  }
  return [...byKey.values()].sort((a, b) => b.weight - a.weight || a.subQuery.localeCompare(b.subQuery));
}

async function loadNativeFanoutSeeds(tenantId: string): Promise<FanoutSeed[]> {
  try {
    const report = await loadNativeIntelForTenant(tenantId);
    return report.nativeQuestions.map((q) => ({
      subQuery: q.text,
      weight: q.weight,
      prompts: q.sourcePrompts,
      source: "native" as const,
    }));
  } catch (e) {
    log.warn("[fanout-seeds] native question read failed (fail-soft)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

async function loadFanoutSeedsImpl(tenantId: string, limit = 200): Promise<FanoutSeed[]> {
  if (!tenantId) return [];
  const profoundSeeds = await loadProfoundFanoutSeeds(tenantId);
  const nativeSeeds = await loadNativeFanoutSeeds(tenantId);
  const merged = mergeFanoutSources(profoundSeeds, nativeSeeds);
  return limit != null ? merged.slice(0, limit) : merged;
}

async function loadProfoundFanoutSeeds(tenantId: string): Promise<FanoutSeed[]> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("profound_fanout_rows")
      .select("dims, mets")
      .eq("tenant_id", tenantId)
      .limit(5000);
    if (error) {
      // Missing table / schema cache = "no fanouts yet", not an error to shout.
      if (error.code !== "42P01" && error.code !== "PGRST205") {
        log.warn("[fanout-seeds] read failed", { tenantId, error: error.message });
      }
      return [];
    }
    const rows = (data ?? []) as unknown as FanoutRow[];
    if (rows.length === 0) return []; // honest empty, no fanouts synced for this tenant
    return summarizeFanouts(rows);
  } catch (e) {
    log.warn("[fanout-seeds] read threw", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

const STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "what", "how", "why", "when", "where", "who", "best", "vs", "with", "your",
]);
function toks(s: string): Set<string> {
  return new Set(
    (s || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t)),
  );
}

/**
 * Pure: attach the most relevant fanout sub-queries to a demand node by token
 * overlap with its label/queries. Returns the top `per` seeds (by weight) that
 * share ≥1 significant token. Empty when nothing matches — never invents.
 */
export function fanoutSeedsForNode(
  label: string,
  queries: readonly string[],
  seeds: readonly FanoutSeed[],
  per = 6,
): string[] {
  if (seeds.length === 0) return [];
  const nodeToks = toks([label, ...queries].join(" "));
  if (nodeToks.size === 0) return [];
  const matched: { sub: string; weight: number }[] = [];
  for (const s of seeds) {
    const st = toks(s.subQuery);
    let shared = 0;
    for (const t of st) if (nodeToks.has(t)) shared += 1;
    if (shared >= 1) matched.push({ sub: s.subQuery, weight: s.weight });
  }
  matched.sort((a, b) => b.weight - a.weight);
  return [...new Set(matched.map((m) => m.sub))].slice(0, per);
}
