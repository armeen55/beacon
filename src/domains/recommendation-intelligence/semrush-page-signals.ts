/**
 * Insight Graph slice 2 (2026-06-12) — per-page SEMrush keyword
 * signals. Groups the tenant's synced `semrush_organic_keywords`
 * rows by ranking URL into one signal per page — the pure input the
 * striking-distance predicate consumes (same pattern as
 * gsc-page-signals / indexability batch).
 *
 * Fail-soft: missing table / no rows / error → empty Map.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

export type SemrushKeywordSignal = {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number | null;
  intent: string | null;
};

export type SemrushPageSignal = {
  page: string;
  /** All ranked keywords for the page, best position first. */
  keywords: SemrushKeywordSignal[];
  /** Keywords in the striking-distance band (4–20), volume desc. */
  strikingDistance: SemrushKeywordSignal[];
};

/** Striking-distance band — union of credible practitioner bands
 *  (SEJ tooling 4–20; Backlinko 8–20; Semrush 11–30): 4–20 sits in
 *  the overlap region. Sources cited in the slice commit. */
export const STRIKING_DISTANCE_MIN = 4;
export const STRIKING_DISTANCE_MAX = 20;
/** Small-site volume floor from the research spec. */
export const MIN_VOLUME = 10;

const MAX_ROWS = 5_000;

export async function loadSemrushPageSignalsForTenant(
  tenantId: string,
): Promise<Map<string, SemrushPageSignal>> {
  const out = new Map<string, SemrushPageSignal>();
  type Row = {
    keyword: string;
    position: number;
    volume: number;
    url: string;
    difficulty: number | null;
    intent: string | null;
  };
  let rows: Row[] = [];
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("semrush_organic_keywords")
      .select("keyword, position, volume, url, difficulty, intent")
      .eq("tenant_id", tenantId)
      .limit(MAX_ROWS);
    if (error) {
      log.warn("[semrush-page-signals] read failed", {
        tenantId,
        error: error.message,
      });
      return out;
    }
    rows = (data ?? []) as unknown as Row[];
  } catch {
    return out;
  }
  if (rows.length === 0) return out;

  const byPage = new Map<string, SemrushKeywordSignal[]>();
  for (const r of rows) {
    const page = canonicalizeCitationUrl(r.url) ?? r.url;
    let list = byPage.get(page);
    if (!list) {
      list = [];
      byPage.set(page, list);
    }
    list.push({
      keyword: r.keyword,
      position: r.position,
      volume: r.volume ?? 0,
      difficulty: r.difficulty,
      intent: r.intent,
    });
  }

  for (const [page, keywords] of byPage) {
    keywords.sort((a, b) => a.position - b.position);
    const strikingDistance = keywords
      .filter(
        (k) =>
          k.position >= STRIKING_DISTANCE_MIN &&
          k.position <= STRIKING_DISTANCE_MAX &&
          k.volume >= MIN_VOLUME,
      )
      .sort((a, b) => b.volume - a.volume);
    out.set(page, { page, keywords, strikingDistance });
  }
  return out;
}
