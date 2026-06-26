import "server-only";
import { cache } from "react";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { summarizeFanouts, type FanoutRow, type FanoutSeed } from "@/lib/connectors/profound/summarize-fanouts";

/**
 * load-fanout-seeds (2026-06-25, Phase 5) — the Profound fanout INPUT loader.
 *
 * The fanout wedge was starved: the whole output pipeline (evidence-packet, FAQ
 * drafter) consumes fanout seeds, but the demand graph's DemandInput.fanoutSubQueries
 * was always []. This reads the synced profound_fanout_rows → summarizeFanouts →
 * ranked sub-queries, so content Moves can be grounded in the actual AI sub-
 * questions, not just GSC. Request-cached + fail-soft (→ []). Honest empty
 * state when no fanouts are synced (NEVER fabricated).
 */

export type { FanoutSeed };

export const loadFanoutSeedsForTenant = cache(loadFanoutSeedsImpl);

async function loadFanoutSeedsImpl(tenantId: string, limit = 200): Promise<FanoutSeed[]> {
  if (!tenantId) return [];
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
    if (rows.length === 0) return []; // honest empty — no fanouts synced for this tenant
    return summarizeFanouts(rows, { limit });
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
