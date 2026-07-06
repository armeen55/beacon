/**
 * local-schema (RANK-5, 2026-07-06) - PURE LocalBusiness + Service JSON-LD.
 *
 * A local-service tenant's city + service pages need LocalBusiness (name /
 * address / phone / areaServed) and, on service pages, a Service block naming
 * the offering + the area served. This composes that JSON-LD from the tenant's
 * OWN configured facts only - never invents an address, a phone, or a city.
 *
 * GENERIC + config-driven: every field comes from the caller (business config).
 * NO city, NO trade, NO vertical is hardcoded. When the tenant has no address
 * AND no phone AND no service areas (a content tenant), `composeLocalSchema`
 * returns null so the caller falls back to the prior generic behavior - byte-
 * identical to a world without this module.
 *
 * The draft-enrichment composer calls this; it does NOT fork composeSchema.
 *
 * PURE FUNCTION. Pinned by local-schema.test.ts.
 */

export type LocalBusinessFacts = {
  /** The tenant's real business name (business config name). */
  name: string;
  /** Street address string (business config address); "" when unset. */
  address: string;
  /** Phone (business config phone); "" when unset. */
  phone: string;
  /** Site domain (for the schema url / @id anchor); "" when unset. */
  domain: string;
  /** Service-area cities the tenant serves (business config locations). */
  areaServed: string[];
};

export type LocalSchemaComposeInput = {
  /** The page the schema will live on. */
  pageUrl: string;
  /** The tenant's configured local facts. */
  facts: LocalBusinessFacts;
  /**
   * When set, also emit a Service block naming this service (used on service
   * pages). Omit for a plain city / homepage LocalBusiness block.
   */
  service?: string | null;
};

/**
 * True when the tenant has enough configured local identity to justify a
 * LocalBusiness block: a name PLUS at least one of address / phone / a served
 * area. A bare name alone is not enough (that is just an Organization, which the
 * generic composer already covers).
 */
export function hasLocalBusinessIdentity(facts: LocalBusinessFacts): boolean {
  const name = facts.name?.trim();
  if (!name) return false;
  const hasAddress = Boolean(facts.address?.trim());
  const hasPhone = Boolean(facts.phone?.trim());
  const hasArea = (facts.areaServed ?? []).some((a) => a.trim().length > 0);
  return hasAddress || hasPhone || hasArea;
}

/**
 * Compose LocalBusiness (+ optional Service) JSON-LD from configured facts.
 * Returns null when the tenant lacks a local identity (no-op for content
 * tenants). The returned object is a schema.org @graph so a single JSON-LD
 * block carries both blocks on a service page. PURE.
 */
export function composeLocalSchema(
  input: LocalSchemaComposeInput,
): Record<string, unknown> | null {
  const { facts, pageUrl } = input;
  if (!hasLocalBusinessIdentity(facts)) return null;

  const name = facts.name.trim();
  const domain = facts.domain?.trim() ?? "";
  const siteUrl = domain
    ? "https://" + domain.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : pageUrl;

  const areaServed = (facts.areaServed ?? [])
    .map((a) => a.trim())
    .filter(Boolean);

  const localBusiness: Record<string, unknown> = {
    "@type": "LocalBusiness",
    "@id": siteUrl + "#business",
    name,
    url: siteUrl,
  };
  const address = facts.address?.trim();
  if (address) {
    localBusiness.address = {
      "@type": "PostalAddress",
      streetAddress: address,
    };
  }
  const phone = facts.phone?.trim();
  if (phone) localBusiness.telephone = phone;
  if (areaServed.length > 0) {
    localBusiness.areaServed = areaServed.map((a) => ({
      "@type": "City",
      name: a,
    }));
  }

  const graph: Record<string, unknown>[] = [localBusiness];

  const service = input.service?.trim();
  if (service) {
    const serviceBlock: Record<string, unknown> = {
      "@type": "Service",
      name: service,
      provider: { "@id": siteUrl + "#business" },
    };
    if (areaServed.length > 0) {
      serviceBlock.areaServed = areaServed.map((a) => ({
        "@type": "City",
        name: a,
      }));
    }
    graph.push(serviceBlock);
  }

  return {
    "@context": "https://schema.org",
    "@graph": graph,
  };
}
