/**
 * city-service-factory (2026-06-25, Sprint 6 · plan P12) — PURE.
 *
 * The local-service half of the programmatic page factory (parallel to
 * entity-attribute-factory's content half). Given a tenant's service areas
 * (cities) × services, it generates deduped `create_page` candidates for the
 * city×service matrix a local business needs ("ADU builder in Palo Alto").
 *
 * Tenant-agnostic + config-driven: cities + services come from the caller (tenant
 * config / GSC geo terms), NEVER hardcoded. Every candidate is marked
 * `needsDemandValidation` — no volume is invented; DataForSEO confirms demand
 * before it becomes a real Move. Deduped against existing owned pages.
 *
 * Pinned by city-service-factory.test.ts.
 */

export type CityServiceCandidate = {
  slug: string;
  title: string;
  city: string;
  service: string;
  /** 1 when both city + service echo the tenant's own vocabulary, else 0.5. */
  relevance: number;
  needsDemandValidation: boolean;
  why: string;
};

export type CityServiceInput = {
  /** Service-area cities (from tenant config or GSC geo terms). */
  cities: string[];
  /** Services the tenant offers. */
  services: string[];
  /** Owned page URLs — for dedup (don't propose a page that already exists). */
  ownedUrls: string[];
  /** Optional brand/qualifier woven into the title (e.g. "custom home builder"). */
  titleQualifier?: string;
  maxCandidates?: number;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Generate deduped city × service create_page candidates. PURE. */
export function generateCityServiceCandidates(input: CityServiceInput): CityServiceCandidate[] {
  const cities = [...new Set((input.cities ?? []).map((c) => c.trim()).filter(Boolean))];
  const services = [...new Set((input.services ?? []).map((s) => s.trim()).filter(Boolean))];
  if (cities.length === 0 || services.length === 0) return [];

  const max = input.maxCandidates ?? 60;
  // Existing-coverage index: normalized tokens present in owned URLs.
  const ownedBlob = (input.ownedUrls ?? []).map((u) => norm(u)).join(" ");
  const ownedSlugs = new Set((input.ownedUrls ?? []).map((u) => slugify(u.replace(/^https?:\/\/[^/]+/i, ""))));

  const out: CityServiceCandidate[] = [];
  const seen = new Set<string>();

  for (const service of services) {
    for (const city of cities) {
      if (out.length >= max) break;
      const slug = slugify(`${service}-${city}`);
      if (seen.has(slug)) continue;
      seen.add(slug);
      // Dedup: skip when an owned URL already covers this city+service pairing.
      const cityN = norm(city);
      const serviceN = norm(service);
      const alreadyCovered =
        ownedSlugs.has(slug) || (cityN.length > 0 && serviceN.length > 0 && ownedBlob.includes(cityN) && ownedBlob.includes(serviceN));
      if (alreadyCovered) continue;

      const echoesOwn = ownedBlob.includes(serviceN); // service is part of the tenant's real offering
      const qualifier = input.titleQualifier?.trim();
      const title = qualifier ? `${qualifier} in ${city}` : `${service} in ${city}`;
      out.push({
        slug,
        title,
        city,
        service,
        relevance: echoesOwn ? 1 : 0.5,
        needsDemandValidation: true,
        why: `No page targets "${service}" in ${city} yet — validate local demand, then build.`,
      });
    }
  }
  // Relevance first, then stable by slug.
  return out.sort((a, b) => (b.relevance - a.relevance) || a.slug.localeCompare(b.slug)).slice(0, max);
}
