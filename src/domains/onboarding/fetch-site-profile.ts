/**
 * fetch-site-profile — North-star onboarding (2026-06-11).
 *
 * Pulls the small page set `deriveBusinessProfile` reads: the homepage
 * plus up to two secondary pages most likely to carry NAP/schema (about
 * + contact), discovered from the homepage's own nav (conventional
 * /about, /contact as fallback candidates). Reuses the competitor-intel
 * polite fetcher: identified UA, robots.txt respected, hard timeout,
 * SEQUENTIAL fetches only, ≤3 pages total — an onboarding derivation
 * costs a stranger's site almost nothing.
 *
 * No LLM, no paid APIs. `fetchImpl` injectable so tests never touch the
 * network.
 */

import { load as cheerioLoad } from "cheerio";

import {
  fetchPageHtml,
  type PoliteFetchDeps,
} from "@/domains/competitor-intel/polite-fetch";
import type { FetchedPage } from "./derive-business-profile";

const MAX_PAGES = 3;
const SECONDARY_PATH_PATTERN = /about|contact/i;

export type SiteProfileFetchResult =
  | {
      ok: true;
      /** Homepage FIRST — `deriveBusinessProfile`'s contract. */
      pages: FetchedPage[];
      /** Canonical homepage URL actually fetched (post-normalization). */
      homepageUrl: string;
      /** Lowercased host without www — ready for BusinessConfig.domain. */
      domain: string;
    }
  | { ok: false; reason: "invalid_url" | "homepage_unreachable"; detail?: string };

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

/**
 * Fetch the profile page set for a site. Homepage failure is fatal
 * (nothing to derive from); a secondary page failing or being
 * robots-blocked is silently skipped — the homepage alone is enough for
 * a partial profile.
 */
export async function fetchSiteProfilePages(
  rawUrl: string,
  deps: PoliteFetchDeps & {
    /** Cap total pages (1..3). Default 3. The onboarding business step
     *  passes 1 (homepage-only) to keep the form submit fast; launch
     *  uses the full default for the richer derivation. */
    maxPages?: number;
  } = {},
): Promise<SiteProfileFetchResult> {
  const normalized = normalizeSiteUrl(rawUrl);
  if (!normalized) return { ok: false, reason: "invalid_url" };

  const maxPages = Math.max(1, Math.min(deps.maxPages ?? MAX_PAGES, MAX_PAGES));
  const robotsCache = new Map<string, string[]>();
  const homepage = await fetchPageHtml(
    normalized.homepageUrl,
    robotsCache,
    deps,
  );
  if (!homepage.ok) {
    return {
      ok: false,
      reason: "homepage_unreachable",
      detail: homepage.reason === "robots_blocked" ? "robots_blocked" : homepage.detail,
    };
  }

  const pages: FetchedPage[] = [
    { url: normalized.homepageUrl, html: homepage.html },
  ];
  for (const path of pickSecondaryPaths(homepage.html)) {
    if (pages.length >= maxPages) break;
    const url = `https://${new URL(normalized.homepageUrl).hostname}${path}`;
    const res = await fetchPageHtml(url, robotsCache, deps);
    if (res.ok) pages.push({ url, html: res.html });
  }

  return {
    ok: true,
    pages,
    homepageUrl: normalized.homepageUrl,
    domain: normalized.domain,
  };
}
