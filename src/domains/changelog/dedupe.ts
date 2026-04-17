import type { ChangelogEntry } from "./types";

/**
 * Edit-type tokens we extract from a change_description string.
 *
 * A CSV summary entry like "Published new landing page" and a PDF granular
 * entry like "Set title tag to …" on the same URL on the same day are duplicates
 * if the CSV's token set is a subset of the PDF's token set (CSV summarises PDF).
 */
export type EditToken =
  | "page_created"
  | "page_removed"
  | "title_change"
  | "meta_description"
  | "h1_change"
  | "faq_added"
  | "schema_added"
  | "canonical_change"
  | "hero_change"
  | "section_added"
  | "internal_links"
  | "images_added"
  | "sitemap_robots"
  | "navigation_change";

const KEYWORD_RULES: Array<{ tokens: EditToken[]; patterns: RegExp[] }> = [
  {
    tokens: ["page_created"],
    patterns: [
      /\bcreated\b.*\bpage\b/i,
      /\bpublished\b.*\b(new|landing|guide)\b.*\bpage\b/i,
      /\bpublished\s+new\b.*\bpage\b/i,
      /\blaunched\b.*\bpage\b/i,
      /\brebuilt\b.*\b(page|hub)\b/i,
      /\bnew\s+(standalone|landing)\s+page\b/i,
      /complete page reconstruction/i,
    ],
  },
  {
    tokens: ["page_removed"],
    patterns: [/removed page|deprecated page|301 redirect .* (removed|old)/i],
  },
  {
    tokens: ["title_change"],
    patterns: [/\btitle tag\b/i, /\btitle changed\b/i, /\bupdated title\b/i, /\bset title\b/i, /meta title/i],
  },
  {
    tokens: ["meta_description"],
    patterns: [/meta description/i],
  },
  {
    tokens: ["h1_change"],
    patterns: [/\bH1\b/, /hero .*(H1|heading)/i, /updated .* headline/i],
  },
  {
    tokens: ["faq_added"],
    patterns: [/\bFAQ\b/, /frequently asked/i, /added .* (question|Q&A)/i],
  },
  {
    tokens: ["schema_added"],
    patterns: [
      /JSON-?LD/i,
      /schema/i,
      /BreadcrumbList|FAQPage|Article|Service|Organization|LocalBusiness/,
    ],
  },
  {
    tokens: ["canonical_change"],
    patterns: [/canonical/i],
  },
  {
    tokens: ["hero_change"],
    patterns: [/\bhero\b/i, /new hero section/i, /updated hero/i],
  },
  {
    tokens: ["section_added"],
    patterns: [/added .* section/i, /added .* (strip|grid|card)/i, /embedded .* section/i],
  },
  {
    tokens: ["internal_links"],
    patterns: [/internal link/i, /added link to \//i, /anchor text/i],
  },
  {
    tokens: ["images_added"],
    patterns: [/added .* (image|photo|collage)/i, /image gallery/i, /alt text/i],
  },
  {
    tokens: ["sitemap_robots"],
    patterns: [/sitemap/i, /robots\.txt/i],
  },
  {
    tokens: ["navigation_change"],
    patterns: [/site navigation|nav bar|header menu|footer link/i],
  },
];

export function extractEditTokens(text: string): Set<EditToken> {
  const out = new Set<EditToken>();
  if (!text) return out;
  for (const rule of KEYWORD_RULES) {
    for (const pat of rule.patterns) {
      if (pat.test(text)) {
        for (const t of rule.tokens) out.add(t);
        break;
      }
    }
  }
  return out;
}

function normalisePath(url: string | null): string {
  if (!url) return "";
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function daysBetween(aISO: string, bISO: string): number {
  const a = new Date(aISO).getTime();
  const b = new Date(bISO).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86_400_000;
}

export type DuplicatePair = {
  /** The granular "canonical" entry (usually PDF). Kept. */
  keeper: ChangelogEntry;
  /** The summary entry (usually CSV). Candidate for archive. */
  archiveCandidate: ChangelogEntry;
  /** Tokens present in both. */
  sharedTokens: EditToken[];
  /** Extra tokens the keeper has (indicates finer detail). */
  keeperOnlyTokens: EditToken[];
  /** Days apart. */
  daysApart: number;
};

export type DedupeOptions = {
  /** Max days between timestamps to still be considered the same edit. Default 3. */
  maxDaysApart?: number;
  /**
   * Source systems treated as "summary" (archive candidates) and "granular" (keepers).
   * Defaults match the current Beacon import set.
   */
  summarySources?: string[];
  granularSources?: string[];
};

const DEFAULT_SUMMARY_SOURCES = ["changelog_csv"];
const DEFAULT_GRANULAR_SOURCES = ["pdf_changelog_rebuild"];

/**
 * Find probable duplicate pairs across changelog entries.
 *
 * Rule: a pair is a probable duplicate when
 *   1. Both entries have the same normalised URL (or both null), AND
 *   2. Timestamps are within `maxDaysApart` days, AND
 *   3. The summary entry's edit-type tokens are a (non-empty) subset of the granular entry's tokens.
 *
 * If the summary entry has zero extracted tokens we fall back to URL+date match only,
 * which keeps the pair as "possible" so the operator can still review it.
 */
export function findDuplicatePairs(
  entries: ChangelogEntry[],
  opts: DedupeOptions = {},
): DuplicatePair[] {
  const maxDays = opts.maxDaysApart ?? 3;
  const summarySources = new Set(opts.summarySources ?? DEFAULT_SUMMARY_SOURCES);
  const granularSources = new Set(opts.granularSources ?? DEFAULT_GRANULAR_SOURCES);

  // Exclude archived (dedupe: confirmed duplicate) AND dedupe_reviewed
  // (operator already confirmed this entry is NOT a duplicate — don't re-ask).
  const active = entries.filter((e) => !e.archived && !e.dedupe_reviewed);
  const summaries = active.filter((e) => summarySources.has(e.source_system ?? ""));
  const granulars = active.filter((e) => granularSources.has(e.source_system ?? ""));

  // Index granulars by URL for O(n·m_url) matching.
  const byUrl = new Map<string, ChangelogEntry[]>();
  for (const g of granulars) {
    const key = normalisePath(g.url);
    const bucket = byUrl.get(key) ?? [];
    bucket.push(g);
    byUrl.set(key, bucket);
  }

  const pairs: DuplicatePair[] = [];
  const usedSummaries = new Set<string>();

  for (const s of summaries) {
    if (usedSummaries.has(s.id)) continue;
    const key = normalisePath(s.url);
    const candidates = byUrl.get(key) ?? [];
    if (candidates.length === 0) continue;

    const sTokens = extractEditTokens(s.change_description);

    // Best pair: minimal days apart with satisfying subset rule.
    let best: DuplicatePair | null = null;
    for (const g of candidates) {
      const days = daysBetween(s.timestamp, g.timestamp);
      if (days > maxDays) continue;

      const gTokens = extractEditTokens(g.change_description);
      const shared: EditToken[] = [];
      const keeperOnly: EditToken[] = [];
      for (const t of sTokens) if (gTokens.has(t)) shared.push(t);
      for (const t of gTokens) if (!sTokens.has(t)) keeperOnly.push(t);

      // Subset rule: every summary token is present in the granular set.
      // If the summary has zero tokens, allow the pair through (operator decides).
      const subsetOk =
        sTokens.size === 0 || shared.length === sTokens.size;
      if (!subsetOk) continue;

      const candidate: DuplicatePair = {
        keeper: g,
        archiveCandidate: s,
        sharedTokens: shared,
        keeperOnlyTokens: keeperOnly,
        daysApart: days,
      };

      if (!best || candidate.daysApart < best.daysApart) best = candidate;
    }

    if (best) {
      pairs.push(best);
      usedSummaries.add(s.id);
    }
  }

  // Deterministic order: oldest keeper first, then by URL.
  pairs.sort((a, b) => {
    const ta = new Date(a.keeper.timestamp).getTime();
    const tb = new Date(b.keeper.timestamp).getTime();
    if (ta !== tb) return ta - tb;
    return (a.keeper.url ?? "").localeCompare(b.keeper.url ?? "");
  });

  return pairs;
}
