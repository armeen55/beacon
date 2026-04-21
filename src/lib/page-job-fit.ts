/**
 * Page-placement router for keyword-positioning recommendations.
 *
 * Phase 3-post (2026-04-20). After the 3A redundancy guard decides the
 * concept is absent from the exact target field, this router decides *where*
 * the concept should live:
 *
 *   keep_here              — concept fits this page; current page is best or tied
 *   better_existing_page   — another owned page is a meaningfully better fit
 *   new_page_opportunity   — concept is in tenant scope but no existing page fits;
 *                             show as low-confidence growth opportunity
 *   suppress               — junk (unreadable) or off-scope (no tenant overlap)
 *
 * Design rules:
 *   - Lightweight: token-set overlap after normalization + singular fold.
 *     No NLP library, no embeddings, no synonym table.
 *   - Generic: all vocabulary derived from the tenant's own data
 *     (H1/title, service_terms, URL slugs, optional business-config.services).
 *   - Asymmetric thresholds: keep is lenient (≥1 token overlap), reroute is
 *     strict (bestOther ≥ 2 AND bestOther ≥ currentFit + 2). False positives
 *     are worse than missed opportunities.
 *   - The caller provides the 3A redundancy check *before* invoking this
 *     router — `routeKeywordFinding` does NOT re-check redundancy.
 */

import { foldToken, normalizeForMatch } from "@/lib/text-normalize";

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export type PlacementOutcome =
  | {
      kind: "keep_here";
      currentFit: number;
      bestOtherScore: number | null;
      inTenantScope: true;
      reason: string;
    }
  | {
      kind: "better_existing_page";
      currentFit: number;
      bestOtherScore: number;
      bestOtherUrl: string;
      bestOtherPath: string;
      bestOtherHeadingText: string | null;
      inTenantScope: true;
      reason: string;
    }
  | {
      kind: "new_page_opportunity";
      currentFit: 0;
      bestOtherScore: number;
      inTenantScope: true;
      reason: string;
    }
  | {
      kind: "suppress";
      currentFit: number;
      bestOtherScore: number | null;
      inTenantScope: boolean;
      subtype: "junk" | "off_scope";
      reason: string;
    };

export type PageJobFitContext = {
  /** Tokens stripped from concept and page-job signals because they are too
   *  common to carry meaning on this tenant. Derived from tenant corpus +
   *  optional business-config.stripWords. */
  generics: Set<string>;
  /** Known locations (folded). Stripped from everything. */
  locations: Set<string>;
  /** Brand aliases (folded). Stripped from everything. */
  brands: Set<string>;
  /** Broader tenant scope — union of (page job tokens, service terms, slug
   *  tokens, business-config.services). Used for scope checks when no page
   *  fits. */
  tenantScope: Set<string>;
};

export type OwnedPageLike = {
  url: string;
  h1: string | null;
  title: string | null;
  h2_list?: string[] | null;
  service_terms?: string[];
  location_terms?: string[];
};

export type KeywordFindingLike = {
  pageUrl: string;
  pagePath: string;
  concept: string;
  currentHeadingText: string;
  targetElement: "title" | "h1" | "h2";
};

// ───────────────────────────────────────────────────────────────────────────
// Thresholds
// ───────────────────────────────────────────────────────────────────────────

/** Minimum overlap (in tokens) for the current page to be considered a fit. */
export const KEEP_FIT_MIN = 1;
/** Minimum overlap (in tokens) on the *other* page to trigger a reroute. */
export const REROUTE_FIT_MIN = 2;
/** Margin (in tokens) by which bestOther must exceed currentFit to reroute. */
export const REROUTE_MARGIN = 2;
/** Generic-threshold: token appearing on ≥ this fraction of owned pages is
 *  generic. 0.30 = 30%. */
export const GENERIC_FRACTION_THRESHOLD = 0.3;
/** Below this many owned pages, fall back to the static cold-start stopword
 *  list instead of deriving generics from corpus. */
export const GENERIC_COLD_START_MIN_PAGES = 10;
/** Cold-start fallback stopwords. Domain-agnostic. */
export const GENERIC_COLD_START_STOPWORDS = [
  "home", "service", "services", "about", "our", "we",
  "the", "a", "in", "of", "for", "by", "with",
] as const;

// ───────────────────────────────────────────────────────────────────────────
// Tokenizers
// ───────────────────────────────────────────────────────────────────────────

/** Tokenize a free-text string. Reuses normalizeForMatch + foldToken from
 *  the 3A text-normalize helpers. Empty input → empty set. */
function tokenSet(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set();
  const normalized = normalizeForMatch(raw);
  if (!normalized) return new Set();
  return new Set(normalized.split(" ").filter(Boolean).map(foldToken));
}

/** Tokenize a URL path. Splits on / and -, ignores the origin.
 *  "/whole-home-remodel" → ["whole", "home", "remodel"]. */
export function slugTokens(url: string | null | undefined): Set<string> {
  if (!url) return new Set();
  const pathOnly = url.replace(/^https?:\/\/[^/]+/, "");
  const raw = pathOnly.replace(/[/_]/g, " ").replace(/-/g, " ");
  return tokenSet(raw);
}

// ───────────────────────────────────────────────────────────────────────────
// Context builder
// ───────────────────────────────────────────────────────────────────────────

export type BuildContextInput = {
  pages: OwnedPageLike[];
  brandAliases?: string[];
  knownLocations?: string[];
  /** Optional: business-config.services (or equivalent). Multi-word entries
   *  are tokenized ("custom home" → {custom, home}). */
  tenantServices?: string[];
  /** Optional: business-config.stripWords (or equivalent). Tokens listed here
   *  are merged into the generics set. */
  additionalGenerics?: string[];
};

export function buildPageJobFitContext(input: BuildContextInput): PageJobFitContext {
  const locations = new Set<string>();
  for (const l of input.knownLocations ?? []) {
    for (const t of tokenSet(l)) locations.add(t);
  }

  const brands = new Set<string>();
  for (const b of input.brandAliases ?? []) {
    for (const t of tokenSet(b)) brands.add(t);
  }

  // Tenant-generic tokens: appearing on ≥ GENERIC_FRACTION_THRESHOLD of owned
  // pages' (h1 + title) combined. Ignores pages with no headings.
  const generics = new Set<string>();
  const pageCount = input.pages.length;

  if (pageCount >= GENERIC_COLD_START_MIN_PAGES) {
    const docFrequency = new Map<string, number>();
    for (const p of input.pages) {
      const combined = `${p.h1 ?? ""} ${p.title ?? ""}`;
      const pageTokens = tokenSet(combined);
      for (const t of pageTokens) {
        docFrequency.set(t, (docFrequency.get(t) ?? 0) + 1);
      }
    }
    const threshold = Math.max(2, Math.ceil(pageCount * GENERIC_FRACTION_THRESHOLD));
    for (const [token, freq] of docFrequency) {
      if (freq >= threshold) generics.add(token);
    }
  } else {
    // Cold-start: use a small, generic stopword list instead of deriving from
    // too few pages.
    for (const w of GENERIC_COLD_START_STOPWORDS) generics.add(w);
  }
  // Always merge any caller-provided additional generics (e.g.
  // business-config.stripWords). Non-blocking: empty/undefined → no-op.
  for (const w of input.additionalGenerics ?? []) {
    for (const t of tokenSet(w)) generics.add(t);
  }

  // Tenant scope: union of (page-job tokens, service_terms, slug tokens,
  // tenantServices). We strip locations and brand from the scope set too so
  // scope overlap isn't triggered by location/brand alone.
  const tenantScope = new Set<string>();
  for (const p of input.pages) {
    // page job tokens (h1 + title, stripped)
    const jobTokens = pageJobTokensFromFields(p.h1, p.title, { generics, locations, brands });
    for (const t of jobTokens) tenantScope.add(t);

    // service_terms — already-extracted per-page services
    for (const s of p.service_terms ?? []) {
      for (const t of tokenSet(s)) {
        if (!generics.has(t) && !locations.has(t) && !brands.has(t)) {
          tenantScope.add(t);
        }
      }
    }

    // slug tokens from URL path — surfaces dedicated-page vocabulary
    for (const t of slugTokens(p.url)) {
      if (!generics.has(t) && !locations.has(t) && !brands.has(t)) {
        tenantScope.add(t);
      }
    }
  }

  // Business-config services (if provided) — broader signal than the site
  // itself. Optional and non-blocking.
  for (const svc of input.tenantServices ?? []) {
    for (const t of tokenSet(svc)) {
      if (!generics.has(t) && !locations.has(t) && !brands.has(t)) {
        tenantScope.add(t);
      }
    }
  }

  return { generics, locations, brands, tenantScope };
}

// ───────────────────────────────────────────────────────────────────────────
// Token computations
// ───────────────────────────────────────────────────────────────────────────

function pageJobTokensFromFields(
  h1: string | null | undefined,
  title: string | null | undefined,
  strip: { generics: Set<string>; locations: Set<string>; brands: Set<string> },
): Set<string> {
  const combined = `${h1 ?? ""} ${title ?? ""}`;
  const out = new Set<string>();
  for (const t of tokenSet(combined)) {
    if (strip.generics.has(t)) continue;
    if (strip.locations.has(t)) continue;
    if (strip.brands.has(t)) continue;
    out.add(t);
  }
  return out;
}

export function computePageJobTokens(
  page: OwnedPageLike,
  ctx: PageJobFitContext,
): Set<string> {
  return pageJobTokensFromFields(page.h1, page.title, ctx);
}

export function computeConceptSignalTokens(
  concept: string,
  ctx: PageJobFitContext,
): Set<string> {
  const out = new Set<string>();
  for (const t of tokenSet(concept)) {
    if (ctx.generics.has(t)) continue;
    if (ctx.locations.has(t)) continue;
    if (ctx.brands.has(t)) continue;
    out.add(t);
  }
  return out;
}

export function scoreFit(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}

function pathOnly(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";
}

// ───────────────────────────────────────────────────────────────────────────
// Router
// ───────────────────────────────────────────────────────────────────────────

/** Lookup the matching heading text on a candidate page for the finding's
 *  target element. Returns null when the page lacks that element. */
function candidateHeadingText(
  page: OwnedPageLike,
  element: "title" | "h1" | "h2",
): string | null {
  if (element === "title") return page.title ?? null;
  if (element === "h1") return page.h1 ?? null;
  const list = page.h2_list ?? [];
  return list.length > 0 ? list[0] : null;
}

/**
 * Route a single keyword-positioning finding to one of the four outcomes.
 * Assumes the 3A redundancy check has already been applied by the caller.
 */
export function routeKeywordFinding(
  finding: KeywordFindingLike,
  ownedPages: OwnedPageLike[],
  ctx: PageJobFitContext,
): PlacementOutcome {
  const conceptSig = computeConceptSignalTokens(finding.concept, ctx);

  // (0) junk: concept is entirely generics/locations/brand after strip.
  if (conceptSig.size === 0) {
    return {
      kind: "suppress",
      subtype: "junk",
      currentFit: 0,
      bestOtherScore: null,
      inTenantScope: false,
      reason: "concept empty after strip (all generics/locations/brand)",
    };
  }

  const findingPath = pathOnly(finding.pageUrl);
  const currentPage = ownedPages.find(
    (p) => pathOnly(p.url) === findingPath,
  );
  const currentFit = currentPage
    ? scoreFit(computePageJobTokens(currentPage, ctx), conceptSig)
    : 0;

  // Score every OTHER owned page.
  const otherCandidates = ownedPages
    .filter((p) => pathOnly(p.url) !== findingPath)
    .map((p) => ({
      page: p,
      score: scoreFit(computePageJobTokens(p, ctx), conceptSig),
    }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break: shorter URL wins (hub pages first).
      return pathOnly(a.page.url).length - pathOnly(b.page.url).length;
    });
  const bestOther = otherCandidates[0];
  const bestOtherScore = bestOther?.score ?? null;

  // (1) better_existing_page: strong absolute fit AND strong margin.
  if (
    bestOther &&
    bestOther.score >= REROUTE_FIT_MIN &&
    bestOther.score >= currentFit + REROUTE_MARGIN
  ) {
    return {
      kind: "better_existing_page",
      currentFit,
      bestOtherScore: bestOther.score,
      bestOtherUrl: bestOther.page.url,
      bestOtherPath: pathOnly(bestOther.page.url),
      bestOtherHeadingText: candidateHeadingText(bestOther.page, finding.targetElement),
      inTenantScope: true,
      reason: `bestOther=${bestOther.score} beats currentFit=${currentFit} by ≥${REROUTE_MARGIN}`,
    };
  }

  // (2) keep_here: current page has any fit.
  if (currentFit >= KEEP_FIT_MIN) {
    return {
      kind: "keep_here",
      currentFit,
      bestOtherScore,
      inTenantScope: true,
      reason: `currentFit=${currentFit} ≥ ${KEEP_FIT_MIN}`,
    };
  }

  // (3) currentFit = 0. A strong elsewhere reroute is still allowed even
  // when the required margin would be moot (current has nothing).
  if (bestOther && bestOther.score >= REROUTE_FIT_MIN) {
    return {
      kind: "better_existing_page",
      currentFit,
      bestOtherScore: bestOther.score,
      bestOtherUrl: bestOther.page.url,
      bestOtherPath: pathOnly(bestOther.page.url),
      bestOtherHeadingText: candidateHeadingText(bestOther.page, finding.targetElement),
      inTenantScope: true,
      reason: `currentFit=0, bestOther=${bestOther.score} ≥ ${REROUTE_FIT_MIN}`,
    };
  }

  // (4) Nothing fits well. Is the concept at least in tenant scope?
  if (intersects(conceptSig, ctx.tenantScope)) {
    return {
      kind: "new_page_opportunity",
      currentFit: 0,
      bestOtherScore: bestOther?.score ?? 0,
      inTenantScope: true,
      reason: `no page fits (currentFit=${currentFit}, bestOther=${bestOtherScore ?? 0}) but concept intersects tenant scope`,
    };
  }

  // (5) Truly off-scope.
  return {
    kind: "suppress",
    subtype: "off_scope",
    currentFit,
    bestOtherScore,
    inTenantScope: false,
    reason: `no page fits and concept has zero tenant-scope overlap`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Log helper — used by the caller during dogfood.
// ───────────────────────────────────────────────────────────────────────────

export function formatRouteLog(
  finding: { concept: string; pagePath: string },
  outcome: PlacementOutcome,
): string {
  const other =
    outcome.bestOtherScore !== null && outcome.bestOtherScore !== undefined
      ? String(outcome.bestOtherScore)
      : "-";
  const scope = outcome.inTenantScope ? "hit" : "miss";
  const suffix = outcome.kind === "suppress" ? `:${outcome.subtype}` : "";
  return `[page-job-fit] "${finding.concept}" on ${finding.pagePath} → ${outcome.kind}${suffix} (currentFit=${outcome.currentFit}, bestOther=${other}, scope=${scope}) ${outcome.reason}`;
}
