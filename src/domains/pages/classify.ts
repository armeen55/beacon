import type { PageType, OwnershipTier } from "./types";
import type { SourceCategory } from "@/domains/citation-observations/types";
import { GEO_CONTAINMENT } from "@/domains/attribution/config";

// ── Known directory / social / institutional domains ────────────────

const DIRECTORY_DOMAINS = new Set([
  "houzz.com", "yelp.com", "bbb.org", "angi.com", "homeadvisor.com",
  "thumbtack.com", "buildzoom.com", "bark.com", "nextdoor.com",
  "porch.com", "manta.com", "superpages.com", "yellowpages.com",
]);

const SOCIAL_DOMAINS = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com",
  "x.com", "tiktok.com", "youtube.com", "pinterest.com",
]);

const INSTITUTION_DOMAINS = new Set([
  "wikipedia.org", "bls.gov", "census.gov",
]);

// ── Page type classification ────────────────────────────────────────

const CITY_PAGE_PATTERN = /^\/(locations|cities|areas|service-areas?)\/[^/]+\/?$/i;
const SERVICE_PAGE_PATTERN = /^\/(services|service|what-we-do)\/[^/]+\/?$/i;
const PROJECT_PAGE_PATTERN = /^\/(projects|portfolio|explore-projects|our-work|case-studies?)\/[^/]+\/?$/i;

export function classifyPageType(path: string, domain: string): PageType {
  const norm = path.replace(/\/+$/, "") || "/";

  if (DIRECTORY_DOMAINS.has(domain) || SOCIAL_DOMAINS.has(domain)) {
    return "directory_profile";
  }

  if (norm === "/" || norm === "") return "homepage";
  if (CITY_PAGE_PATTERN.test(norm)) return "city_page";
  if (SERVICE_PAGE_PATTERN.test(norm)) return "service_page";
  if (PROJECT_PAGE_PATTERN.test(norm)) return "project_page";

  return "other";
}

// ── Ownership classification ────────────────────────────────────────

export function classifyOwnership(
  domain: string,
  ownedDomains: Set<string>,
  sourceCategory?: SourceCategory
): OwnershipTier {
  if (ownedDomains.has(domain)) return "owned";
  if (DIRECTORY_DOMAINS.has(domain)) return "directory";
  if (SOCIAL_DOMAINS.has(domain)) return "social";
  if (INSTITUTION_DOMAINS.has(domain)) return "other";

  if (sourceCategory) {
    const map: Partial<Record<SourceCategory, OwnershipTier>> = {
      owned: "owned",
      competitor: "competitor",
      directory: "directory",
      earned_media: "earned_media",
      social: "social",
      ugc: "other",
      institution: "other",
      other: "other",
    };
    return map[sourceCategory] ?? "other";
  }

  return "competitor";
}

// ── City extraction from URL path ───────────────────────────────────

const ALL_CITIES = Object.values(GEO_CONTAINMENT).flat();

export function extractCityFromPath(path: string): string | null {
  const match = path.match(/\/locations\/([^/]+)/i);
  if (!match) return null;

  const slug = match[1].replace(/-/g, " ").toLowerCase().trim();
  const found = ALL_CITIES.find((c) => c === slug);
  return found ?? slug;
}

export function extractCityFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const city of ALL_CITIES) {
    if (lower.includes(city)) return city;
  }
  for (const metro of Object.keys(GEO_CONTAINMENT)) {
    if (lower.includes(metro)) return metro;
  }
  return null;
}

// ── URL parsing utilities ───────────────────────────────────────────

export function normalizePageUrl(raw: string, defaultDomain?: string): {
  url: string;
  domain: string;
  path: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length < 2) return null;

  if (trimmed.startsWith("/")) {
    if (!defaultDomain) return null;
    const domain = defaultDomain.toLowerCase().replace(/^www\./, "");
    return {
      url: `https://${domain}${trimmed.replace(/\/+$/, "") || "/"}`,
      domain,
      path: trimmed.replace(/\/+$/, "") || "/",
    };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      for (const key of [...u.searchParams.keys()]) {
        if (key.startsWith("utm_")) u.searchParams.delete(key);
      }
      u.hash = "";
      const domain = u.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
      const path = u.pathname.replace(/\/+$/, "") || "/";
      return { url: `https://${domain}${path}`, domain, path };
    } catch {
      return null;
    }
  }

  const hasSlash = trimmed.includes("/");
  const hasDot = trimmed.includes(".");
  if (hasDot && !hasSlash) {
    const domain = trimmed.toLowerCase().replace(/^www\./, "");
    return { url: `https://${domain}/`, domain, path: "/" };
  }

  return null;
}

// ── Opaque URL detection (non-structural values) ────────────────────

const OPAQUE_VALUES = new Set([
  "profound", "all pages", "google business profile", "gbp",
  "n/a", "none", "unknown", "baseline", "sitewide",
]);

export function isOpaqueUrl(raw: string): boolean {
  return OPAQUE_VALUES.has(raw.trim().toLowerCase());
}
