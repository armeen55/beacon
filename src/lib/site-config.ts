import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Single-tenant site settings. Override with env for another builder site.
 *
 * BEACON_SITE_DOMAIN     — canonical hostname (set this for every pilot)
 * BEACON_SITE_ORIGIN     — full origin, e.g. https://example.com (optional)
 * BEACON_SITE_BRAND_SHORT — short label for competitive copy ("You", "Acme Homes", …)
 * BEACON_SITE_ENTITY_NAME — legal/marketing name for imports and entity normalization
 *
 * Defaults are product-neutral (example.com / “Your site”). Bundled demo `.data` URLs
 * still normalize when BEACON_SITE_DOMAIN is unset — see stripSiteOrigin().
 */

export type SiteConfig = {
  siteOrigin: string;
  siteDomain: string;
  ownedBrandShort: string;
  /** Human name for owned entity (imports, seeds); defaults from domain if unset */
  entityDisplayName: string;
};

let cached: SiteConfig | null = null;

function defaultEntityName(domain: string): string {
  const stem = domain.split(".")[0] ?? domain;
  if (!stem) return "Your business";
  return stem.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function explicitSiteDomainSet(): boolean {
  return Boolean(process.env.BEACON_SITE_DOMAIN?.trim());
}

function domainFromBusinessConfig(): string | null {
  try {
    const p = join(process.cwd(), ".data", "business-config.json");
    if (!existsSync(p)) return null;
    const j = JSON.parse(readFileSync(p, "utf8")) as { domain?: unknown };
    if (typeof j.domain === "string") {
      const d = j.domain.trim().toLowerCase().replace(/^www\./, "");
      if (d.length > 0) return d;
    }
  } catch { /* ignore */ }
  return null;
}

function readConfig(): SiteConfig {
  const raw = process.env.BEACON_SITE_DOMAIN?.trim();
  const fromConfig = !raw || raw.length === 0 ? domainFromBusinessConfig() : null;
  const siteDomain = (raw && raw.length > 0 ? raw : fromConfig ?? "example.com")
    .toLowerCase()
    .replace(/^www\./, "");
  let siteOrigin = (process.env.BEACON_SITE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!siteOrigin) siteOrigin = `https://${siteDomain}`;
  const ownedBrandShort =
    (process.env.BEACON_SITE_BRAND_SHORT ?? "You").trim() || "You";
  const entityDisplayName =
    (process.env.BEACON_SITE_ENTITY_NAME ?? "").trim() ||
    (ownedBrandShort !== "You"
      ? ownedBrandShort
      : siteDomain === "example.com"
        ? "Example Homes"
        : defaultEntityName(siteDomain));
  return { siteOrigin, siteDomain, ownedBrandShort, entityDisplayName };
}

export function getSiteConfig(): SiteConfig {
  if (!cached) cached = readConfig();
  return cached;
}

/** Tests only — env is read once per process unless reset */
export function resetSiteConfigCache(): void {
  cached = null;
}

export function absoluteUrlForPath(path: string): string {
  const { siteOrigin } = getSiteConfig();
  const p = path.startsWith("/") ? path : `/${path}`;
  const joined = `${siteOrigin.replace(/\/+$/, "")}${p}`;
  return joined.replace(/\/+$/, "") || siteOrigin.replace(/\/+$/, "");
}

/** Origins to strip when normalizing URLs to site-relative paths. */
function ownedUrlPrefixes(): string[] {
  const { siteOrigin, siteDomain } = getSiteConfig();
  const base = [
    siteOrigin.replace(/\/+$/, ""),
    `https://${siteDomain}`,
    `http://${siteDomain}`,
  ];
  if (!explicitSiteDomainSet()) {
    // Bundled sample data often uses this host; strip it even when config defaults are neutral.
    base.push(
      "https://ritzbuilders.com",
      "http://ritzbuilders.com",
      "https://www.ritzbuilders.com",
      "http://www.ritzbuilders.com"
    );
  }
  const extra =
    process.env.BEACON_EXTRA_URL_STRIP_PREFIXES?.split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean) ?? [];
  return [...base, ...extra];
}

export function stripSiteOrigin(fullUrl: string): string {
  const norm = fullUrl.replace(/\/+$/, "");
  for (const prefix of ownedUrlPrefixes()) {
    if (norm.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = norm.slice(prefix.length) || "/";
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
  }
  return fullUrl;
}
