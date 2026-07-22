/**
 * fetch-site-profile — pure URL/nav helpers (Core 100K).
 *
 * The heavyweight site-profile fetch (homepage + about/contact → ≤3 pages
 * for deriveBusinessProfile) was retired with the legacy onboarding wizard.
 * What survives are two pure helpers still used across the app:
 *
 *   - normalizeSiteUrl: accept whatever a stranger types → https homepage
 *     URL + bare domain (used by the URL-entry step and launch-config).
 *   - pickSecondaryPaths: same-site about/contact candidates from a
 *     homepage's own nav (reused by the cold-start crawler in
 *     domains/scanning/in-process-scan for sitemap-less small sites).
 *
 * No LLM, no paid APIs, no network — both helpers are pure.
 */

import { load as cheerioLoad } from "cheerio";

const MAX_PAGES = 3;
const SECONDARY_PATH_PATTERN = /about|contact/i;

/**
 * Accepts what a stranger actually types: "acme.com", "www.acme.com",
 * "https://acme.com/some/page". Returns the https homepage URL + bare
 * domain, or null when it can't be a website address.
 */
export function normalizeSiteUrl(
  raw: string,
): { homepageUrl: string; domain: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length < 4) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    const host = u.hostname.toLowerCase();
    if (!host.includes(".") || /\s/.test(host)) return null;
    const domain = host.replace(/^www\./, "");
    return { homepageUrl: `https://${host}/`, domain };
  } catch {
    return null;
  }
}

/** Secondary-page candidates from the homepage's own nav, falling back
 *  to the conventional paths. Same-origin only, deduped, capped. */
export function pickSecondaryPaths(homepageHtml: string): string[] {
  const $ = cheerioLoad(homepageHtml);
  const fromNav: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/^(https?:)?\/\//i.test(href) || /^(mailto|tel|javascript):/i.test(href)) {
      return; // external/protocol links — secondary pages are same-site paths
    }
    const path = href.split(/[?#]/)[0]!;
    if (!path.startsWith("/")) return;
    if (SECONDARY_PATH_PATTERN.test(path) && !fromNav.includes(path)) {
      fromNav.push(path);
    }
  });
  const candidates = [...fromNav, "/about", "/contact"];
  const deduped: string[] = [];
  for (const c of candidates) {
    const normalized = c.replace(/\/+$/, "") || "/";
    if (normalized !== "/" && !deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  }
  return deduped.slice(0, MAX_PAGES - 1);
}
