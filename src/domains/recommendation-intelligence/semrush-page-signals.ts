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
 *  the overlap region. Sources cited in the slice commit.
 *
 *  #339 — INTENTIONALLY WIDER than the first-party GSC striking band
 *  (4–15, in gsc-low-ctr.ts STRIKING_{MIN,MAX}_POS). The two are NOT
 *  meant to be the same number: third-party SEMrush position/volume is
 *  noisier than GSC's own impressions, so the wider 4–20 (the SEJ
 *  tooling default) is the right net for the weaker signal, whereas
 *  GSC uses the tighter 4–15 because its first-party demand data is
 *  clean. Aligning SEMrush down to 4–15 would drop positions 16–20 the
 *  SEJ default explicitly includes and contradict this band's sourcing
 *  — so the two stay deliberately distinct (documented, not unified).
 *  See the matching note on gsc-low-ctr.ts Rule B. */
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
  const rows: Row[] = [];
  try {
    const sb = getSupabaseAdmin();
    // audit wave-2 #3 (2026-06-14): PostgREST caps a single response at ~1000
    // rows regardless of .limit(), so the old `.limit(5000)` read silently
    // truncated a busy domain's keyword set to an arbitrary 1000 — and the
    // per-page grouping below then produced INCOMPLETE strikingDistance lists
    // (missing cards for any page whose keywords fell past the cut). Page
    // through in 1000-row chunks, stably ordered, under the safety bound.
    const PAGE = 1000;
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await sb
        .from("semrush_organic_keywords")
        .select("keyword, position, volume, url, difficulty, intent")
        .eq("tenant_id", tenantId)
        .order("url")
        .order("keyword")
        .range(from, from + PAGE - 1);
      if (error) {
        log.warn("[semrush-page-signals] read failed", {
          tenantId,
          error: error.message,
        });
        break;
      }
      const batch = (data ?? []) as unknown as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
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

// ── Cannibalization slice (2026-06-12) ───────────────────────────────

export type CannibalizationCase = {
  keyword: string;
  volume: number;
  intent: string | null;
  /** The better-ranking URL (lower position). */
  preferredUrl: string;
  preferredPosition: number;
  /** The competing own-URL that splits the keyword's equity. */
  cannibalUrl: string;
  cannibalPosition: number;
};

/**
 * Detect keyword cannibalization from the synced domain_organic rows:
 * the SAME keyword ranking >1 of the tenant's own URLs splits link
 * equity and confuses engines about the canonical page (Semrush
 * cannibalization guide — definition + the it's-fine-when-intent-
 * differs caveat is approximated by requiring the SAME stored intent
 * class on both rows; sources in the slice commit).
 *
 * domain_organic emits MULTIPLE rows per keyword when several of the
 * domain's URLs rank — the storage PK includes url (widened in the
 * cannibalization slice) precisely so those rows survive the upsert
 * and this detector can observe them.
 */
export function detectCannibalization(
  rows: ReadonlyArray<{
    keyword: string;
    position: number;
    volume: number;
    url: string;
    intent: string | null;
  }>,
): CannibalizationCase[] {
  const byKeyword = new Map<string, typeof rows[number][]>();
  for (const r of rows) {
    const list = byKeyword.get(r.keyword) ?? [];
    list.push(r);
    byKeyword.set(r.keyword, list);
  }
  const out: CannibalizationCase[] = [];
  for (const [keyword, list] of byKeyword) {
    const urls = new Map<string, typeof rows[number]>();
    for (const r of list) {
      const cur = urls.get(r.url);
      if (!cur || r.position < cur.position) urls.set(r.url, r);
    }
    if (urls.size < 2) continue;
    const sorted = [...urls.values()].sort((a, b) => a.position - b.position);
    const preferred = sorted[0]!;
    for (const cannibal of sorted.slice(1)) {
      // Same-intent requirement (different intent = legitimately
      // different pages per the Semrush guide).
      if ((preferred.intent ?? "") !== (cannibal.intent ?? "")) continue;
      out.push({
        keyword,
        volume: preferred.volume,
        intent: preferred.intent,
        preferredUrl: preferred.url,
        preferredPosition: preferred.position,
        cannibalUrl: cannibal.url,
        cannibalPosition: cannibal.position,
      });
    }
  }
  out.sort((a, b) => b.volume - a.volume);
  return out;
}

/** Raw keyword rows for the cannibalization detector (bounded read;
 *  fail-soft empty). Separate from the per-page aggregation so the
 *  detector sees every (keyword, url) pair. */
export async function loadSemrushCannibalRowsForTenant(
  tenantId: string,
): Promise<
  Array<{
    keyword: string;
    position: number;
    volume: number;
    url: string;
    intent: string | null;
  }>
> {
  type Row = {
    keyword: string;
    position: number;
    volume: number;
    url: string;
    intent: string | null;
  };
  // PostgREST caps a single response at ~1k rows regardless of `.limit()`,
  // so the old `.limit(5_000)` silently returned only ~1k arbitrary,
  // unordered rows — cannibalization detection (which needs EVERY
  // (keyword, url) pair to spot a keyword ranking on multiple URLs) saw an
  // incomplete subset on any site with >1k tracked keywords. Page through
  // with a stable unique order (keyword, url) until a short page or bound.
  const rows: Row[] = [];
  try {
    const sb = getSupabaseAdmin();
    const PAGE = 1_000;
    const MAX = 50_000;
    for (let offset = 0; offset < MAX; offset += PAGE) {
      const { data, error } = await sb
        .from("semrush_organic_keywords")
        .select("keyword, position, volume, url, intent")
        .eq("tenant_id", tenantId)
        .order("keyword")
        .order("url")
        .range(offset, offset + PAGE - 1);
      if (error) break;
      const batch = (data ?? []) as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
  } catch {
    return [];
  }
  return rows;
}

/** Gap rows for the keyword-gap trigger (bounded; fail-soft empty). */
export async function loadSemrushKeywordGapsForTenant(
  tenantId: string,
): Promise<
  Array<{
    keyword: string;
    competitor_domain: string;
    competitor_position: number;
    volume: number;
    difficulty: number | null;
  }>
> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("semrush_keyword_gaps")
      .select("keyword, competitor_domain, competitor_position, volume, difficulty")
      .eq("tenant_id", tenantId)
      // Deterministic 500-row cap: order by volume so the bound keeps the
      // HIGHEST-value gaps (not an arbitrary PostgREST slice).
      .order("volume", { ascending: false })
      .limit(500);
    if (error) return [];
    return (data ?? []) as Array<{
      keyword: string;
      competitor_domain: string;
      competitor_position: number;
      volume: number;
      difficulty: number | null;
    }>;
  } catch {
    return [];
  }
}
