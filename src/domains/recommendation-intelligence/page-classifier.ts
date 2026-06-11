/**
 * 2026-05-19 — Slice 4.5.B.α₂.2 — page-intelligence classifier.
 *
 * Universal page-type classifier that EVERY recommendation-
 * intelligence trigger predicate must consult BEFORE emitting a
 * candidate. The premise: a trigger isn't meaningful in isolation
 * — its applicability depends on what kind of page is being
 * analyzed.
 *
 * **Operator-locked principle**: every website is different;
 * billions of variations exist. This module MUST stay pattern-
 * based and config-driven. It MUST NOT hardcode tenant-specific
 * URL slugs (no "ritz", no "palo-alto", no "whole-home-remodel"
 * — none of these belong here).
 *
 * Classification priority (first match wins):
 *   1. `technical_asset` — non-HTML files (`.txt`, `.xml`, `.json`,
 *      `.pdf`, images, video/audio, manifests, source maps, etc.).
 *      Universal — applies regardless of `BusinessConfig`.
 *   2. `homepage` — path is `/` or empty.
 *   3. `city` / `service` / `project` (detail) — path matches one
 *      of `BusinessConfig.urlPatterns.{city,service,project}` AS A
 *      LEADING PATH SEGMENT AND has a non-empty slug after.
 *      Critical: prefix match is segment-bounded (not substring
 *      `includes`) so `/explore-projects` doesn't false-positive
 *      against `urlPatterns.project: "/projects/"` and `/locations`
 *      hub doesn't false-positive against `urlPatterns.city:
 *      "/locations/"`.
 *   4. `hub` — path matches one of the urlPattern prefixes WITHOUT
 *      a detail slug (e.g., `/locations` itself, `/services`
 *      itself). Also covers universal hub names like
 *      `/available-homes`, `/portfolio`, `/blog`, `/news`,
 *      `/resources`, `/case-studies`, `/testimonials`, `/reviews`,
 *      `/explore-projects` when they're the entire path (no
 *      trailing slug).
 *   5. `utility` — well-known English utility/legal/about/contact
 *      slug patterns matched against ANY path segment (segment-
 *      boundary match; no substring false positives). Generic and
 *      universal — not tenant-specific.
 *   6. `other` — fallback. Conservative: when unsure, classify as
 *      "other" rather than guessing city/service/project. Trigger
 *      applicability for "other" pages is decided per-predicate
 *      (most predicates skip; missing-* still fires because a
 *      missing title/meta/h1 is a real bug on any HTML page).
 *
 * Trigger applicability (consumed by the 7 α-family predicates):
 *
 *   | Predicate           | Applies to                              |
 *   |---------------------|------------------------------------------|
 *   | missing_title       | every HTML page (skip technical_asset)   |
 *   | missing_meta        | every HTML page (skip technical_asset)   |
 *   | missing_h1          | every HTML page (skip technical_asset)   |
 *   | weak_h1             | city + service ONLY                      |
 *   | title_h1_mismatch   | homepage + city + service ONLY           |
 *   | duplicate_title     | every HTML page (skip technical_asset)   |
 *   | duplicate_meta      | every HTML page (skip technical_asset)   |
 *
 * Pinned by:
 *   • tests/domains/recommendation-intelligence/page-classifier.test.ts
 *   • tests/architecture/recommendation-triggers-page-classifier-applied.test.ts
 */

import type { BusinessConfig } from "@/lib/business-config";

export type PageType =
  | "homepage"
  | "city"
  | "service"
  | "project"
  | "hub"
  | "utility"
  | "technical_asset"
  /**
   * P0 wall 3 (2026-06-10): a topical content detail page on a
   * content-site tenant (encyclopedia entry, article, glossary page).
   * Assigned ONLY when `BusinessConfig.contentSiteMode === true` —
   * config-driven, never inferred from vertical-specific vocab.
   * Content-edit triggers apply (unlike "other").
   */
  | "content"
  | "other";

/** File extensions that classify the URL as a non-HTML asset.
 *  Universal — no tenant config needed. */
const NON_HTML_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt",
  "xml",
  "json",
  "pdf",
  "css",
  "js",
  "map",
  "webmanifest",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "ico",
  "webp",
  "avif",
  "mp4",
  "mov",
  "mp3",
  "wav",
  "webm",
  "ogg",
]);

/** Universal English utility / legal / about / contact path-segment
 *  patterns. Matched against ANY single path segment (segment-
 *  boundary match — NOT substring) so `/about-modern-design` does
 *  NOT match `"about"`. Generic and tenant-agnostic — operator-
 *  approved per the α₂.2 scope lock. */
const UTILITY_SEGMENT_PATTERNS: ReadonlySet<string> = new Set([
  // Privacy / legal / terms
  "privacy",
  "privacy-policy",
  "privacy-statement",
  "privacy-notice",
  "terms",
  "terms-of-service",
  "terms-of-use",
  "terms-and-conditions",
  "tos",
  "legal",
  "legal-notice",
  "disclaimer",
  // Cookies / accessibility
  "cookie",
  "cookies",
  "cookie-policy",
  "cookie-notice",
  "accessibility",
  "accessibility-statement",
  // Platform / sitemap
  "platform-info",
  "sitemap",
  // Contact
  "contact",
  "contact-us",
  "get-in-touch",
  "reach-us",
  // About / team
  "about",
  "about-us",
  "our-story",
  "our-company",
  "who-we-are",
  "team",
  "our-team",
  "leadership",
  "staff",
  // Careers
  "careers",
  "career",
  "jobs",
  "join-us",
  "join-our-team",
  "open-positions",
  // FAQ / help
  "faq",
  "faqs",
  "frequently-asked-questions",
  "help",
  "support",
  // Partners / press
  "partners",
  "our-partners",
  "partnerships",
  "press",
  "media",
  "newsroom",
]);

/** Universal hub-page names. Match when the entire URL path is
 *  exactly one of these segments (with optional trailing slash).
 *  These pages typically list items but don't represent a single
 *  topical detail page. Generic and tenant-agnostic. */
const UNIVERSAL_HUB_PATTERNS: ReadonlySet<string> = new Set([
  "available-homes",
  "portfolio",
  "blog",
  "news",
  "resources",
  "case-studies",
  "testimonials",
  "reviews",
  "explore-projects",
  "projects-archive",
]);

function getPath(url: string): string {
  const noProtocol = url.replace(/^https?:\/\/[^/]+/, "");
  const beforeQuery = noProtocol.split(/[?#]/)[0] ?? "";
  return beforeQuery.toLowerCase();
}

function getExtension(path: string): string | null {
  // Use last path segment only — don't pick up dots in earlier
  // segments (e.g., `/v1.2/about` should not look like a `.2/about`
  // extension).
  const lastSegment = path.split("/").pop() ?? "";
  const idx = lastSegment.lastIndexOf(".");
  if (idx <= 0) return null;
  return lastSegment.slice(idx + 1).toLowerCase();
}

export function isNonHtmlAsset(url: string): boolean {
  const ext = getExtension(getPath(url));
  return ext != null && NON_HTML_EXTENSIONS.has(ext);
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

function normalizePrefix(prefix: string): string {
  let p = prefix.toLowerCase();
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.endsWith("/")) p = p + "/";
  return p;
}

/** Segment-bounded detail check: the path MUST start with the
 *  full prefix AND have at least one more character after. This
 *  prevents `/explore-projects` from being classified as a
 *  `urlPatterns.project: "/projects/"` detail page. */
function isDetail(path: string, prefix: string | undefined): boolean {
  if (!prefix) return false;
  const p = normalizePrefix(prefix);
  if (!path.startsWith(p)) return false;
  return path.length > p.length;
}

/** Hub check: path equals the prefix's hub form (with or without
 *  trailing slash). E.g., for `urlPatterns.city: "/locations/"`,
 *  `/locations` and `/locations/` are both hubs. */
function isHub(path: string, prefix: string | undefined): boolean {
  if (!prefix) return false;
  const p = normalizePrefix(prefix);
  const hubPath = p.replace(/\/$/, "");
  return path === hubPath || path === hubPath + "/";
}

function isUtilityPath(path: string): boolean {
  const segs = pathSegments(path);
  if (segs.length === 0) return false;
  return segs.some((seg) => UTILITY_SEGMENT_PATTERNS.has(seg));
}

function isUniversalHubPath(path: string): boolean {
  const segs = pathSegments(path);
  if (segs.length !== 1) return false;
  return UNIVERSAL_HUB_PATTERNS.has(segs[0]!);
}

export function classifyPageType(
  url: string,
  config: BusinessConfig,
): PageType {
  // 1. Non-HTML asset always wins.
  if (isNonHtmlAsset(url)) return "technical_asset";

  const path = getPath(url);

  // 2. Homepage.
  if (path === "" || path === "/") return "homepage";

  // 3. Operator-configured urlPatterns: detail pages first.
  const patterns = config.urlPatterns;
  if (isDetail(path, patterns?.city)) return "city";
  if (isDetail(path, patterns?.service)) return "service";
  if (isDetail(path, patterns?.project)) return "project";

  // 4. Operator-configured urlPatterns: hubs (no detail slug).
  if (
    isHub(path, patterns?.city) ||
    isHub(path, patterns?.service) ||
    isHub(path, patterns?.project)
  ) {
    return "hub";
  }

  // 5. Universal hub names (path is a single segment matching a
  //    well-known hub name).
  if (isUniversalHubPath(path)) return "hub";

  // 6. Universal utility / legal / about / contact patterns.
  if (isUtilityPath(path)) return "utility";

  // 7. Conservative fallback heuristics — only when the operator
  //    hasn't configured the corresponding urlPattern. Mirrors
  //    α₁'s weak-h1 fallback list but with segment-boundary
  //    matching and detail-vs-hub distinction.
  if (!patterns?.city) {
    if (path.startsWith("/locations/") && path.length > "/locations/".length) {
      return "city";
    }
    if (path === "/locations" || path === "/locations/") return "hub";
  }
  if (!patterns?.service) {
    if (path.startsWith("/services/") && path.length > "/services/".length) {
      return "service";
    }
    if (path === "/services" || path === "/services/") return "hub";
  }
  if (!patterns?.project) {
    if (path.startsWith("/projects/") && path.length > "/projects/".length) {
      return "project";
    }
    if (path === "/projects" || path === "/projects/") return "hub";
  }

  // 8. Content-site mode (P0 wall 3, 2026-06-10): on tenants whose
  //    config declares contentSiteMode, the remaining HTML pages ARE
  //    the product — encyclopedia entries, articles, glossary pages.
  //    Classify them "content" so content-edit triggers apply.
  if (config.contentSiteMode === true) return "content";

  // 9. Fallback.
  return "other";
}
