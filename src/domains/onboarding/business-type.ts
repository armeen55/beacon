/**
 * business-type — auto-derive a tenant's business TYPE (2026-07-06).
 *
 * The long-term, works-for-ANY-business classifier: from a tenant's OWN
 * signals (schema.org @type, nav/service vocabulary, GSC query intent, and
 * whether it has a real physical presence) decide WHAT KIND of business this
 * is, so the local-SEO engine + segment toggles light up correctly per type
 * with ZERO manual config and ZERO tenant hardcoding.
 *
 *   local_service     — a business that serves customers in physical places
 *                       (builder, dentist, plumber, restaurant, law firm, …):
 *                       has an address/phone OR area-served, and its demand is
 *                       service-in-place shaped. The local engine FIRES.
 *   content_publisher — an encyclopedia / blog / news / docs site: Article-
 *                       family schema, no physical presence. The local engine
 *                       is SILENT (no service areas).
 *   ecommerce         — sells products online: Product/Offer schema + cart/shop
 *                       vocabulary, buy-intent queries, no local presence.
 *   saas              — a software product / app: SoftwareApplication schema or
 *                       pricing/login/app vocabulary, no local presence.
 *   other             — genuinely ambiguous. The safe floor — every local
 *                       engine stays OFF until the operator confirms a type.
 *
 * DETERMINISTIC + GROUNDED. Every decision is explained in `evidence` and
 * carries a `confidence`. NO city list, NO trade, NO vertical, NO brand is
 * hardcoded anywhere. An optional LLM classifier can be injected (capped,
 * fail-soft) but the heuristic is the real engine and the default is a no-op
 * that never touches the network — tests never make a paid call.
 *
 * PURE FUNCTION. Pinned by business-type.test.ts.
 */

import type { DerivedBusinessProfile } from "./derive-business-profile";

export type BusinessType =
  | "local_service"
  | "content_publisher"
  | "ecommerce"
  | "saas"
  | "other";

export type BusinessTypeConfidence = "high" | "medium" | "low";

export type BusinessTypeVerdict = {
  businessType: BusinessType;
  confidence: BusinessTypeConfidence;
  /** Plain-English reasons the type was chosen (operator-readable). */
  evidence: string[];
};

/** One GSC query the audience actually typed (impressions-ranked upstream). */
export type QuerySignal = { query: string; impressions: number };

export type ClassifyBusinessTypeInput = {
  /** The site-derived profile (schema types, address/phone, services, …). */
  profile: DerivedBusinessProfile | null;
  /** Top GSC queries by impressions, if the tenant has connected GSC. */
  topQueries?: ReadonlyArray<QuerySignal>;
  /** Optional place-name hits already detected from queries/snapshots. */
  detectedPlaces?: ReadonlyArray<string>;
};

// ── schema.org @type families (generic, NOT a vertical vocabulary) ──

const ECOMMERCE_SCHEMA = new Set([
  "Product",
  "Offer",
  "AggregateOffer",
  "OfferCatalog",
  "ProductGroup",
]);
const SAAS_SCHEMA = new Set([
  "SoftwareApplication",
  "WebApplication",
  "MobileApplication",
]);
const CONTENT_SCHEMA = new Set([
  "Article",
  "NewsArticle",
  "BlogPosting",
  "Blog",
  "ScholarlyArticle",
  "TechArticle",
  "Report",
]);

// ── generic intent vocabularies (English page-role words, NOT a trade) ──
// These are the words ANY site of that shape uses regardless of industry —
// "checkout" is ecommerce furniture whether the store sells shoes or seeds;
// "pricing/login" is SaaS furniture whether the app is a CRM or a game.

const ECOMMERCE_TERMS = [
  "cart",
  "checkout",
  "shop",
  "store",
  "add to cart",
  "shipping",
  "returns",
  "free shipping",
  "buy now",
  "products",
];
const SAAS_TERMS = [
  "pricing",
  "log in",
  "login",
  "sign up",
  "free trial",
  "start free",
  "api",
  "documentation",
  "docs",
  "integrations",
  "dashboard",
];

// Query-intent markers. Buy-intent → ecommerce; try/download-intent → saas.
// These are generic English shopping/software verbs, never a product name.
const BUY_INTENT = ["buy", "price", "cheap", "deal", "coupon", "for sale", "order", "shipping"];
const SOFTWARE_INTENT = ["app", "software", "download", "login", "pricing", "free trial", "alternative"];

function countHits(haystack: string[], needles: string[]): number {
  const joined = haystack.join(" ").toLowerCase();
  let n = 0;
  for (const needle of needles) {
    // Word-ish containment — a needle surrounded by non-letters (or edges).
    const re = new RegExp(`(^|[^a-z])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(joined)) n += 1;
  }
  return n;
}

/**
 * Classify a business type from its own signals. PURE + deterministic.
 *
 * Precedence is grounded in the strongest evidence first:
 *   1. Physical presence (real address OR phone OR area-served) → local_service.
 *      A place you can visit or call is a local business regardless of what
 *      else the page carries. This is the local engine's ON switch.
 *   2. Otherwise weigh online-only shapes: content schema, ecommerce schema +
 *      shop vocabulary + buy-intent queries, saas schema + app vocabulary +
 *      software-intent queries.
 *   3. Nothing decisive → other (the safe floor; local engines stay OFF).
 */
export function classifyBusinessType(
  input: ClassifyBusinessTypeInput,
): BusinessTypeVerdict {
  const { profile } = input;
  if (!profile) {
    return {
      businessType: "other",
      confidence: "low",
      evidence: ["I could not read the site yet, so I am not guessing a type."],
    };
  }

  const schemaTypes = profile.schemaTypes ?? [];
  const services = profile.services ?? [];
  const queries = (input.topQueries ?? []).map((q) => q.query);
  const places = input.detectedPlaces ?? [];

  const hasAddress = Boolean(profile.address);
  const hasPhone = Boolean(profile.phone);
  const hasAreaServed = (profile.locations ?? []).length > 0;

  // 1. Physical presence wins. Address or phone is a real "you can reach us
  //    here" signal (locations alone can be a content site's region tag, so we
  //    require address/phone to be conclusive — the same rule launch already
  //    uses). Area-served + a place-name query is a weaker local signal.
  if (hasAddress || hasPhone) {
    const evidence: string[] = [];
    if (hasAddress) evidence.push(`I found a street address on your site (${profile.address}).`);
    if (hasPhone) evidence.push(`I found a phone number people can call (${profile.phone}).`);
    if (hasAreaServed) {
      evidence.push(
        `You name the areas you serve, so I will look for city pages you are missing.`,
      );
    }
    return { businessType: "local_service", confidence: "high", evidence };
  }

  // No address/phone below this line — an online-only or content property.

  const contentSchemaHit = schemaTypes.some((t) => CONTENT_SCHEMA.has(t));
  const ecommerceSchemaHit = schemaTypes.some((t) => ECOMMERCE_SCHEMA.has(t));
  const saasSchemaHit = schemaTypes.some((t) => SAAS_SCHEMA.has(t));

  const shopVocab = countHits(services, ECOMMERCE_TERMS);
  const appVocab = countHits(services, SAAS_TERMS);
  const buyIntent = countHits(queries, BUY_INTENT);
  const softwareIntent = countHits(queries, SOFTWARE_INTENT);

  // 2a. SaaS: software schema, OR app vocabulary backed by software-intent
  //     queries. Checked before ecommerce because a SaaS site often carries an
  //     Offer node (its pricing) that must not read as a product catalog.
  if (saasSchemaHit || (appVocab >= 2 && softwareIntent >= 1)) {
    const evidence: string[] = [];
    if (saasSchemaHit) evidence.push("Your site describes a software application.");
    if (appVocab >= 2) evidence.push("Your navigation reads like an app (pricing, log in, sign up).");
    if (softwareIntent >= 1) evidence.push("People search for you the way they search for software.");
    return {
      businessType: "saas",
      confidence: saasSchemaHit ? "high" : "medium",
      evidence,
    };
  }

  // 2b. Ecommerce: product/offer schema + shop vocabulary, OR strong buy-intent.
  if ((ecommerceSchemaHit && shopVocab >= 1) || (shopVocab >= 2 && buyIntent >= 1)) {
    const evidence: string[] = [];
    if (ecommerceSchemaHit) evidence.push("Your pages describe products for sale.");
    if (shopVocab >= 1) evidence.push("Your navigation includes a cart or shop.");
    if (buyIntent >= 1) evidence.push("People search for you with buying words like price and buy.");
    return {
      businessType: "ecommerce",
      confidence: ecommerceSchemaHit && shopVocab >= 1 ? "high" : "medium",
      evidence,
    };
  }

  // 2c. Content publisher: Article-family schema and no physical presence.
  //     (contentSiteSignal already requires no address/phone.)
  if (profile.contentSiteSignal || contentSchemaHit) {
    return {
      businessType: "content_publisher",
      confidence: profile.contentSiteSignal ? "high" : "medium",
      evidence: [
        "Your site reads like a publication (articles, no address or phone), so I will not look for city pages.",
      ],
    };
  }

  // 3. Nothing decisive. Honest "other" — the safe floor keeps every local
  //    engine OFF until the operator confirms a type on the config screen.
  const evidence: string[] = [
    "I could not tell your business type from the site yet. Set it on your business info page and I will tailor everything.",
  ];
  if (places.length > 0) {
    evidence.push(
      `People do search for you near ${places.slice(0, 3).join(", ")}, so you may be a local business.`,
    );
  }
  return { businessType: "other", confidence: "low", evidence };
}

/**
 * Map a business type to the tenant SEGMENT the rest of the app already
 * understands. The segment union is narrower than the type union today, so
 * ecommerce/saas both map to a non-local segment that keeps local engines OFF
 * (they behave like content_publisher for feature-toggle purposes: no service
 * areas, no call tracking, no city pages). local_service maps to the generic
 * local segment; content_publisher maps 1:1. `other` returns null so the
 * caller keeps the safe provisioning default. NO builder segment is inferred
 * here — a human picking builder tags is the only path to that (self-
 * declaration beats inference), handled by the launch flow.
 */
export function segmentForBusinessType(
  type: BusinessType,
): "local_service" | "content_publisher" | null {
  switch (type) {
    case "local_service":
      return "local_service";
    case "content_publisher":
    case "ecommerce":
    case "saas":
      // Non-local online properties: local engines must stay silent. The
      // content_publisher segment's feature defaults are exactly that (all
      // local toggles off), so it is the honest carrier until the segment
      // union grows dedicated ecommerce/saas members.
      return "content_publisher";
    case "other":
      return null;
  }
}
