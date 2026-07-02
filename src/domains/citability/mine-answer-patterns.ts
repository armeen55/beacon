/**
 * mine-answer-patterns (2026-07-02, master plan item 26) - learn what AI
 * actually quotes. Mines the REAL answer texts already sitting in Supabase
 * (`prompt_answer_observations` + `answer_texts`, the answer-text-bearing
 * tables) for the sentence containing or immediately preceding each citation
 * of ANY domain, classifies that sentence into a quotable-pattern bucket with
 * pure regex/token heuristics (no LLM at mining time), and aggregates which
 * patterns dominate real citations in this tenant's space.
 *
 * Table shapes verified against migrations/2026-05-08_baseline_schema.sql:
 *   - prompt_answer_observations: id, tenant_id, citation_urls (text[],
 *     parallel to citation_domains), citation_domains (text[]), NO answer
 *     text column itself.
 *   - answer_texts: observation_id (FK to prompt_answer_observations.id),
 *     body (text) - the actual answer text. NO tenant_id column; tenant
 *     scoping happens through the observations join.
 *   - profound_citation_rows: aggregated citation COUNTS only (date, model,
 *     root_domain, url, citation_count) - no answer text at all, so it
 *     cannot feed sentence mining; it is not read here.
 *
 * Bounded paged reads: this Supabase project caps EVERY response at 1000
 * rows regardless of `.limit()`, so every read below loops with `.range()`
 * in PAGE_SIZE chunks (the repo convention, see
 * src/lib/persistence/repositories/supabase-backend.ts `queryAllPaged`).
 *
 * $0: reads existing tables only, no paid calls, no LLM.
 */

import "server-only";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { log } from "@/lib/logger";
import { ALL_PATTERN_BUCKETS, findCitedSentences, type CitationPatternBucket } from "./pattern-classifier";

export type { CitationPatternBucket } from "./pattern-classifier";
export { classifySentence, splitIntoSentences, findCitedSentences, ALL_PATTERN_BUCKETS } from "./pattern-classifier";

/** PostgREST's hard per-response cap on this Supabase project (repo-wide
 *  convention: page every large table in chunks of exactly this size). */
export const PAGE_SIZE = 1000;

/** Hard ceiling on observation rows read per mining run (cost/time bound;
 *  ~12k rows exist today, this covers the whole table with headroom). */
export const MAX_OBSERVATION_ROWS = 20_000;

// ---------------------------------------------------------------------------
// Bounded paged reads over the answer-text-bearing tables ($0, existing data)
// ---------------------------------------------------------------------------

type ObservationRow = {
  id: string;
  citation_urls: string[] | null;
  citation_domains: string[] | null;
};

type AnswerTextRow = {
  observation_id: string;
  body: string;
};

/**
 * Page through `prompt_answer_observations` for one tenant, projected to just
 * the citation columns (lean read), in PAGE_SIZE chunks until exhausted or
 * MAX_OBSERVATION_ROWS is hit. Only rows with at least one citation are worth
 * reading further (an uncited answer has nothing to mine), but the citation
 * columns are cheap enough to always project.
 */
async function pageObservations(tenantId: string): Promise<ObservationRow[]> {
  const sb = getSupabaseAdmin();
  const out: ObservationRow[] = [];
  let from = 0;
  for (;;) {
    if (out.length >= MAX_OBSERVATION_ROWS) break;
    const { data, error } = await sb
      .from("prompt_answer_observations")
      .select("id, citation_urls, citation_domains")
      .eq("tenant_id", tenantId)
      .gt("citation_count", 0)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      log.warn("[mine-answer-patterns] observation page failed", { tenantId, from, error: error.message });
      break;
    }
    const rows = (data ?? []) as ObservationRow[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * Page through `answer_texts` for a specific set of observation ids, in
 * PAGE_SIZE chunks. `answer_texts` has no tenant_id column (verified against
 * the baseline schema), so tenant scoping happens by only ever asking for ids
 * that already passed the tenant-scoped observation read above - this table
 * is never read unscoped.
 */
async function pageAnswerTexts(observationIds: string[]): Promise<Map<string, string>> {
  const sb = getSupabaseAdmin();
  const out = new Map<string, string>();
  for (let i = 0; i < observationIds.length; i += PAGE_SIZE) {
    const chunk = observationIds.slice(i, i + PAGE_SIZE);
    if (chunk.length === 0) continue;
    const { data, error } = await sb
      .from("answer_texts")
      .select("observation_id, body")
      .in("observation_id", chunk);
    if (error) {
      log.warn("[mine-answer-patterns] answer_texts page failed", { count: chunk.length, error: error.message });
      continue;
    }
    for (const row of (data ?? []) as AnswerTextRow[]) {
      if (row.body) out.set(row.observation_id, row.body);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export type PatternProfile = {
  tenant_id: string;
  computed_at: string;
  /** How many observation rows had at least one citation. */
  observationsWithCitations: number;
  /** How many observations actually had a stored answer text to mine. */
  observationsWithText: number;
  /** How many distinct cited sentences were classified. */
  sentencesClassified: number;
  /** Count per bucket, across ALL cited domains (not just owned). */
  bucketCounts: Record<CitationPatternBucket, number>;
  /** Bucket counts as a share of sentencesClassified, 0-100, rounded. */
  bucketSharePct: Record<CitationPatternBucket, number>;
  /** Buckets ranked most-common first (excludes "other"). */
  dominantPatterns: CitationPatternBucket[];
};

function emptyBucketCounts(): Record<CitationPatternBucket, number> {
  return { stat_first: 0, definition: 0, attributed_claim: 0, list_lead: 0, date_anchored: 0, other: 0 };
}

export function emptyPatternProfile(tenantId: string, now: Date = new Date()): PatternProfile {
  return {
    tenant_id: tenantId,
    computed_at: now.toISOString(),
    observationsWithCitations: 0,
    observationsWithText: 0,
    sentencesClassified: 0,
    bucketCounts: emptyBucketCounts(),
    bucketSharePct: emptyBucketCounts(),
    dominantPatterns: [],
  };
}

/** Fold a batch of classified cited sentences into a running profile. Pure;
 *  exported for tests. */
export function foldClassifiedSentences(
  profile: PatternProfile,
  classified: Array<{ bucket: CitationPatternBucket }>,
): PatternProfile {
  const bucketCounts = { ...profile.bucketCounts };
  for (const c of classified) bucketCounts[c.bucket] += 1;
  const sentencesClassified = profile.sentencesClassified + classified.length;
  const bucketSharePct = emptyBucketCounts();
  if (sentencesClassified > 0) {
    for (const b of ALL_PATTERN_BUCKETS) {
      bucketSharePct[b] = Math.round((bucketCounts[b] / sentencesClassified) * 100);
    }
  }
  const dominantPatterns = ALL_PATTERN_BUCKETS.filter((b) => b !== "other")
    .filter((b) => bucketCounts[b] > 0)
    .sort((a, b) => bucketCounts[b] - bucketCounts[a]);
  return { ...profile, sentencesClassified, bucketCounts, bucketSharePct, dominantPatterns };
}

/**
 * Mine one tenant's real AI answer texts for citation phrasing patterns.
 * Bounded paged reads over prompt_answer_observations (citation columns) +
 * answer_texts (the actual text), fail-soft to an empty profile on any
 * read error (never throws - a mining failure must not break the nightly
 * cycle or the daily card). $0 (existing tables only).
 */
export async function mineAnswerPatterns(tenantId: string, now: Date = new Date()): Promise<PatternProfile> {
  if (!tenantId) return emptyPatternProfile(tenantId, now);
  try {
    const observations = await pageObservations(tenantId);
    let profile = emptyPatternProfile(tenantId, now);
    profile = { ...profile, observationsWithCitations: observations.length };
    if (observations.length === 0) return profile;

    const textByObsId = await pageAnswerTexts(observations.map((o) => o.id));
    profile = { ...profile, observationsWithText: textByObsId.size };

    for (const obs of observations) {
      const text = textByObsId.get(obs.id);
      if (!text) continue;
      const urls = obs.citation_urls ?? [];
      const domains = obs.citation_domains ?? [];
      const citations = (urls.length > 0 ? urls : domains).map((u, i) => ({
        url: urls[i] ?? "",
        domain: domains[i] ?? urls[i] ?? "",
      }));
      const classified = findCitedSentences(text, citations);
      if (classified.length > 0) profile = foldClassifiedSentences(profile, classified);
    }
    return profile;
  } catch (e) {
    log.warn("[mine-answer-patterns] mining failed; returning empty profile", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return emptyPatternProfile(tenantId, now);
  }
}
