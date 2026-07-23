import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getBusinessProfile } from "@/lib/business-config";

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

const cachedByTenant = new Map<string, SiteConfig>();

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

function readConfig(tenantId: string | null): SiteConfig {
  let tenantBusiness: { domain?: string; name?: string } | null = null;
  if (tenantId) {
    try {
      const config = getBusinessProfile(tenantId);
      if (!config.__placeholder) tenantBusiness = config;
    } catch { /* use explicit env/file fallback */ }
  }
  const raw = process.env.BEACON_SITE_DOMAIN?.trim();
  const tenantDomain = tenantBusiness?.domain?.trim();
  const fromConfig = !tenantDomain && (!raw || raw.length === 0) ? domainFromBusinessConfig() : null;
  const siteDomain = (tenantDomain || (raw && raw.length > 0 ? raw : fromConfig ?? "example.com"))
    .toLowerCase()
    .replace(/^www\./, "");
  // A process-global origin is safe only when no tenant-specific config won.
  let siteOrigin = tenantDomain
    ? ""
    : (process.env.BEACON_SITE_ORIGIN ?? "").trim().replace(/\/+$/, "");
  if (!siteOrigin) siteOrigin = `https://${siteDomain}`;
  const ownedBrandShort =
    tenantBusiness?.name?.trim() ||
    (process.env.BEACON_SITE_BRAND_SHORT ?? "You").trim() ||
    "You";
  const entityDisplayName =
    (process.env.BEACON_SITE_ENTITY_NAME ?? "").trim() ||
    (ownedBrandShort !== "You"
      ? ownedBrandShort
      : siteDomain === "example.com"
        ? "Example Homes"
        : defaultEntityName(siteDomain));
  return { siteOrigin, siteDomain, ownedBrandShort, entityDisplayName };
}

export function getSiteConfig(tenantId?: string): SiteConfig {
  const resolvedTenantId = tenantId?.trim() || process.env.BEACON_TENANT_ID?.trim() || null;
  const cacheKey = resolvedTenantId ?? "__legacy_global__";
  const cached = cachedByTenant.get(cacheKey);
  if (cached) return cached;
  const config = readConfig(resolvedTenantId);
  cachedByTenant.set(cacheKey, config);
  return config;
}

/** Tests only — env is read once per process unless reset */
export function resetSiteConfigCache(): void {
  cachedByTenant.clear();
}

export function absoluteUrlForPath(path: string, tenantId?: string): string {
  const { siteOrigin } = getSiteConfig(tenantId);
  const p = path.startsWith("/") ? path : `/${path}`;
  const joined = `${siteOrigin.replace(/\/+$/, "")}${p}`;
  return joined.replace(/\/+$/, "") || siteOrigin.replace(/\/+$/, "");
}

/** Origins to strip when normalizing URLs to site-relative paths. */
function ownedUrlPrefixes(tenantId?: string): string[] {
  const { siteOrigin, siteDomain } = getSiteConfig(tenantId);
  // Only the account's own domain identity is ever stripped. When no domain
  // is configured the list stays generic and empty-ish; another business's
  // host must never appear here.
  const base = [
    siteOrigin.replace(/\/+$/, ""),
    `https://${siteDomain}`,
    `http://${siteDomain}`,
  ];
  const extra =
    process.env.BEACON_EXTRA_URL_STRIP_PREFIXES?.split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean) ?? [];
  return [...base, ...extra];
}

export function stripSiteOrigin(fullUrl: string, tenantId?: string): string {
  const norm = fullUrl.replace(/\/+$/, "");
  for (const prefix of ownedUrlPrefixes(tenantId)) {
    if (norm.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = norm.slice(prefix.length) || "/";
      return rest.startsWith("/") ? rest : `/${rest}`;
    }
  }
  return fullUrl;
}
