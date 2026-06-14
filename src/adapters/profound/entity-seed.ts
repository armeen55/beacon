/**
 * Entity seeding from citation hostnames and summarized asset names.
 *
 * Creates TrackedEntity records from known domains.
 * Does NOT blindly trust summarized assets — classifies and filters.
 */

import "server-only";

import type { TrackedEntity } from "@/domains/tracked-entities/types";
import { getSiteConfig } from "@/lib/site-config";

const COMPETITOR_DOMAINS: Record<string, string> = {
  "constructelements.com": "Element Homes",
  "valleyboutiquebuilders.com": "Valley Boutique Builders",
  "supplehomesinc.com": "Supple Homes",
  "craftsmensguild.com": "Craftsmen's Guild",
  "greenberg.construction": "Greenberg Construction",
  "demattei.com": "De Mattei Construction",
  "baysidebuildersgroup.com": "Bayside Builders Group",
  "baybuilders.com": "Bay Builders",
  "valleyhomebuilders.com": "Valley Home Builders",
  "noadesignbuild.com": "Noa Design Build",
  "goldengategroupinc.com": "Golden Gate Group",
  "siliconvalleybuilders.com": "Silicon Valley Builders",
  "customhome.us": "Custom Home US",
  "crcbuildersinc.com": "CRC Builders",
  "wisebuilders.org": "Wise Builders",
  "feldman.construction": "Feldman Construction",
  "icb.builders": "ICB Builders",
  "kastenbuilders.com": "Kasten Builders",
  "barccibuilders.com": "Barcci Builders",
  "artluxuryhomebuilder.com": "Art Luxury Home Builder",
  "paragoncb.com": "Paragon Custom Builders",
  "formagc.com": "Forma GC",
  "darco-ca.com": "DARCO",
  "casautopia.com": "Casa Utopia",
  "at6db.com": "AT6 Design Build",
};

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

export function buildEntitySeed(accountId: string): {
  entities: TrackedEntity[];
  ownedDomains: string[];
  domainToEntityId: Map<string, string>;
} {
  const now = new Date().toISOString();
  const entities: TrackedEntity[] = [];
  const domainToEntityId = new Map<string, string>();
  const { siteDomain, entityDisplayName } = getSiteConfig();
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

  for (const [domain, name] of Object.entries(COMPETITOR_DOMAINS)) {
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
