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
 *   contentSiteSignal: Article-family schema OR repeated semantic editorial
 *              pages, AND no physical address/phone (publishers vs. local businesses)
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

// JSON-LD walking + field extraction live in site-jsonld.ts (split at
// the 500-line mark). humanizeSchemaType is re-exported for existing
// importers/tests.
import {
  collectJsonLdNodes,
  typesOf,
  isOrgish,
  extractAddress,
  extractAreaServed,
  extractOfferNames,
  extractSameAs,
  firstString,
  CONTENT_SCHEMA_TYPES,
  NON_INDUSTRY_TYPES,
  humanizeSchemaType,
} from "./site-jsonld";

export { humanizeSchemaType } from "./site-jsonld";

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
  // Live check round 2 (sweetgreen.com): brand-story + app CTAs.
  "mission",
  "download the app",
  "download our app",
  "schedule an appointment",
  // Live check round 3 (rotorooter.com): franchise promo-page labels.
  "coupons",
  "deals",
  "specials",
  "promotions",
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

/** Phone-shaped label ("(800) 277-3633") — a contact affordance, never
 *  a service phrase. */
const PHONE_LABEL_PATTERN = /\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/;

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
    // Live check 2026-06-11 (aspendental.com): icon-font ligature text
    // ("local_phone", "person_outline") sits inside nav anchors as
    // <i class="material-icons">/<span aria-hidden> children and leaked
    // into services. Read the label from a clone with icon-ish children
    // removed — generic markup hygiene, not vertical vocabulary.
    const clone = $(el).clone();
    clone.find("i, svg, [aria-hidden='true'], [class*='icon']").remove();
    const text = clone.text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") ?? "";
    const path = normalizeInternalPath(href, pageUrl);
    if (path && !seenPaths.has(path)) {
      seenPaths.add(path);
      paths.push(path);
    }
    if (
      text.length >= 3 &&
      text.length <= 40 &&
      !PHONE_LABEL_PATTERN.test(text)
    ) {
      labels.push(text);
    }
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
// audit-7 #3: the brand must be a FULL host label — anchor with (?:^|\.) so the
// bare `x` alternative can't match inside wix.com / netflix.com / fox.com (host
// is already www-stripped before the test). `x.com` and `foo.x.com` still match.
const SOCIAL_HOST_PATTERN =
  /(?:^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|yelp|houzz|angi|thumbtack|bbb|tripadvisor|zillow|avvo|healthgrades)\.(com|org)$/i;

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
  let editorialPageCount = 0;

  for (const page of pages) {
    const pageDom = cheerioLoad(page.html);
    const articleText = pageDom("article").first().text().replace(/\s+/g, " ").trim();
    const articleWords = articleText === "" ? 0 : articleText.split(/\s+/).length;
    // A repeated, substantial semantic <article> is strong publisher evidence
    // even when the site is missing the Article JSON-LD Beacon should recommend.
    // One incidental blog post never flips the tenant; the final gate requires
    // multiple pages and still gives address/phone absolute precedence.
    if (articleWords >= 250) editorialPageCount += 1;
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
  // audit-7 #1/#2: a phone is a physical-presence signal the rest of the code
  // already trusts (suggestSegmentFromProfile treats phone OR address as local).
  // Many real local businesses expose only a footer phone (no JSON-LD
  // PostalAddress) while their homepage carries an incidental Article/BlogPosting
  // node — that combination must NOT mis-flag them as a content publisher.
  // Require the ABSENCE of BOTH address and phone before declaring a content site.
  // Repeated semantic article pages close the no-schema catch-22 conservatively:
  // two substantial <article> pages are evidence; one incidental post is not.
  profile.contentSiteSignal =
    (sawContentSchema || editorialPageCount >= 2) &&
    profile.address === null &&
    profile.phone === null;
  return profile;
}
