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
    if (!page.is_owned) continue;
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
  return raw.filter((t) => t.length >= 3 && !stopwords.has(t));
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

    // Boost: cluster label is a substring of URL path.
    const lowerUrl = entry.url.toLowerCase();
    const pathMatches = clusterTokens.filter((t) => lowerUrl.includes(t));
    if (pathMatches.length === clusterTokens.length) {
      score += 0.25;
      reasons.push("all label tokens appear in URL path");
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

    matches.push({
      url: entry.url,
      score: Math.min(score, 1),
      reasons,
      entry,
    });
  }

  matches.sort(
    (a, b) => b.score - a.score || a.url.localeCompare(b.url),
  );
  return matches.slice(0, topN);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

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
