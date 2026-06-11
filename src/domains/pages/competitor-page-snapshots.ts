/**
 * Competitor page snapshots — the structural evidence layer.
 *
 * Audit Top-leverage move #5 (2026-05-08): the LLM packet's
 * `competitorPageBlueprints[].h1/topH2s/faqQuestions/metaDescription`
 * fields were hardcoded null/[] at `specific-edit-evidence.ts:1214-1219`
 * because there was no source of structural data for competitor pages.
 * `CompetitorPageEvidence` carries citation aggregates + descriptive
 * strings ("City-specific landing page (inferred from URL)"), not
 * parsed HTML.
 *
 * This module adds the missing source layer: a per-tenant snapshot
 * store of competitor page structure (h1, top h2s, faq questions, meta
 * description) captured by a manual scanner (`scripts/scan-competitor-
 * pages.ts`). The packet builder reads this store at packet-build time
 * to populate the blueprint fields.
 *
 * Lifecycle separation (deliberate):
 *   - `competitor-page-evidence.json` is derived from CITATION rollups.
 *     Updates whenever observations land. Cheap. Frequent.
 *   - `competitor-page-snapshots.json` is derived from HTML FETCH.
 *     Updates only when a manual scan runs. Bounded. Rare.
 *
 * Honesty contract (test-enforced + scrubCompetitorPageStructure):
 *   - Capture STRUCTURE, not prose. H1 + top-5 H2s + top-5 FAQ
 *     questions + meta description. Never body paragraphs. Never FAQ
 *     answers.
 *   - The scrub function below drops items that contain the operator's
 *     own brand name OR any tracked competitor name (defense-in-depth
 *     against multi-competitor pages whose H2s name OUR brand or other
 *     competitors).
 *   - Never persist nor surface body copy. The store schema below
 *     does not have a body field.
 *
 * Storage: `.data/tenants/<slug>/competitor-page-snapshots.json`. Per-
 * tenant. Registered in `TENANT_SCOPED_STORES`. No Supabase mirror in
 * v1 — same posture as `competitor-page-evidence.json` which has
 * worked at this tier for months.
 */

import "server-only";

import { cache } from "react";
import { currentTenantId } from "@/lib/tenant-context";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * One captured competitor page snapshot. Subset of the owned-page
 * `PageSnapshot` shape — only the structural fields the LLM packet
 * needs as evidence. Body copy / paragraphs / FAQ answers are
 * intentionally omitted at the type level so they cannot accidentally
 * be persisted or surfaced.
 */
export type CompetitorPageSnapshot = {
  /** Stable id: `comp-snap-${tenant_id}-${url-hash}`. */
  id: string;
  tenant_id: string;
  /** Fetched URL. */
  url: string;
  /** Canonical URL from the `<link rel="canonical">` if present, else null. */
  canonical_url: string | null;
  /** ISO timestamp of the HTML fetch. */
  fetched_at: string;
  /** HTTP status from the fetch. */
  http_status: number;
  /** `<title>` text. */
  title: string | null;
  /** `<meta name="description">` text. May be capped at INPUT_META_MAX_CHARS
   *  on read; the producer can persist the raw value, the consumer
   *  applies the cap. */
  meta_description: string | null;
  /** First `<h1>` text. */
  h1: string | null;
  /** All `<h2>` texts in document order. The packet builder caps to
   *  top-N at read time (see scrubCompetitorPageStructure). */
  h2_list: string[];
  /** Question text from FAQPage JSON-LD or DOM-extracted FAQ patterns.
   *  Questions ONLY — never answer bodies. Capped at top-N at read time. */
  faq_questions: string[];
  /** "confirmed" when JSON-LD was found and parsed; "uncertain" when
   *  raw fetch may have missed client-rendered content (mirror of the
   *  owned-page extractor's same field). */
  extraction_certainty: "confirmed" | "uncertain";
};

// ---------------------------------------------------------------------------
// Caps + scrub
// ---------------------------------------------------------------------------

/** Operator-locked maxima per audit-correction agreement (2026-05-08). */
export const COMPETITOR_BLUEPRINT_MAX_TOP_H2S = 5;
export const COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS = 5;
export const COMPETITOR_BLUEPRINT_META_MAX_CHARS = 200;

/**
 * Defense-in-depth scrub. Drops H2/FAQ items that name brands we
 * don't want flowing into the LLM packet — the operator's own brand
 * (so the model doesn't see "Acme reviews" inside a competitor page
 * and mirror that comparison framing) and any tracked competitor's
 * brand (multi-competitor pages whose H2s name OTHER competitors).
 *
 * Word-boundary, case-insensitive. Aliases are computed by the
 * caller and passed in flat — keeps this helper pure (no imports
 * from validator land).
 *
 * Returns a NEW snapshot — never mutates the input.
 */
export type ScrubArgs = {
  /** Brand-name tokens to scrub. Word-boundary, case-insensitive. */
  brandNamesToScrub: ReadonlyArray<string>;
};

export function scrubCompetitorPageStructure(
  snapshot: CompetitorPageSnapshot,
  args: ScrubArgs,
): {
  h1: string | null;
  topH2s: string[];
  faqQuestions: string[];
  metaDescription: string | null;
} {
  const aliases = args.brandNamesToScrub
    .map((b) => b.trim())
    .filter((b) => b.length >= 3); // avoid noise from short tokens

  const containsBrand = (text: string): boolean => {
    if (aliases.length === 0) return false;
    for (const alias of aliases) {
      const re = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      if (re.test(text)) return true;
    }
    return false;
  };

  const safeH1 =
    snapshot.h1 !== null && !containsBrand(snapshot.h1) ? snapshot.h1 : null;

  const topH2s = snapshot.h2_list
    .filter((h) => typeof h === "string" && h.length > 0)
    .filter((h) => !containsBrand(h))
    .slice(0, COMPETITOR_BLUEPRINT_MAX_TOP_H2S);

  const faqQuestions = snapshot.faq_questions
    .filter((q) => typeof q === "string" && q.length > 0)
    .filter((q) => !containsBrand(q))
    .slice(0, COMPETITOR_BLUEPRINT_MAX_FAQ_QUESTIONS);

  const metaDescription =
    snapshot.meta_description === null
      ? null
      : snapshot.meta_description.length > COMPETITOR_BLUEPRINT_META_MAX_CHARS
        ? snapshot.meta_description.slice(
            0,
            COMPETITOR_BLUEPRINT_META_MAX_CHARS,
          )
        : snapshot.meta_description;

  return { h1: safeH1, topH2s, faqQuestions, metaDescription };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Persistence — same pattern as competitor-page-evidence.ts
// ---------------------------------------------------------------------------

const STORE_NAME = "competitor-page-snapshots";

// Night-shift cache sweep (2026-06-11): per-tenant Map — the global
// `let _state` pinned the first tenant's competitor snapshots for
// everyone in a warm process.
const _byTenant = new Map<string, CompetitorPageSnapshot[]>();

const ensureLoaded = cache(async (): Promise<CompetitorPageSnapshot[]> => {
  const tenantId = await currentTenantId();
  const cached = _byTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await getRepository().getCompetitorPageSnapshots();
  _byTenant.set(tenantId, loaded);
  return loaded;
});

export const getCompetitorPageSnapshots = cache(
  async (): Promise<CompetitorPageSnapshot[]> => {
    return ensureLoaded();
  },
);

/**
 * Build a `Map<normalizedUrl, CompetitorPageSnapshot>` for fast
 * lookup at packet-build time. Url normalization mirrors the
 * `competitorPageBlueprints` lookup ("first row wins" stable
 * resolution).
 */
export async function getCompetitorPageSnapshotsByUrl(): Promise<
  Map<string, CompetitorPageSnapshot>
> {
  const all = await getCompetitorPageSnapshots();
  const out = new Map<string, CompetitorPageSnapshot>();
  for (const s of all) {
    if (!out.has(s.url)) out.set(s.url, s);
  }
  return out;
}

/**
 * Persist a list of snapshots. Idempotent on (tenant_id, url):
 * re-running with the same url replaces the prior row. Caller is the
 * scanner script; v1 is single-tenant, so we don't filter on
 * tenant_id here — the store is already per-tenant on disk.
 */
export async function persistCompetitorPageSnapshots(
  rows: ReadonlyArray<CompetitorPageSnapshot>,
): Promise<void> {
  const existing =
    (await readStore<CompetitorPageSnapshot>(STORE_NAME)) ?? [];
  const byUrl = new Map<string, CompetitorPageSnapshot>();
  for (const s of existing) byUrl.set(s.url, s);
  for (const s of rows) byUrl.set(s.url, s);
  await writeStore(STORE_NAME, [...byUrl.values()]);
  // Reset the cache so subsequent reads see the fresh rows.
  _byTenant.clear();
}

/** Test-only reset. */
export function _resetCompetitorPageSnapshotsForTests(): void {
  _byTenant.clear();
}

// ---------------------------------------------------------------------------
// Top-N picker (used by scripts/scan-competitor-pages.ts)
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a `competitor-page-evidence` row needed for the
 * picker. Kept loose so tests + the CLI don't have to import the
 * full `CompetitorPageEvidence` type.
 */
export type CompetitorEvidenceLike = {
  pageUrl: string;
  domain: string;
  citationCount: number;
  sourceType?: string;
};

const NON_BLUEPRINT_SOURCE_TYPES: ReadonlySet<string> = new Set([
  "directory",
  "review_platform",
  "editorial_roundup",
  "forum",
]);

/**
 * Pick the top-N URLs to snapshot, sorted by citationCount desc.
 *
 * Pure / deterministic. Same input order produces the same output.
 * Filters defensively:
 *   - drops rows with non-http(s) URLs (defensive — never fetch
 *     ftp://, javascript:, etc.)
 *   - drops directory / review-platform / editorial-roundup / forum
 *     `sourceType` values — those are already classified as non-
 *     competitor in the evidence pipeline, so their structure isn't
 *     useful blueprint material
 *   - dedupes by URL (first occurrence wins; matches the convention
 *     used elsewhere in this module)
 *
 * `limit` ≤ 0 returns []. Empty input returns [].
 */
export function pickTopCompetitorUrls(
  evidence: ReadonlyArray<CompetitorEvidenceLike>,
  limit: number,
): { url: string; domain: string; citationCount: number }[] {
  if (limit <= 0) return [];
  const seen = new Set<string>();
  const filtered: {
    url: string;
    domain: string;
    citationCount: number;
  }[] = [];
  for (const row of evidence) {
    if (typeof row.pageUrl !== "string") continue;
    if (!/^https?:\/\//i.test(row.pageUrl)) continue;
    if (
      typeof row.sourceType === "string" &&
      NON_BLUEPRINT_SOURCE_TYPES.has(row.sourceType)
    ) {
      continue;
    }
    if (seen.has(row.pageUrl)) continue;
    seen.add(row.pageUrl);
    filtered.push({
      url: row.pageUrl,
      domain: row.domain,
      citationCount: row.citationCount ?? 0,
    });
  }
  filtered.sort((a, b) => b.citationCount - a.citationCount);
  return filtered.slice(0, limit);
}
