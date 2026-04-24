/**
 * Page-inventory fallback resolver — Phase v7 Commit 2 (2026-04-23).
 *
 * Layer 2 of the page-intent resolver. Fires when Layer 1 (observation-led)
 * is silent — i.e., AI hasn't cited any owned URL yet but a matching page
 * may still exist. Uses page-snapshots + PageEntity records (already
 * captured by scans) to match a cluster label against existing page
 * URLs / titles / H1s. Deterministic, token-weighted.
 *
 * This is NOT a full HTML crawler. It reuses data Beacon already has.
 * No network requests. For customers with no scans yet, buildPageInventory
 * returns [] and the resolver falls through to Layer 3 (LLM adjudicator).
 *
 * Design:
 *   - Pure. All inputs explicit.
 *   - Deterministic scoring: token overlap + route-type boost + path boost.
 *   - Owned-only: drops competitor / directory pages from the inventory.
 *   - URL canonicalization matches resolve-page-intent.ts so both layers
 *     agree on what "the same URL" means.
 */

import type { PageSnapshot, PageEntity } from "@/domains/pages/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import { canonicalizeUrl } from "./resolve-page-intent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PageRouteType =
  | "location"
  | "service"
  | "project"
  | "hub"
  | "blog"
  | "home"
  | "contact"
  | "other";

export type PageInventoryEntry = {
  /** Canonicalized URL (matches resolve-page-intent.ts shape). */
  url: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
  h2s: string[];
  routeType: PageRouteType;
  detectedGeo: string | null;
  detectedService: string | null;
};

export type InventoryMatch = {
  url: string;
  /** 0..1 blended score. Higher is better. */
  score: number;
  reasons: string[];
  entry: PageInventoryEntry;
  /** Phase 2 (2026-04-24): bundled pages have H1/title tokens that clearly
   *  cover the cluster AND additional distinct parts (e.g.,
   *  "Los Altos & Los Altos Hills"). Resolver maps this to
   *  needs_review / split_or_separate_page rather than strengthen. */
  isBundled?: boolean;
  /** Phase 2.6 (2026-04-24): how many cluster tokens appear in the URL
   *  path. Used as the primary tiebreak after score. Pages whose URL path
   *  explicitly names the cluster should beat pages that only mention the
   *  cluster in H1/body via brand boilerplate. */
  urlPathOverlap: number;
  /** Phase 2.7 (2026-04-24): true for a service-route page whose URL slug
   *  tokens are ALL contained in the cluster tokens. Fires the cluster
   *  "Best Design-Build Firm for Custom Homes (Bay Area)" to prefer
   *  `/services/design-build` over `/custom-home-builder-bay-area`.
   *  Used as a tiebreak slot between score and urlPathOverlap so a
   *  service-specific page wins ties against broad hubs. Never
   *  overrides raw score — only decides between pages that are
   *  already roughly tied. */
  isExplicitServiceMatch: boolean;
};

// ---------------------------------------------------------------------------
// Inventory builder
// ---------------------------------------------------------------------------

export function buildPageInventory(args: {
  pages: ReadonlyArray<PageEntity>;
  snapshots: ReadonlyArray<PageSnapshot>;
  activeEntities: ReadonlyArray<TrackedEntity>;
}): PageInventoryEntry[] {
  const ownedHosts = extractOwnedHosts(args.activeEntities);

  // Latest snapshot per page_id.
  const latestByPageId = new Map<string, PageSnapshot>();
  for (const s of args.snapshots) {
    const existing = latestByPageId.get(s.page_id);
    if (!existing || s.fetched_at > existing.fetched_at) {
      latestByPageId.set(s.page_id, s);
    }
  }

  const out: PageInventoryEntry[] = [];
  const seenUrls = new Set<string>();

  for (const page of args.pages) {
    // Phase 2 (2026-04-24): do NOT trust the PageEntity.is_owned flag as
    // the gate — in Supabase that flag is frequently stale or wrong for
    // pages discovered via citations. The tracked-entity owned-domain
    // host match is the authoritative source of ownership. When that
    // matches we keep the page even if is_owned is false.
    const host = extractHost(page.url);
    if (!host) continue;
    if (!hostIsOwned(host, ownedHosts)) continue;
    const canonical = canonicalizeUrl(page.url);
    if (!canonical) continue;
    if (seenUrls.has(canonical)) continue;
    seenUrls.add(canonical);

    const snap = latestByPageId.get(page.id) ?? null;
    const entry: PageInventoryEntry = {
      url: canonical,
      title: snap?.title ?? page.title_last_seen ?? null,
      h1: snap?.h1 ?? null,
      metaDescription: snap?.meta_description ?? null,
      h2s: snap?.h2_list?.slice(0, 8) ?? [],
      routeType: deriveRouteType(canonical, page),
      detectedGeo: page.city ?? pickFirst(snap?.location_terms ?? []),
      detectedService: page.service ?? pickFirst(snap?.service_terms ?? []),
    };
    out.push(entry);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Tokenize a cluster label or prompt text into lowercase word tokens,
 *  dropping short filler words. Matching uses overlap against a similarly
 *  tokenized searchable text per page. */
/**
 * Synonym map for known customer-domain vocabulary variations.
 * Applied AFTER stopword filtering, BEFORE overlap matching.
 *
 * Conservative set — only unambiguous equivalences where the two forms
 * refer to the same intent in the construction/home-builder domain.
 * Extending this map is how we widen deterministic matching without
 * reaching for an LLM.
 *
 * Each key token is normalized to the value token. Non-listed tokens
 * pass through unchanged.
 */
const SYNONYM_MAP: Readonly<Record<string, string>> = {
  // renovation ↔ remodel
  renovation: "remodel",
  renovations: "remodel",
  renovating: "remodel",
  remodeling: "remodel",
  remodels: "remodel",
  // "build on my lot" ↔ "build on your lot"
  your: "my",
  // architect-provided ↔ architectural
  architectural: "architect",
  architects: "architect",
  // construction ↔ builder (one-way: construction → builder, since "builder"
  // is the more common customer-facing token in this domain)
  construction: "builder",
  constructions: "builder",
  builders: "builder",
  // common plural/singular normalizations
  homes: "home",
  services: "service",
  locations: "location",
  projects: "project",
};

export function tokenizeForMatch(input: string): string[] {
  const stopwords = new Set<string>([
    "the", "a", "an", "of", "in", "on", "at", "to", "for", "with", "and", "or",
    "but", "is", "are", "was", "were", "be", "been", "being", "as", "by",
    "best", "top", "near", "me", "my",
  ]);
  // Strip apostrophes so "architect's" → "architects", then split on anything
  // that isn't a letter or digit. Hyphens, underscores, slashes all become
  // boundaries so "whole-home-remodel" tokenizes the same as "Whole Home
  // Remodel" — essential for URL-token vs cluster-label matching.
  const cleaned = input.toLowerCase().replace(/'/g, "");
  const raw = cleaned.split(/[^a-z0-9]+/g).filter(Boolean);
  return raw
    .filter((t) => t.length >= 3 && !stopwords.has(t))
    .map((t) => SYNONYM_MAP[t] ?? t);
}

export function matchClusterToInventory(args: {
  label: string;                 // cluster label or fallback text
  kind: "geo" | "topic" | null;  // geo | topic | null (for single-prompt)
  inventory: ReadonlyArray<PageInventoryEntry>;
  /** Return at most N matches. Defaults to 5. */
  topN?: number;
}): InventoryMatch[] {
  const topN = args.topN ?? 5;
  if (args.inventory.length === 0) return [];

  const clusterTokens = tokenizeForMatch(args.label);
  if (clusterTokens.length === 0) return [];

  const clusterTokenSet = new Set(clusterTokens);
  const clusterTokenCount = clusterTokens.length;

  const matches: InventoryMatch[] = [];
  for (const entry of args.inventory) {
    const searchable = buildSearchableTokens(entry);
    const reasons: string[] = [];

    let overlap = 0;
    for (const token of clusterTokens) {
      if (searchable.has(token)) overlap += 1;
    }
    if (overlap === 0) continue;

    let score = overlap / clusterTokenCount;
    reasons.push(`${overlap}/${clusterTokenCount} label tokens match page`);

    // Boost: cluster label tokens appear in URL path. Phase 2.6
    // (2026-04-24): scale the boost to the number of matching tokens,
    // not only the 100% case. A page whose URL covers 4/5 cluster
    // tokens is still the better target than one whose URL covers 0
    // but only matches via brand boilerplate in the H1.
    const lowerUrl = entry.url.toLowerCase();
    const pathMatches = clusterTokens.filter((t) => lowerUrl.includes(t));
    if (pathMatches.length === clusterTokens.length) {
      score += 0.25;
      reasons.push("all label tokens appear in URL path");
    } else if (pathMatches.length > 0) {
      const boost = 0.05 * pathMatches.length;
      score += boost;
      reasons.push(
        `${pathMatches.length}/${clusterTokenCount} label tokens in URL path (+${boost.toFixed(2)})`,
      );
    }

    // Boost: cluster kind aligns with route type.
    if (args.kind === "geo" && entry.routeType === "location") {
      score += 0.20;
      reasons.push("geo cluster → location-route page");
    }
    if (args.kind === "topic" && entry.routeType === "service") {
      score += 0.10;
      reasons.push("topic cluster → service-route page");
    }
    if (args.kind === "topic" && entry.routeType === "hub") {
      score += 0.05;
      reasons.push("topic cluster → hub page");
    }

    // Boost: cluster label token matches detected geo/service.
    if (entry.detectedGeo) {
      const geoTokens = tokenizeForMatch(entry.detectedGeo);
      if (geoTokens.some((t) => clusterTokenSet.has(t))) {
        score += 0.10;
        reasons.push(`detected geo "${entry.detectedGeo}" matches label`);
      }
    }
    if (entry.detectedService) {
      const svcTokens = tokenizeForMatch(entry.detectedService);
      if (svcTokens.some((t) => clusterTokenSet.has(t))) {
        score += 0.10;
        reasons.push(`detected service "${entry.detectedService}" matches label`);
      }
    }

    // Phase 2 (2026-04-24): page specificity score. A page whose URL-path
    // slug tokens are exactly (or very close to) the cluster tokens is a
    // more specific match than a page whose slug has many unrelated tokens.
    // This is what stops the homepage from beating /locations/palo-alto for
    // a "Palo Alto" cluster.
    const urlPathTokens = urlPathTokenSet(entry.url);
    const unmatchedSlugTokens = [...urlPathTokens].filter(
      (t) => !clusterTokenSet.has(t),
    );
    if (urlPathTokens.size > 0) {
      // Slug-only tokens drag the match down unless they're legitimate
      // descriptors that live in the searchable set anyway. Penalty is
      // proportional to unmatched slug tokens, capped so good matches
      // with a couple extra descriptors still score well.
      const noiseRatio = Math.min(unmatchedSlugTokens.length / 4, 0.3);
      score -= noiseRatio;
      if (noiseRatio > 0) {
        reasons.push(
          `slug has ${unmatchedSlugTokens.length} tokens outside the cluster (−${noiseRatio.toFixed(2)})`,
        );
      }
    }

    // Phase 2 (2026-04-24): hard penalty for the homepage. The homepage
    // almost always contains the brand's headline tokens, which would
    // otherwise make it the top match for every specific cluster. The
    // homepage is a legitimate target only when the cluster itself is
    // brand/homepage-level (single-token brand cluster), not for specific
    // location/service clusters.
    if (entry.routeType === "home") {
      const isBrandCluster =
        clusterTokenCount <= 2 &&
        args.kind === null; // single-prompt brand query
      if (!isBrandCluster) {
        score = score * 0.25;
        reasons.push("homepage penalty (not a specific-cluster target)");
      }
    }

    // Phase 2 (2026-04-24): bundled-match detection. A page whose H1/title
    // explicitly lists multiple distinct parts (separated by " and ", " & ",
    // " + ", " / ", or comma) covers the cluster AND more. Flag for
    // needs_review / split_or_separate_page rather than auto-strengthen.
    const isBundled = detectBundledCoverage(entry, clusterTokenSet);
    if (isBundled) {
      reasons.push("page title covers cluster + additional parts (bundled)");
    }

    // Phase 2.6 (2026-04-24): count cluster tokens that actually appear in
    // the URL path. Used as primary tiebreak after score — a page whose URL
    // path contains every cluster token (e.g. /luxury-home-builder-bay-area
    // for "Luxury Home Builder Bay Area") should beat a page that only
    // mentions those tokens via brand boilerplate in the H1 or title
    // (e.g. /services/build-on-your-lot whose H1 is "Luxury Custom Home
    // Construction on Your Lot").
    const urlPathOverlap = [...clusterTokenSet].filter((t) =>
      urlPathTokens.has(t),
    ).length;

    // Phase 2.7 (2026-04-24): explicit-service-match flag. True iff the
    // entry is a service-route page whose URL slug tokens are ALL
    // contained in the cluster tokens. Used as a tiebreak between score
    // and urlPathOverlap so clusters like "Best Design-Build Firm for
    // Custom Homes (Bay Area)" pick `/services/design-build` over a
    // broad `/custom-home-builder-bay-area` hub.
    const svcSlug = serviceSlugTokens(entry);
    const isExplicitServiceMatch =
      svcSlug.size > 0 &&
      [...svcSlug].every((t) => clusterTokenSet.has(t));
    if (isExplicitServiceMatch) {
      reasons.push(
        `cluster names the service explicitly ("${[...svcSlug].join("-")}") — service page preferred`,
      );
    }

    matches.push({
      url: entry.url,
      score: Math.min(Math.max(score, 0), 1),
      reasons,
      entry,
      isBundled,
      urlPathOverlap,
      isExplicitServiceMatch,
    });
  }

  // Phase 2 tiebreak: at equal score, prefer the route-type that matches
  // the cluster kind (geo → location, topic → service/hub over project/
  // other/home). This stops `/explore-projects/louis-road-palo-alto`
  // beating `/locations/palo-alto` when both score 1.0 for a Palo Alto
  // geo cluster.
  const rankForKind = (rt: PageRouteType): number => {
    if (args.kind === "geo") {
      return (
        { location: 0, hub: 1, service: 2, project: 3, other: 4, blog: 5, home: 6, contact: 7 } as Record<
          PageRouteType,
          number
        >
      )[rt];
    }
    if (args.kind === "topic") {
      return (
        { service: 0, hub: 1, location: 2, project: 3, other: 4, blog: 5, home: 6, contact: 7 } as Record<
          PageRouteType,
          number
        >
      )[rt];
    }
    return 0;
  };
  // Tiebreak chain:
  //   1. score desc
  //   2. isExplicitServiceMatch true first (Phase 2.7) — a service page
  //      whose slug is fully named in the cluster beats a broad hub that
  //      only matches via common modifiers
  //   3. urlPathOverlap desc (Phase 2.6) — pages whose URL path names
  //      the cluster beat pages that only mention it via H1 boilerplate
  //   4. route-type rank for cluster kind
  //   5. alphabetical url as the final stable key
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.isExplicitServiceMatch) - Number(a.isExplicitServiceMatch) ||
      b.urlPathOverlap - a.urlPathOverlap ||
      rankForKind(a.entry.routeType) - rankForKind(b.entry.routeType) ||
      a.url.localeCompare(b.url),
  );
  return matches.slice(0, topN);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Phase 2.7 (2026-04-24). For a service-route page, return the tokens
 * of its URL slug with the leading `/services/` segment stripped. The
 * stripped form is the canonical identifier of what service the page is
 * about (e.g. "/services/design-build" → {design, build}). Used to
 * detect when a cluster explicitly names a service and the service page
 * should win the target slot. Returns an empty set for non-service
 * routeTypes, so hub pages are never treated as explicit-service
 * matches even if their URL slug happens to tokenize into the cluster.
 */
function serviceSlugTokens(entry: PageInventoryEntry): Set<string> {
  if (entry.routeType !== "service") return new Set();
  try {
    const pathname = new URL(entry.url).pathname;
    const slug = pathname
      .replace(/^\/services\//, "")
      .replace(/^\/+|\/+$/g, "");
    if (!slug) return new Set();
    return new Set(tokenizeForMatch(slug));
  } catch {
    return new Set();
  }
}

/**
 * Return the set of tokens extracted from the page URL's pathname only.
 * Used by the specificity score — a page whose slug is close to the
 * cluster label is more likely the intended target than a page whose
 * slug has many extra unrelated tokens.
 */
function urlPathTokenSet(url: string): Set<string> {
  try {
    const pathname = new URL(url).pathname;
    const set = new Set<string>();
    for (const t of tokenizeForMatch(pathname.replace(/[/_-]+/g, " "))) {
      set.add(t);
    }
    return set;
  } catch {
    return new Set();
  }
}

/**
 * True when the page's title or H1 appears to bundle multiple distinct
 * coverage parts — e.g. "Los Altos & Los Altos Hills" or
 * "Palo Alto / Menlo Park Home Builder". Triggered when a bundling
 * connector appears between two substantive phrases AND at least one
 * of the cluster tokens is in the page.
 *
 * Keeps the implementation conservative so "Kitchen & Bath Remodel"
 * doesn't trigger for a "Kitchen" cluster — we require distinct
 * phrases on each side of the connector, each with ≥2 non-stopword
 * tokens.
 */
function detectBundledCoverage(
  entry: PageInventoryEntry,
  clusterTokenSet: ReadonlySet<string>,
): boolean {
  const texts = [entry.h1, entry.title].filter(
    (t): t is string => typeof t === "string" && t.length > 0,
  );
  if (texts.length === 0) return false;
  const connectorPattern = /\s+(?:and|&|\+|\/|,)\s+/i;
  for (const rawText of texts) {
    // Phase 2.6 (2026-04-24): strip brand/tagline boilerplate after a pipe
    // separator before detecting bundling. In "Build on Your Lot Bay Area
    // | Custom Home & Site Specialists" the "&" sits inside the tagline,
    // not inside the content-scope phrase. Checking the primary phrase
    // (before "|") removes that whole class of false positives.
    const text = rawText.split("|")[0].trim();
    if (!text) continue;
    const parts = text.split(connectorPattern);
    if (parts.length < 2) continue;
    const significant = parts.filter((p) => tokenizeForMatch(p).length >= 2);
    if (significant.length < 2) continue;
    // Phase 2.6 (2026-04-24): require at least one side to carry ≥4
    // substantive tokens. Short two-sided titles like
    //   "Custom Home & Site Specialists"         (2 + 2)
    //   "Luxury Teardown & Rebuild Bay Area"     (2 + 3)
    //   "Luxury Teardown & Rebuild in the Bay Area" (2 + 3)
    // are compound product names, not genuine multi-intent bundles. Real
    // bundling titles carry more coverage ("Luxury Custom Home Builder in
    // Los Altos & Los Altos Hills | Design Build Firm" = 6 + 6, or
    // "Palo Alto and Menlo Park remodeling services" = 2 + 4).
    const maxSubstantive = Math.max(
      ...significant.map((p) => tokenizeForMatch(p).length),
    );
    if (maxSubstantive < 4) continue;
    // At least one side must overlap the cluster label — otherwise it's
    // a bundled page unrelated to this cluster.
    const anyOverlaps = significant.some((p) =>
      tokenizeForMatch(p).some((t) => clusterTokenSet.has(t)),
    );
    if (anyOverlaps) return true;
  }
  return false;
}

function buildSearchableTokens(entry: PageInventoryEntry): Set<string> {
  const parts: string[] = [];
  try {
    const url = new URL(entry.url);
    parts.push(url.pathname.replace(/[/_-]+/g, " "));
  } catch {
    /* ignore */
  }
  if (entry.title) parts.push(entry.title);
  if (entry.h1) parts.push(entry.h1);
  if (entry.metaDescription) parts.push(entry.metaDescription);
  for (const h of entry.h2s) parts.push(h);
  if (entry.detectedGeo) parts.push(entry.detectedGeo);
  if (entry.detectedService) parts.push(entry.detectedService);

  const set = new Set<string>();
  for (const p of parts) {
    for (const t of tokenizeForMatch(p)) set.add(t);
  }
  return set;
}

function deriveRouteType(
  canonicalUrl: string,
  page: PageEntity,
): PageRouteType {
  // Authoritative mapping from PageEntity.page_type when set by scans.
  if (page.page_type === "homepage") return "home";
  if (page.page_type === "city_page") return "location";
  if (page.page_type === "service_page") return "service";
  if (page.page_type === "project_page") return "project";

  // Fall back to URL-path heuristics.
  let path: string;
  try {
    path = new URL(canonicalUrl).pathname.toLowerCase();
  } catch {
    return "other";
  }
  if (path === "/" || path === "") return "home";
  if (/^\/locations?\//.test(path)) return "location";
  if (/^\/services?\//.test(path)) return "service";
  if (/^(explore-)?projects?\//.test(path.slice(1))) return "project";
  if (/^\/(blog|posts?|articles?)\//.test(path)) return "blog";
  if (/^\/contact\/?$/.test(path)) return "contact";
  if (/-(bay-area|bay-area-.*)$/.test(path)) return "hub";
  return "other";
}

function pickFirst(arr: ReadonlyArray<string>): string | null {
  return arr[0] ?? null;
}

function extractOwnedHosts(
  activeEntities: ReadonlyArray<TrackedEntity>,
): Set<string> {
  const out = new Set<string>();
  for (const e of activeEntities) {
    if (!e.is_owned) continue;
    if (!e.domain) continue;
    const host = normalizeHost(e.domain);
    if (host) out.add(host);
  }
  return out;
}

function extractHost(rawUrl: string): string | null {
  try {
    return normalizeHost(new URL(rawUrl).host);
  } catch {
    const lowered = rawUrl.trim().toLowerCase();
    if (!lowered || lowered.startsWith("/")) return null;
    const withoutScheme = lowered.replace(/^https?:\/\//, "");
    const host = withoutScheme.split("/")[0] ?? "";
    return normalizeHost(host);
  }
}

function normalizeHost(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^www\./, "");
}

function hostIsOwned(host: string, ownedHosts: ReadonlySet<string>): boolean {
  if (ownedHosts.has(host)) return true;
  for (const owned of ownedHosts) {
    if (host.endsWith(`.${owned}`)) return true;
  }
  return false;
}
