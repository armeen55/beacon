/**
 * BUSINESS PROFILE DERIVATION + CLASSIFICATION (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/onboarding/derive-business-profile.test.ts
 *   src/domains/onboarding/business-type.test.ts
 *   src/domains/onboarding/detect-service-areas.test.ts
 * Pins kept: every derived value comes from INPUT html (zero Bay-Area/vertical
 * hardcoding), content sites derive zero locations, safe "other" floor, place
 * detection by PATTERN never a gazetteer, content-site local-engine no-op.
 */
import { describe, it, expect } from "vitest";
import {
  deriveBusinessProfile,
  brandFromTitle,
  humanizeSchemaType,
  normalizeDerivedLocations,
  type DerivedBusinessProfile,
} from "@/domains/onboarding/derive-business-profile";
import {
  classifyBusinessType,
  segmentForBusinessType,
} from "@/domains/onboarding/business-type";
import {
  extractPlacesFromQuery,
  detectServiceAreas,
} from "@/domains/onboarding/detect-service-areas";

const TEXAS_BUILDER_HTML = `<!doctype html><html><head>
<title>Lone Star Custom Homes | Hill Country Builder</title>
<meta name="description" content="Custom home builder serving the Texas Hill Country.">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["GeneralContractor", "LocalBusiness"],
  "name": "Lone Star Custom Homes",
  "telephone": "+1-512-555-0147",
  "address": {"@type": "PostalAddress", "streetAddress": "100 Ranch Rd", "addressLocality": "Fredericksburg", "addressRegion": "TX", "postalCode": "78624"},
  "areaServed": ["Fredericksburg", {"@type": "City", "name": "Boerne"}, "Kerrville"],
  "sameAs": ["https://www.houzz.com/pro/lonestarhomes"],
  "makesOffer": [
    {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Custom Home Construction"}},
    {"@type": "Offer", "itemOffered": {"@type": "Service", "name": "Whole Home Remodeling"}}
  ]
}
</script></head><body>
<header><nav>
  <a href="/">Home</a>
  <a href="/custom-homes">Custom Homes</a>
  <a href="/remodeling">Remodeling</a>
  <a href="/portfolio">Portfolio</a>
  <a href="/about">About</a>
  <a href="/contact">Contact</a>
</nav></header>
<footer>Call us: (512) 555-0147</footer>
</body></html>`;

const CONTENT_SITE_HTML = `<!doctype html><html><head>
<title>Saffron Atlas | Persian Culture, Explained</title>
<meta property="og:site_name" content="Saffron Atlas">
<script type="application/ld+json">
{"@context": "https://schema.org", "@type": "WebSite", "name": "Saffron Atlas"}
</script>
<script type="application/ld+json">
{"@context": "https://schema.org", "@type": "Article", "headline": "The History of Saffron"}
</script></head><body>
<header><nav>
  <a href="/">Home</a>
  <a href="/food">Persian Food</a>
  <a href="/history">History</a>
  <a href="/names">Persian Names</a>
  <a href="/about">About</a>
</nav></header>
</body></html>`;

describe("deriveBusinessProfile: geo and services come from INPUT only", () => {
  const profile = deriveBusinessProfile([{ url: "https://lonestarhomes.com/", html: TEXAS_BUILDER_HTML }]);

  it("derives name, industry, phone, address from JSON-LD", () => {
    expect(profile.name).toBe("Lone Star Custom Homes");
    expect(profile.nameSource).toBe("json-ld");
    expect(profile.industry).toBe("general contractor");
    expect(profile.phone).toBe("+1-512-555-0147");
    expect(profile.address).toBe("100 Ranch Rd, Fredericksburg, TX, 78624");
  });

  it("locations are the SITE'S cities, zero Bay-Area leakage", () => {
    expect(profile.locations).toEqual(expect.arrayContaining(["fredericksburg", "tx", "boerne", "kerrville"]));
    for (const banned of ["palo alto", "menlo park", "atherton", "bay area"]) {
      expect(profile.locations).not.toContain(banned);
    }
  });

  it("services merge JSON-LD offers + nav labels minus furniture; not a content site", () => {
    expect(profile.services).toEqual(
      expect.arrayContaining(["custom home construction", "whole home remodeling", "custom homes", "remodeling"]),
    );
    expect(profile.services).not.toContain("about");
    expect(profile.services).not.toContain("portfolio");
    expect(profile.contentSiteSignal).toBe(false);
  });
});

describe("deriveBusinessProfile: content publication fixture", () => {
  const profile = deriveBusinessProfile([{ url: "https://saffronatlas.com/", html: CONTENT_SITE_HTML }]);

  it("falls back to og:site_name, flags contentSiteSignal, derives ZERO locations", () => {
    expect(profile.name).toBe("Saffron Atlas");
    expect(profile.nameSource).toBe("og-site-name");
    expect(profile.contentSiteSignal).toBe(true);
    expect(profile.locations).toEqual([]);
  });
});

describe("deriveBusinessProfile: mis-detection guards + hostile input", () => {
  it("a phone-bearing local business with incidental blog schema is NOT a content site", () => {
    const html = `<!doctype html><html><head>
<title>Ace Plumbing</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":["Plumber","LocalBusiness"],"name":"Ace Plumbing","telephone":"+1-512-555-0123"}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BlogPosting","headline":"5 Signs You Need a New Water Heater"}
</script></head><body>
<header><nav><a href="/">Home</a><a href="/services">Services</a></nav></header>
<footer>123 Main St, Austin TX - Call (512) 555-0123</footer>
</body></html>`;
    const p = deriveBusinessProfile([{ url: "https://aceplumbingaustin.com/", html }]);
    expect(p.phone).not.toBeNull();
    expect(p.contentSiteSignal).toBe(false);
  });

  it("no pages: all-null profile; malformed JSON-LD never poisons other blocks", () => {
    const empty = deriveBusinessProfile([]);
    expect(empty.name).toBeNull();
    expect(empty.locations).toEqual([]);

    const html = `<html><head>
      <script type="application/ld+json">{not json at all</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Survivor Co","sameAs":["https://www.facebook.com/survivor"]}</script>
      </head><body></body></html>`;
    expect(deriveBusinessProfile([{ url: "https://x.com/", html }]).name).toBe("Survivor Co");
  });

  it("a Product node with sameAs/offers is NOT the business; og:site_name wins", () => {
    const html = `<html><head>
      <meta property="og:site_name" content="Square">
      <script type="application/ld+json">
      {"@type":"Product","name":"Square Reader for Contactless and Chip (2nd Generation)","sameAs":["https://www.facebook.com/square"],"offers":{"@type":"Offer","price":"49"}}
      </script></head><body></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://squareup.com/", html }]);
    expect(p.name).toBe("Square");
    expect(p.industry).not.toBe("product");
  });

  it("CTA labels, promo furniture, icon ligatures, and phone labels never become services", () => {
    const html = `<html><body><header><nav>
      <a href="/services">Our Services</a>
      <a href="/call">Call Now</a>
      <a href="/coupons">Coupons</a>
      <a href="tel:8002773633"><i class="material-icons">local_phone</i>(800) 277-3633</a>
      <a href="/remodeling">Whole-Home Remodeling</a>
      </nav></header></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://ritz.com/", html }]);
    expect(p.services).toEqual(["whole-home remodeling"]);
  });

  it("schema-less publisher: repeated substantial articles flip the signal, one never does", () => {
    const article = (title: string) =>
      `<html><head><title>${title} | Atlas</title></head><body><article><h1>${title}</h1><p>${Array.from({ length: 270 }, (_, i) => `word${i}`).join(" ")}</p></article></body></html>`;
    expect(
      deriveBusinessProfile([
        { url: "https://atlas.example/one", html: article("One") },
        { url: "https://atlas.example/two", html: article("Two") },
      ]).contentSiteSignal,
    ).toBe(true);
    expect(deriveBusinessProfile([{ url: "https://atlas.example/", html: article("One") }]).contentSiteSignal).toBe(false);
  });
});

describe("brandFromTitle + humanizeSchemaType + normalizeDerivedLocations", () => {
  it("takes the brand segment, skipping generic page words", () => {
    expect(brandFromTitle("Welcome - La Palma Taqueria")).toBe("La Palma Taqueria");
    expect(brandFromTitle("Home | Acme Co")).toBe("Acme Co");
  });

  it("camelCase to words, with overrides for awkward spellings", () => {
    expect(humanizeSchemaType("GeneralContractor")).toBe("general contractor");
    expect(humanizeSchemaType("HVACBusiness")).toBe("HVAC services");
  });

  it("collapses city+region variants, strips marketing tails, caps at 30", () => {
    expect(normalizeDerivedLocations(["palo alto", "palo alto ca", "Cupertino CA"])).toEqual(["palo alto", "cupertino"]);
    expect(normalizeDerivedLocations(["east bay (select locations)"])).toEqual(["east bay"]);
    expect(normalizeDerivedLocations(Array.from({ length: 40 }, (_, i) => `city${i}`))).toHaveLength(30);
  });
});

// ── classifyBusinessType ────────────────────────────────────────────────────

function typedProfile(over: Partial<DerivedBusinessProfile>): DerivedBusinessProfile {
  return {
    name: null, nameSource: null, description: null, industry: null, schemaTypes: [],
    phone: null, address: null, locations: [], services: [], keyPages: [],
    socialProfiles: [], contentSiteSignal: false, ...over,
  };
}

describe("classifyBusinessType: grounded, generic, no hardcoding", () => {
  it("address: local_service (high); phone alone also fires local_service", () => {
    const v = classifyBusinessType({
      profile: typedProfile({ address: "100 Ranch Rd, Fredericksburg, TX", locations: ["fredericksburg"] }),
    });
    expect(v.businessType).toBe("local_service");
    expect(v.confidence).toBe("high");
    expect(classifyBusinessType({ profile: typedProfile({ phone: "+1-520-555-0199" }) }).businessType).toBe("local_service");
  });

  it("content site with a region-only tag stays content_publisher, never local", () => {
    const v = classifyBusinessType({
      profile: typedProfile({ schemaTypes: ["Article", "WebSite"], contentSiteSignal: true, locations: ["ca"] }),
    });
    expect(v.businessType).toBe("content_publisher");
  });

  it("Product+cart vocab yields ecommerce; SoftwareApplication yields saas; ambiguity stays other", () => {
    expect(
      classifyBusinessType({
        profile: typedProfile({ schemaTypes: ["Product", "Offer"], services: ["shop", "cart", "shipping"] }),
        topQueries: [{ query: "buy running shoes online", impressions: 900 }],
      }).businessType,
    ).toBe("ecommerce");
    expect(
      classifyBusinessType({
        profile: typedProfile({ schemaTypes: ["SoftwareApplication"], services: ["pricing", "docs"] }),
      }).businessType,
    ).toBe("saas");
    const floor = classifyBusinessType({ profile: typedProfile({}) });
    expect(floor.businessType).toBe("other");
    expect(floor.confidence).toBe("low");
    expect(classifyBusinessType({ profile: null }).businessType).toBe("other");
  });

  it("no hardcoded vertical/geo/brand leaks into any verdict evidence", () => {
    const banned = ["ritz", "palo alto", "bay area", "iranopedia", "persian", "farsi"];
    for (const fixture of [
      { address: "1 A St" },
      { schemaTypes: ["Article"], contentSiteSignal: true },
      { schemaTypes: ["Product"], services: ["cart", "shop"] },
      { schemaTypes: ["SoftwareApplication"] },
      {},
    ] as Partial<DerivedBusinessProfile>[]) {
      const flat = classifyBusinessType({ profile: typedProfile(fixture) }).evidence.join(" ").toLowerCase();
      for (const b of banned) expect(flat).not.toContain(b);
    }
  });

  it("segmentForBusinessType keeps local engines off for non-local types", () => {
    expect(segmentForBusinessType("local_service")).toBe("local_service");
    expect(segmentForBusinessType("ecommerce")).toBe("content_publisher");
    expect(segmentForBusinessType("other")).toBeNull();
  });
});

// ── detect-service-areas ────────────────────────────────────────────────────

describe("extractPlacesFromQuery: pattern, not a city list", () => {
  it("pulls the place after in/near/around for any vertical and unknown places", () => {
    expect(extractPlacesFromQuery("plumber in Austin")).toContain("austin");
    expect(extractPlacesFromQuery("roofing in Zzyzx")).toContain("zzyzx");
    expect(extractPlacesFromQuery("cafe near Boerne")).toContain("boerne");
    expect(extractPlacesFromQuery("tacos in San Luis Obispo")).toContain("san luis obispo");
  });

  it("never invents a place for preposition-tail stopwords or a bare trailing 'in'", () => {
    expect(extractPlacesFromQuery("plumber near me")).toEqual([]);
    expect(extractPlacesFromQuery("is it in stock")).toEqual([]);
    expect(extractPlacesFromQuery("plumber in")).toEqual([]);
    expect(extractPlacesFromQuery("roofing austin tx")).toContain("tx"); // real state codes still fire
  });

  it("yields nothing for pure content queries (content-site-safety pin)", () => {
    expect(extractPlacesFromQuery("what is nowruz")).toEqual([]);
    expect(extractPlacesFromQuery("history of the safavid dynasty")).toEqual([]);
  });
});

describe("detectServiceAreas: rank, dedupe, empty-safe", () => {
  it("site-declared places rank first; query-only markets appear as 'search' with impressions", () => {
    const areas = detectServiceAreas({
      configuredPlaces: ["austin", "round rock"],
      queries: [{ query: "plumber in Georgetown", impressions: 5000 }],
    });
    expect(areas[0]!.source).toBe("site");
    const georgetown = areas.find((a) => a.place === "Georgetown");
    expect(georgetown?.source).toBe("search");
    expect(georgetown?.impressions).toBe(5000);
  });

  it("dedupes config+query places (stays 'site', impressions accumulate); ranks by impressions", () => {
    const areas = detectServiceAreas({
      configuredPlaces: ["austin"],
      queries: [
        { query: "plumber in Austin", impressions: 300 },
        { query: "emergency plumber in austin", impressions: 200 },
      ],
    });
    const austin = areas.filter((a) => a.place.toLowerCase() === "austin");
    expect(austin).toHaveLength(1);
    expect(austin[0]!.source).toBe("site");
    expect(austin[0]!.impressions).toBe(500);

    const ranked = detectServiceAreas({
      queries: [
        { query: "dentist in Portland", impressions: 100 },
        { query: "dentist in Salem", impressions: 900 },
        { query: "dentist in Eugene", impressions: 400 },
      ],
    });
    expect(ranked.map((a) => a.place)).toEqual(["Salem", "Eugene", "Portland"]);
  });

  it("content-only queries and empty input yield [] (byte-identical no-op)", () => {
    expect(detectServiceAreas({})).toEqual([]);
    expect(
      detectServiceAreas({
        queries: [
          { query: "what is nowruz", impressions: 9000 },
          { query: "persian new year date", impressions: 8000 },
        ],
      }),
    ).toEqual([]);
  });
});
