/**
 * site-jsonld — North-star onboarding (2026-06-11).
 *
 * Pure JSON-LD (schema.org) walking + field extraction used by
 * deriveBusinessProfile. Split out at the 500-line discipline mark —
 * this half is generic structured-data plumbing; the profile assembly
 * + nav heuristics stay in derive-business-profile.ts.
 */

import { load as cheerioLoad } from "cheerio";

// ── JSON-LD walking ──

export type JsonLdNode = Record<string, unknown>;

/** Collect every JSON-LD node across <script type="application/ld+json">
 *  blocks, flattening arrays and @graph containers. Malformed JSON in one
 *  block never poisons the others. */
export function collectJsonLdNodes(html: string): JsonLdNode[] {
  const $ = cheerioLoad(html);
  const nodes: JsonLdNode[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).text();
    if (!raw || !raw.trim()) return;
    try {
      const parsed = JSON.parse(raw) as unknown;
      for (const node of flattenJsonLd(parsed)) nodes.push(node);
    } catch {
      // One malformed block — skip it.
    }
  });
  return nodes;
}

function flattenJsonLd(value: unknown): JsonLdNode[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value === null || typeof value !== "object") return [];
  const node = value as JsonLdNode;
  const out: JsonLdNode[] = [node];
  if (Array.isArray(node["@graph"])) {
    out.push(...(node["@graph"] as unknown[]).flatMap(flattenJsonLd));
  }
  return out;
}

export function typesOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

/** Article-family schema types → content-publication signal. */
export const CONTENT_SCHEMA_TYPES = new Set([
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Blog",
  "ScholarlyArticle",
  "TechArticle",
  "Report",
]);

/** Org-family detection: Organization, LocalBusiness, and ANY subtype.
 *  schema.org LocalBusiness subtypes are numerous (Plumber, Dentist,
 *  Restaurant, GeneralContractor, …) — we treat a node as org-ish when it
 *  carries org-shaped fields rather than enumerating every subtype. */
/** Schema kinds that are THINGS a business publishes — never the
 *  business itself. Live check round 4 (2026-06-11, squareup.com): a
 *  Product node carrying sameAs won the org slot and the derived
 *  business name became "Square Reader for Contactless and Chip". */
const NON_ORG_THING_TYPES = new Set([
  "Product",
  "Offer",
  "AggregateOffer",
  "Service",
  "Review",
  "AggregateRating",
  "FAQPage",
  "Question",
  "Event",
  "JobPosting",
  "Recipe",
  "VideoObject",
  "ImageObject",
]);

export function isOrgish(node: JsonLdNode): boolean {
  const types = typesOf(node);
  if (types.some((t) => t === "Organization" || t === "LocalBusiness")) return true;
  if (types.length === 0) return false;
  if (
    types.some(
      (t) =>
        CONTENT_SCHEMA_TYPES.has(t) ||
        NON_ORG_THING_TYPES.has(t) ||
        t === "WebSite" ||
        t === "WebPage" ||
        t === "BreadcrumbList" ||
        t === "Person",
    )
  ) {
    return false;
  }
  // Unknown @type: org-ish iff it carries business-shaped fields.
  return (
    typeof node.name === "string" &&
    (node.address !== undefined ||
      node.telephone !== undefined ||
      node.areaServed !== undefined ||
      node.sameAs !== undefined)
  );
}

// ── Industry humanizer (generic, NOT a business vocabulary) ──

/** Schema types that say nothing about WHAT the business is. */
export const NON_INDUSTRY_TYPES = new Set([
  "Organization",
  "LocalBusiness",
  "WebSite",
  "WebPage",
  "BreadcrumbList",
  "Person",
  "Corporation",
  "OnlineBusiness",
]);

/** Spellings whose camelCase split reads awkwardly — overrides only, the
 *  general path is the deterministic camelCase→words humanizer below. */
const TYPE_LABEL_OVERRIDES: Record<string, string> = {
  HomeAndConstructionBusiness: "home construction",
  HVACBusiness: "HVAC services",
  AutomotiveBusiness: "automotive services",
  FoodEstablishment: "food establishment",
  MedicalBusiness: "medical practice",
  LegalService: "legal services",
  FinancialService: "financial services",
  EmergencyService: "emergency services",
  RealEstateAgent: "real estate",
  ProfessionalService: "professional services",
};

/** "GeneralContractor" → "general contractor"; "BeautySalon" → "beauty
 *  salon". Deterministic: split camelCase, lowercase, join. Acronym runs
 *  (HVAC, USA) survive uppercase via the override map / acronym guard. */
export function humanizeSchemaType(schemaType: string): string {
  const override = TYPE_LABEL_OVERRIDES[schemaType];
  if (override) return override;
  return schemaType
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .map((w) => (w === w.toUpperCase() && w.length > 1 ? w : w.toLowerCase()))
    .join(" ")
    .trim();
}

// ── Field extraction helpers ──

export function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

export function extractAddress(node: JsonLdNode): {
  printable: string | null;
  locations: string[];
} {
  const address = node.address;
  const locations: string[] = [];
  let printable: string | null = null;
  const addrNode = Array.isArray(address) ? address[0] : address;
  if (addrNode && typeof addrNode === "object") {
    const a = addrNode as JsonLdNode;
    const street = firstString(a.streetAddress);
    const locality = firstString(a.addressLocality);
    const region = firstString(a.addressRegion);
    const postal = firstString(a.postalCode);
    if (locality) locations.push(locality.toLowerCase());
    if (region) locations.push(region.toLowerCase());
    // Live check 2026-06-11 (iranopedia.com): a region-only address
    // node ("CA", no street/locality) is NOT a physical address — it
    // produced a false "local business" signal for a content site.
    // Printable requires at least a street or a locality.
    const parts = [street, locality, region, postal].filter(Boolean);
    if ((street || locality) && parts.length > 0) {
      printable = parts.join(", ");
    }
  } else if (typeof addrNode === "string" && addrNode.trim()) {
    printable = addrNode.trim();
  }
  return { printable, locations };
}

export function extractAreaServed(node: JsonLdNode): string[] {
  const area = node.areaServed;
  const out: string[] = [];
  const items = Array.isArray(area) ? area : area !== undefined ? [area] : [];
  for (const item of items) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim().toLowerCase());
    } else if (item && typeof item === "object") {
      const name = firstString((item as JsonLdNode).name);
      if (name) out.push(name.toLowerCase());
    }
  }
  return out;
}

export function extractOfferNames(node: JsonLdNode): string[] {
  const out: string[] = [];
  const visitOffer = (offer: unknown): void => {
    if (!offer || typeof offer !== "object") return;
    const o = offer as JsonLdNode;
    const itemOffered = o.itemOffered;
    const name =
      firstString(
        itemOffered && typeof itemOffered === "object"
          ? (itemOffered as JsonLdNode).name
          : undefined,
      ) ?? firstString(o.name);
    if (name) out.push(name.toLowerCase());
    const list = o.itemListElement;
    if (Array.isArray(list)) list.forEach(visitOffer);
  };
  if (node.makesOffer !== undefined) {
    const offers = Array.isArray(node.makesOffer) ? node.makesOffer : [node.makesOffer];
    offers.forEach(visitOffer);
  }
  const catalog = node.hasOfferCatalog;
  if (catalog && typeof catalog === "object") visitOffer(catalog);
  return out;
}

export function extractSameAs(node: JsonLdNode): string[] {
  const sameAs = node.sameAs;
  const items = Array.isArray(sameAs) ? sameAs : sameAs !== undefined ? [sameAs] : [];
  return items.filter(
    (s): s is string => typeof s === "string" && /^https?:\/\//.test(s),
  );
}
