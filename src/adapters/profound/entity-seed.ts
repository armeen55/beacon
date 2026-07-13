/**
 * Entity seeding from citation hostnames and summarized asset names.
 *
 * Creates TrackedEntity records from known domains.
 * Does NOT blindly trust summarized assets — classifies and filters.
 */

import "server-only";

import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { BusinessConfig } from "@/lib/business-config";

const DIRECTORY_DOMAINS: Record<string, string> = {
  "houzz.com": "Houzz",
  "yelp.com": "Yelp",
  "angi.com": "Angi",
  "homeadvisor.com": "HomeAdvisor",
  "thumbtack.com": "Thumbtack",
  "buildzoom.com": "BuildZoom",
  "bbb.org": "BBB",
  "diamondcertified.org": "Diamond Certified",
  "generalcontractors.org": "General Contractors",
  "homebuilderdigest.com": "Home Builder Digest",
  "homeguide.com": "HomeGuide",
};

const SOCIAL_DOMAINS: Record<string, string> = {
  "reddit.com": "Reddit",
  "youtube.com": "YouTube",
  "pinterest.com": "Pinterest",
};

function makeId(prefix: string, domain: string): string {
  return `${prefix}-${domain.replace(/\./g, "-")}`;
}

function configuredCompetitorDomains(
  competitors: string[],
): Array<{ domain: string; name: string }> {
  const seen = new Set<string>();
  const result: Array<{ domain: string; name: string }> = [];
  for (const value of competitors) {
    const raw = value.trim();
    if (!raw) continue;
    let hostname: string;
    try {
      hostname = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    } catch {
      continue;
    }
    const domain = hostname.toLowerCase().replace(/^www\./, "");
    if (!domain.includes(".") || seen.has(domain)) continue;
    seen.add(domain);
    result.push({ domain, name: domain });
  }
  return result;
}

export function buildEntitySeed(
  accountId: string,
  business: Pick<BusinessConfig, "domain" | "name" | "primaryCompetitors">,
): {
  entities: TrackedEntity[];
  ownedDomains: string[];
  domainToEntityId: Map<string, string>;
} {
  const now = new Date().toISOString();
  const entities: TrackedEntity[] = [];
  const domainToEntityId = new Map<string, string>();
  const siteDomain = business.domain.trim().toLowerCase().replace(/^www\./, "");
  if (!siteDomain || !siteDomain.includes(".")) {
    throw new Error("Profound import requires a valid tenant business domain");
  }
  const entityDisplayName = business.name.trim();
  if (!entityDisplayName) {
    throw new Error("Profound import requires a tenant business name");
  }
  const ownedDomains = [siteDomain];

  for (const domain of ownedDomains) {
    const id = makeId("own", domain);
    entities.push({
      id,
      account_id: accountId,
      entity_type: "brand",
      name: entityDisplayName,
      domain,
      url: `https://${domain}`,
      // De-verticalized (2026-06-15): the owned brand entity no longer gets a
      // hardcoded "Bay Area" / "custom home building" scope — that stamped a
      // founder-vertical scope onto EVERY tenant's owned entity on Profound
      // import. null (unknown) is honest + matches the non-owned entities; a
      // per-tenant scope from BusinessConfig (locations/services) is a tracked
      // follow-up (see docs/DEVERTICALIZE_FINDINGS_2026-06-15.md).
      location_scope: null,
      service_scope: null,
      is_owned: true,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    });
    domainToEntityId.set(domain, id);
  }

  for (const { domain, name } of configuredCompetitorDomains(
    business.primaryCompetitors,
  )) {
    const id = makeId("comp", domain);
    entities.push({
      id,
      account_id: accountId,
      entity_type: "competitor",
      name,
      domain,
      url: `https://${domain}`,
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    });
    domainToEntityId.set(domain, id);
  }

  for (const [domain, name] of Object.entries(DIRECTORY_DOMAINS)) {
    const id = makeId("dir", domain);
    entities.push({
      id,
      account_id: accountId,
      entity_type: "directory_source",
      name,
      domain,
      url: `https://${domain}`,
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: true,
      metadata: {},
      created_at: now,
      updated_at: now,
    });
    domainToEntityId.set(domain, id);
  }

  for (const [domain, name] of Object.entries(SOCIAL_DOMAINS)) {
    const id = makeId("soc", domain);
    entities.push({
      id,
      account_id: accountId,
      entity_type: "domain",
      name,
      domain,
      url: `https://${domain}`,
      location_scope: null,
      service_scope: null,
      is_owned: false,
      is_active: false,
      metadata: { category: "social" },
      created_at: now,
      updated_at: now,
    });
    domainToEntityId.set(domain, id);
  }

  return {
    entities,
    ownedDomains: [...ownedDomains],
    domainToEntityId,
  };
}
