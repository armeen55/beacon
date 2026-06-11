/**
 * derive-business-profile — North-star onboarding (2026-06-11).
 *
 * PURE, DETERMINISTIC extractor: fetched site HTML → a derived business
 * profile (name, industry, phone, address, locations, services, key
 * pages, social profiles, content-site signal). This is the heart of
 * "paste ONLY a URL and Beacon configures itself" — the output feeds
 * `deriveBusinessConfig` and prefills the onboarding wizard so a
 * stranger confirms instead of typing.
 *
 * Constraints (operator-locked):
 *   - Pure function: no I/O, no env reads, no network. Input is
 *     pre-fetched HTML (see fetch-site-profile.ts).
 *   - 100% deterministic. Same input → same output.
 *   - NO LLM calls. Parsing only: JSON-LD (schema.org), Open Graph,
 *     <title>, nav anchors, tel: links.
 *   - ZERO vertical/geo assumptions: every value comes from the input
 *     HTML. No Bay-Area city lists, no builder vocabulary, no default
 *     locations. A site that exposes nothing yields nulls/empties —
 *     honest blanks the wizard asks the human to fill.
 *
 * Source priority per field:
 *   name:      JSON-LD org name → og:site_name → <title> brand segment
 *   industry:  JSON-LD @type humanized (generic camelCase→words; small
 *              override map ONLY for awkward schema spellings)
 *   phone:     JSON-LD telephone → first tel: link → NANP regex
 *   address:   JSON-LD PostalAddress (printable single line)
 *   locations: addressLocality/Region + areaServed names
 *   services:  JSON-LD offers → nav anchor texts minus navigation
 *              furniture (home/about/contact/... — vertical-agnostic)
 *   keyPages:  internal nav hrefs, normalized paths, capped
 *   social:    JSON-LD sameAs + footer profile links
 *   contentSiteSignal: Article-family schema present AND no physical
 *              address (encyclopedias/blogs vs. local businesses)
 */

import { load as cheerioLoad } from "cheerio";

// ── Types ──

export type DerivedNameSource = "json-ld" | "og-site-name" | "title";

export type DerivedBusinessProfile = {
  name: string | null;
  nameSource: DerivedNameSource | null;
  description: string | null;
  /** Plain-English industry label derived from schema.org @type, or null. */
  industry: string | null;
  /** Raw schema.org @type values seen across pages (deduped, ordered). */
  schemaTypes: string[];
  phone: string | null;
  address: string | null;
  /** City/region names from the site's own structured data. Lowercased. */
  locations: string[];
  /** Service/offering phrases from offers + nav. Lowercased. */
  services: string[];
  /** Internal nav paths ("/" always first when any nav exists). */
  keyPages: string[];
  /** Off-site profile URLs (yelp/houzz/facebook/instagram/...). */
  socialProfiles: string[];
  /** True when the site reads as a content publication, not a local business. */
  contentSiteSignal: boolean;
};

export type FetchedPage = { url: string; html: string };

// ── JSON-LD walking ──

type JsonLdNode = Record<string, unknown>;

/** Collect every JSON-LD node across <script type="application/ld+json">
 *  blocks, flattening arrays and @graph containers. Malformed JSON in one
 *  block never poisons the others. */
function collectJsonLdNodes(html: string): JsonLdNode[] {
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

function typesOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

/** Article-family schema types → content-publication signal. */
const CONTENT_SCHEMA_TYPES = new Set([
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
function isOrgish(node: JsonLdNode): boolean {
  const types = typesOf(node);
  if (types.some((t) => t === "Organization" || t === "LocalBusiness")) return true;
  if (types.length === 0) return false;
  if (types.some((t) => CONTENT_SCHEMA_TYPES.has(t) || t === "WebSite" || t === "WebPage" || t === "BreadcrumbList" || t === "Person")) {
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
const NON_INDUSTRY_TYPES = new Set([
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

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return null;
}

function extractAddress(node: JsonLdNode): {
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

function extractAreaServed(node: JsonLdNode): string[] {
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

function extractOfferNames(node: JsonLdNode): string[] {
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

function extractSameAs(node: JsonLdNode): string[] {
  const sameAs = node.sameAs;
  const items = Array.isArray(sameAs) ? sameAs : sameAs !== undefined ? [sameAs] : [];
  return items.filter(
    (s): s is string => typeof s === "string" && /^https?:\/\//.test(s),
  );
}

// ── Nav extraction (services + key pages) ──

/** Navigation FURNITURE — page-role labels every site has regardless of
 *  vertical. This is NOT business vocabulary (no "remodel", no "menu
 *  items"): filtering these out is what keeps the residue service-shaped. */
const NAV_FURNITURE = new Set([
  "home",
  "about",
  "about us",
  "our story",
  "our team",
  "team",
  "contact",
  "contact us",
  "blog",
  "news",
  "faq",
  "faqs",
  "gallery",
  "portfolio",
  "our work",
  "projects",
  "reviews",
  "testimonials",
  "privacy",
  "privacy policy",
  "terms",
  "terms of service",
  "careers",
  "jobs",
  "login",
  "log in",
  "sign in",
  "sign up",
  "search",
  "cart",
  "shop",
  "menu",
  "sitemap",
  "support",
  "help",
  "resources",
  "get a quote",
  "request a quote",
  "free quote",
  "book now",
  "schedule",
  "locations",
  "services",
  // Live check 2026-06-11 (ritzbuilders.com): CTA labels leaked into
  // services. All page-role/CTA furniture — never business vocabulary.
  "call now",
  "call us",
  "schedule a consultation",
  "book a consultation",
  "free consultation",
  "free estimate",
  "get started",
  "learn more",
  "view all",
  "see all",
  "read more",
]);

function normalizeInternalPath(href: string, baseUrl: string): string | null {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(href, base);
    if (resolved.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) {
      return null;
    }
    if (/^(mailto|tel|javascript):/i.test(href)) return null;
    const path = resolved.pathname.replace(/\/+$/, "") || "/";
    if (/\.(jpg|jpeg|png|gif|svg|pdf|zip|webp)$/i.test(path)) return null;
    return path;
  } catch {
    return null;
  }
}

function extractNav(
  html: string,
  pageUrl: string,
): { labels: string[]; paths: string[] } {
  const $ = cheerioLoad(html);
  const labels: string[] = [];
  const paths: string[] = [];
  const seenPaths = new Set<string>();
  const containers = $("header nav, nav, [role='navigation']");
  const scope = containers.length > 0 ? containers.first() : $("header");
  scope.find("a[href]").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") ?? "";
    const path = normalizeInternalPath(href, pageUrl);
    if (path && !seenPaths.has(path)) {
      seenPaths.add(path);
      paths.push(path);
    }
    if (text.length >= 3 && text.length <= 40) labels.push(text);
  });
  return { labels, paths };
}

/** tel: links + a conservative NANP pattern as last resort. */
function extractPhoneFromHtml(html: string): string | null {
  const $ = cheerioLoad(html);
  const telHref = $('a[href^="tel:"]').first().attr("href");
  if (telHref) {
    const num = telHref.replace(/^tel:/i, "").trim();
    if (num.length >= 7) return num;
  }
  const text = $("footer").text() || $("body").text();
  const m = text.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/);
  return m ? m[0].trim() : null;
}

/** Brand segment from a <title> like "Acme Plumbing | SF's Trusted
 *  Plumbers" — split on common separators, prefer the first segment
 *  unless it's a generic page word ("home", "welcome"). */
export function brandFromTitle(title: string): string | null {
  const segments = title
    .split(/\s*[|–—·:]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const generic = /^(home|welcome|homepage|official site|index)$/i;
  const candidate = segments.find((s) => !generic.test(s)) ?? segments[0]!;
  return candidate.length >= 2 && candidate.length <= 80 ? candidate : null;
}

/** Off-site profile hosts worth carrying into config (channel detection
 *  is generic — host families, not a vertical's directory list). */
const SOCIAL_HOST_PATTERN =
  /(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|yelp|houzz|angi|thumbtack|bbb|tripadvisor|zillow|avvo|healthgrades)\.(com|org)$/i;

/**
 * Normalize + dedupe derived locations. Live check 2026-06-11
 * (ritzbuilders.com): real-world areaServed lists are noisy — the same
 * city appears as "palo alto" AND "palo alto ca", entries carry
 * parenthetical marketing ("east bay (select locations)"), and the raw
 * list ran to 47 entries. Rules (all generic, no geo vocabulary):
 *   - strip parenthetical tails,
 *   - a trailing 2-letter region token dedupes against the bare city
 *     ("palo alto ca" collapses into "palo alto"; a bare region code
 *     like "ca" survives as itself — downstream consumers filter
 *     2-letter entries where they don't belong),
 *   - first occurrence wins, cap 30.
 */
export function normalizeDerivedLocations(raw: ReadonlyArray<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    let cleaned = entry.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (cleaned.length === 0) continue;
    const regionStripped = cleaned.replace(/\s+[a-z]{2}$/, "");
    if (regionStripped.length >= 3) cleaned = regionStripped;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= 30) break;
  }
  return out;
}

// ── Main entry ──

export function deriveBusinessProfile(
  pages: FetchedPage[],
): DerivedBusinessProfile {
  const empty: DerivedBusinessProfile = {
    name: null,
    nameSource: null,
    description: null,
    industry: null,
    schemaTypes: [],
    phone: null,
    address: null,
    locations: [],
    services: [],
    keyPages: [],
    socialProfiles: [],
    contentSiteSignal: false,
  };
  if (pages.length === 0) return empty;

  const profile = { ...empty };
  const schemaTypes = new Set<string>();
  const locations = new Set<string>();
  const services = new Set<string>();
  const socialProfiles = new Set<string>();
  let sawContentSchema = false;

  for (const page of pages) {
    const nodes = collectJsonLdNodes(page.html);
    for (const node of nodes) {
      for (const t of typesOf(node)) {
        schemaTypes.add(t);
        if (CONTENT_SCHEMA_TYPES.has(t)) sawContentSchema = true;
      }
      if (!isOrgish(node)) continue;
      if (!profile.name) {
        const name = firstString(node.name);
        if (name) {
          profile.name = name;
          profile.nameSource = "json-ld";
        }
      }
      if (!profile.description) {
        profile.description = firstString(node.description);
      }
      if (!profile.phone) {
        profile.phone = firstString(node.telephone);
      }
      if (!profile.address) {
        const { printable, locations: addrLocs } = extractAddress(node);
        if (printable) profile.address = printable;
        addrLocs.forEach((l) => locations.add(l));
      } else {
        extractAddress(node).locations.forEach((l) => locations.add(l));
      }
      extractAreaServed(node).forEach((l) => locations.add(l));
      extractOfferNames(node).forEach((s) => services.add(s));
      extractSameAs(node).forEach((u) => socialProfiles.add(u));
      if (!profile.industry) {
        const industryType = typesOf(node).find(
          (t) => !NON_INDUSTRY_TYPES.has(t) && !CONTENT_SCHEMA_TYPES.has(t),
        );
        if (industryType) profile.industry = humanizeSchemaType(industryType);
      }
    }
  }

  // Homepage-level fallbacks (first page is the homepage by contract).
  const homepage = pages[0]!;
  const $ = cheerioLoad(homepage.html);
  if (!profile.name) {
    const ogSiteName = $('meta[property="og:site_name"]').attr("content")?.trim();
    if (ogSiteName) {
      profile.name = ogSiteName;
      profile.nameSource = "og-site-name";
    } else {
      const title = $("title").first().text().trim();
      const brand = title ? brandFromTitle(title) : null;
      if (brand) {
        profile.name = brand;
        profile.nameSource = "title";
      }
    }
  }
  if (!profile.description) {
    profile.description =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim() ||
      null;
  }
  if (!profile.phone) {
    profile.phone = extractPhoneFromHtml(homepage.html);
  }

  // Nav: services (labels minus furniture) + key pages (paths).
  const nav = extractNav(homepage.html, homepage.url);
  const businessNameLower = profile.name?.toLowerCase() ?? null;
  for (const label of nav.labels) {
    const lower = label.toLowerCase();
    // "our services" is the same furniture as "services" — strip the
    // generic-English possessive before matching (not vertical vocab).
    const dePossessed = lower.replace(/^our\s+/, "");
    if (NAV_FURNITURE.has(lower) || NAV_FURNITURE.has(dePossessed)) continue;
    if (/^\d+$/.test(lower)) continue;
    // Self-referential nav ("Ritz Builders Services") is brand chrome,
    // not a service phrase — live check 2026-06-11.
    if (businessNameLower && lower.includes(businessNameLower)) continue;
    services.add(lower);
  }
  const keyPages = ["/", ...nav.paths.filter((p) => p !== "/")].slice(0, 12);

  // Footer social links (beyond JSON-LD sameAs).
  $('footer a[href^="http"]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      if (SOCIAL_HOST_PATTERN.test(host)) socialProfiles.add(href);
    } catch {
      /* malformed href */
    }
  });

  profile.schemaTypes = [...schemaTypes];
  profile.locations = normalizeDerivedLocations([...locations]);
  profile.services = [...services].slice(0, 24);
  profile.keyPages = nav.paths.length > 0 ? keyPages : ["/"];
  profile.socialProfiles = [...socialProfiles];
  profile.contentSiteSignal = sawContentSchema && profile.address === null;
  return profile;
}
