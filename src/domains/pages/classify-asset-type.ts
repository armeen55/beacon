/**
 * Phase 1 — Canonical asset-type classifier.
 *
 * Single source of truth for mapping a URL/path to a `AssetType` enum value.
 * Promoted from the 7-line `inferAssetType()` in `src/app/(shell)/finding-actions.ts`
 * (which covered only 4 of the 11 enum values) to a full classifier covering
 * every `AssetType` including `process_page`, `brand_page`, and `hub_page`.
 *
 * Rules are applied in precedence order. First match wins. Deterministic,
 * rule-based, no ML. If the URL doesn't match any rule, `service_page` is the
 * default fallback (matching legacy `inferAssetType()` behavior so existing
 * call sites see no regression).
 *
 * This classifier is tenant-agnostic in intent but the specific page-name
 * regexes below (e.g., `/luxury-home-builder-bay-area`) reflect the
 * ritz-builders URL scheme. Adapt when Beacon serves multiple tenants.
 */

import type { AssetType } from "@/lib/constants";

/**
 * Classify a URL path into an `AssetType`.
 *
 * @param urlOrPath Full URL, absolute path, or null/undefined.
 * @returns AssetType — never throws; defaults to `service_page` when
 *          no rule matches.
 */
export function classifyAssetType(
  urlOrPath: string | null | undefined,
): AssetType {
  if (!urlOrPath) return "homepage";

  // Normalize: strip scheme+host, strip trailing slashes, lowercase.
  const path = String(urlOrPath)
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();

  // Empty path after stripping → homepage.
  if (!path || path === "") return "homepage";

  // ── Exact-match hubs (must precede prefix matching) ───────────────
  // `/locations` is a hub; `/locations/atherton` is a city_page.
  if (
    path === "/locations" ||
    path === "/services" ||
    path === "/explore-projects" ||
    path === "/projects" ||
    path === "/available-homes"
  ) {
    return "hub_page";
  }

  // ── Infrastructure / sitemap files ────────────────────────────────
  if (
    /\.(txt|xml)$/i.test(path) ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return "sitemap";
  }

  // ── City pages: /locations/<slug> (plural) or /location/<slug> (singular, legacy/other-tenant)
  if (/^\/locations?\/[^/]+/.test(path)) return "city_page";

  // ── Service pages: /services/<slug> (plural) or /service/<slug> (singular)
  if (/^\/services?\/[^/]+/.test(path)) return "service_page";

  // ── Project pages: /explore-projects/<slug>, /projects/<slug>, /project/<slug>, /available-homes/<slug>
  if (
    /^\/(explore-projects?|projects?|available-homes)\/[^/]+/.test(path)
  ) {
    return "project_page";
  }

  // ── Process pages (explicit whitelist) ────────────────────────────
  if (/^\/(our-process|our-approach|how-we-work)$/.test(path)) {
    return "process_page";
  }

  // ── Brand pages (explicit whitelist) ──────────────────────────────
  // `our-*` pages, /about-us, /design-studio, and the two top-level
  // service-area brand pitches that lead AI citations for Ritz.
  if (
    /^\/(our-difference|our-partners|our-awards|about-us|design-studio|faq|platform-info|privacy-policy)$/.test(
      path,
    ) ||
    /^\/(luxury-home-builder-bay-area|custom-home-builder-bay-area)$/.test(path)
  ) {
    return "brand_page";
  }

  // ── Lead-capture / contact ─────────────────────────────────────────
  if (/^\/(contact-us|contact|get-started)$/.test(path)) {
    return "lead_form";
  }

  // ── Default fallback ──────────────────────────────────────────────
  // Matches legacy `inferAssetType()` behavior so existing call sites
  // see no behavioral change for URLs that don't match any rule above.
  return "service_page";
}
