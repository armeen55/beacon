/**
 * derive-business-profile — North-star onboarding (2026-06-11).
 *
 * Three fixture sites across verticals/geos pin that EVERY derived value
 * comes from the input HTML — a Texas builder yields Texas cities (never
 * Bay-Area), a content site yields the content signal with zero
 * locations, a restaurant yields its own JSON-LD facts. Plus the unit
 * pins for the title-brand heuristic and the schema-type humanizer.
 */

import { describe, it, expect } from "vitest";

import {
  deriveBusinessProfile,
  brandFromTitle,
  humanizeSchemaType,
  normalizeDerivedLocations,
} from "./derive-business-profile";

// ── Fixture 1: Texas custom-home builder (LocalBusiness JSON-LD) ──

const TEXAS_BUILDER_HTML = `<!doctype html><html><head>
<title>Lone Star Custom Homes | Hill Country Builder</title>
<meta name="description" content="Custom home builder serving the Texas Hill Country.">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["GeneralContractor", "LocalBusiness"],
  "name": "Lone Star Custom Homes",
  "telephone": "+1-512-555-0147",
  "description": "Hill Country custom homes and remodels.",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "100 Ranch Rd",
    "addressLocality": "Fredericksburg",
    "addressRegion": "TX",
    "postalCode": "78624"
  },
  "areaServed": ["Fredericksburg", {"@type": "City", "name": "Boerne"}, "Kerrville"],
  "sameAs": ["https://www.houzz.com/pro/lonestarhomes", "https://www.facebook.com/lonestarhomes"],
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

// ── Fixture 2: content publication (no address, Article schema) ──

const CONTENT_SITE_HTML = `<!doctype html><html><head>
<title>Saffron Atlas — Persian Culture, Explained</title>
<meta property="og:site_name" content="Saffron Atlas">
<meta name="description" content="An encyclopedia of Persian culture, food, and history.">
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
<footer><a href="https://www.instagram.com/saffronatlas">Instagram</a></footer>
</body></html>`;

// ── Fixture 3: restaurant (subtype + tel link, no offers) ──

const RESTAURANT_HTML = `<!doctype html><html><head>
<title>Welcome - La Palma Taqueria</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Restaurant",
  "name": "La Palma Taqueria",
  "address": {"@type": "PostalAddress", "addressLocality": "Tucson", "addressRegion": "AZ"},
  "servesCuisine": "Mexican"
}
</script></head><body>
<header><nav>
  <a href="/">Home</a>
  <a href="/catering">Catering</a>
  <a href="/our-menu">Our Menu</a>
  <a href="/contact">Contact</a>
</nav></header>
<a href="tel:+15205550199">Call</a>
</body></html>`;

describe("deriveBusinessProfile — Texas builder fixture (geo comes from INPUT)", () => {
  const profile = deriveBusinessProfile([
    { url: "https://lonestarhomes.com/", html: TEXAS_BUILDER_HTML },
  ]);

  it("derives name from JSON-LD", () => {
    expect(profile.name).toBe("Lone Star Custom Homes");
    expect(profile.nameSource).toBe("json-ld");
  });

  it("derives industry from the schema subtype (humanized)", () => {
    expect(profile.industry).toBe("general contractor");
  });

  it("derives phone + printable address", () => {
    expect(profile.phone).toBe("+1-512-555-0147");
    expect(profile.address).toBe("100 Ranch Rd, Fredericksburg, TX, 78624");
  });

  it("locations are the SITE'S cities — zero Bay-Area leakage", () => {
    expect(profile.locations).toEqual(
      expect.arrayContaining(["fredericksburg", "tx", "boerne", "kerrville"]),
    );
    for (const banned of ["palo alto", "menlo park", "atherton", "bay area"]) {
      expect(profile.locations).not.toContain(banned);
    }
  });

  it("services merge JSON-LD offers + nav labels minus furniture", () => {
    expect(profile.services).toEqual(
      expect.arrayContaining([
        "custom home construction",
        "whole home remodeling",
        "custom homes",
        "remodeling",
      ]),
    );
    expect(profile.services).not.toContain("home");
    expect(profile.services).not.toContain("about");
    expect(profile.services).not.toContain("contact");
    expect(profile.services).not.toContain("portfolio");
  });

  it("key pages are internal nav paths with / first", () => {
    expect(profile.keyPages[0]).toBe("/");
    expect(profile.keyPages).toEqual(
      expect.arrayContaining(["/custom-homes", "/remodeling"]),
    );
  });

  it("social profiles from sameAs", () => {
    expect(profile.socialProfiles).toEqual(
      expect.arrayContaining(["https://www.houzz.com/pro/lonestarhomes"]),
    );
  });

  it("a business with an address is NOT a content site", () => {
    expect(profile.contentSiteSignal).toBe(false);
  });
});

describe("deriveBusinessProfile — content publication fixture", () => {
  const profile = deriveBusinessProfile([
    { url: "https://saffronatlas.com/", html: CONTENT_SITE_HTML },
  ]);

  it("falls back to og:site_name for the name", () => {
    expect(profile.name).toBe("Saffron Atlas");
    expect(profile.nameSource).toBe("og-site-name");
  });

  it("Article schema + no address → contentSiteSignal", () => {
    expect(profile.contentSiteSignal).toBe(true);
  });

  it("a content site derives ZERO locations (no invented geo)", () => {
    expect(profile.locations).toEqual([]);
  });

  it("topic hubs surface as services; furniture filtered", () => {
    expect(profile.services).toEqual(
      expect.arrayContaining(["persian food", "history", "persian names"]),
    );
    expect(profile.services).not.toContain("about");
  });
});

describe("deriveBusinessProfile — restaurant fixture", () => {
  const profile = deriveBusinessProfile([
    { url: "https://lapalmataqueria.com/", html: RESTAURANT_HTML },
  ]);

  it("derives the subtype industry + the site's own city", () => {
    expect(profile.industry).toBe("restaurant");
    expect(profile.locations).toEqual(expect.arrayContaining(["tucson", "az"]));
  });

  it("falls back to the tel: link for phone", () => {
    expect(profile.phone).toBe("+15205550199");
  });
});

describe("deriveBusinessProfile — audit-7 mis-detection guards", () => {
  // #1/#2: a local business with a phone (footer/tel/JSON-LD) but no JSON-LD
  // PostalAddress, whose homepage carries an incidental BlogPosting node, must
  // NOT be flagged as a content publisher.
  const LOCAL_BLOG_HTML = `<!doctype html><html><head>
<title>Ace Plumbing — Austin</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":["Plumber","LocalBusiness"],"name":"Ace Plumbing","telephone":"+1-512-555-0123"}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BlogPosting","headline":"5 Signs You Need a New Water Heater"}
</script></head><body>
<header><nav><a href="/">Home</a><a href="/services">Services</a><a href="/blog">Blog</a><a href="/contact">Contact</a></nav></header>
<footer>123 Main St, Austin TX - Call (512) 555-0123</footer>
</body></html>`;

  it("a phone-bearing local business with incidental blog schema is NOT a content site", () => {
    const profile = deriveBusinessProfile([
      { url: "https://aceplumbingaustin.com/", html: LOCAL_BLOG_HTML },
    ]);
    expect(profile.phone).not.toBeNull(); // local presence signal present
    expect(profile.address).toBeNull(); // no JSON-LD PostalAddress
    expect(profile.contentSiteSignal).toBe(false); // ...so NOT content despite the BlogPosting
  });

  // #3: discovered FOOTER links are filtered by SOCIAL_HOST_PATTERN (unlike
  // explicit JSON-LD sameAs, which is trusted as-is). The bare `x` alternative
  // must match a FULL host label, so a "Made with Wix" footer badge is NOT
  // captured as the tenant's x/twitter profile, while a real x.com link is.
  const SOCIAL_ANCHOR_HTML = `<!doctype html><html><head>
<title>Acme</title></head><body>
<nav><a href="/">Home</a></nav>
<footer>
  <a href="https://wix.com/website-template/acme">Made with Wix</a>
  <a href="https://x.com/acmehq">Follow us on X</a>
  <a href="https://www.facebook.com/acme">Facebook</a>
</footer></body></html>`;

  it("does not capture a wix.com footer badge as an x/twitter profile, but keeps real x.com", () => {
    const profile = deriveBusinessProfile([
      { url: "https://acme.example/", html: SOCIAL_ANCHOR_HTML },
    ]);
    expect(profile.socialProfiles.some((u) => u.includes("x.com/acmehq"))).toBe(true);
    expect(profile.socialProfiles.some((u) => u.includes("facebook.com/acme"))).toBe(true);
    expect(profile.socialProfiles.some((u) => u.includes("wix.com"))).toBe(false);
  });
});

describe("brandFromTitle", () => {
  it("takes the brand segment, skipping generic page words", () => {
    expect(brandFromTitle("Welcome - La Palma Taqueria")).toBe("La Palma Taqueria");
    expect(brandFromTitle("Acme Plumbing | SF's Trusted Plumbers")).toBe("Acme Plumbing");
    expect(brandFromTitle("Home | Acme Co")).toBe("Acme Co");
  });
});

describe("humanizeSchemaType", () => {
  it("camelCase → words, with overrides for awkward spellings", () => {
    expect(humanizeSchemaType("BeautySalon")).toBe("beauty salon");
    expect(humanizeSchemaType("GeneralContractor")).toBe("general contractor");
    expect(humanizeSchemaType("HVACBusiness")).toBe("HVAC services");
    expect(humanizeSchemaType("LegalService")).toBe("legal services");
  });
});

describe("deriveBusinessProfile — empty/hostile input", () => {
  it("no pages → all-null profile (honest blanks, no invented defaults)", () => {
    const p = deriveBusinessProfile([]);
    expect(p.name).toBeNull();
    expect(p.locations).toEqual([]);
    expect(p.services).toEqual([]);
  });

  it("malformed JSON-LD never crashes or poisons other blocks", () => {
    const html = `<html><head>
      <script type="application/ld+json">{not json at all</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Survivor Co","sameAs":["https://www.facebook.com/survivor"]}</script>
      </head><body></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://x.com/", html }]);
    expect(p.name).toBe("Survivor Co");
  });
});

// ── Live-check hardening (2026-06-11, ritzbuilders.com run) ──

describe("normalizeDerivedLocations — real-world areaServed noise", () => {
  it("collapses 'city + region' variants into the bare city", () => {
    expect(
      normalizeDerivedLocations(["palo alto", "palo alto ca", "Cupertino CA"]),
    ).toEqual(["palo alto", "cupertino"]);
  });
  it("strips parenthetical marketing tails", () => {
    expect(normalizeDerivedLocations(["east bay (select locations)"])).toEqual([
      "east bay",
    ]);
  });
  it("bare region codes survive as themselves (downstream filters them)", () => {
    expect(normalizeDerivedLocations(["ca", "tx"])).toEqual(["ca", "tx"]);
  });
  it("caps at 30, first occurrence wins", () => {
    const many = Array.from({ length: 40 }, (_, i) => `city${i}`);
    expect(normalizeDerivedLocations(many)).toHaveLength(30);
  });
});

describe("nav services — CTA + self-referential filtering (live check)", () => {
  it("drops CTA labels, 'our X' furniture, and brand-named nav entries", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"Organization","name":"Ritz Builders","sameAs":["https://www.facebook.com/r"]}</script>
      </head><body><header><nav>
      <a href="/services">Our Services</a>
      <a href="/call">Call Now</a>
      <a href="/consult">Schedule a Consultation</a>
      <a href="/brand">Ritz Builders Services</a>
      <a href="/remodeling">Whole-Home Remodeling</a>
      </nav></header></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://ritz.com/", html }]);
    expect(p.services).toEqual(["whole-home remodeling"]);
  });
});

describe("nav services — promo-page furniture (live check round 3)", () => {
  it("'coupons'/'deals' never become services (rotorooter.com)", () => {
    const html = `<html><body><header><nav>
      <a href="/coupons">Coupons</a>
      <a href="/deals">Deals</a>
      <a href="/drain-cleaning">Drain Cleaning</a>
      </nav></header></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://rr.com/", html }]);
    expect(p.services).toEqual(["drain cleaning"]);
  });
});

describe("nav services — icon-font + phone-label hygiene (live check round 2)", () => {
  it("icon ligature text and phone-shaped labels never become services", () => {
    const html = `<html><body><header><nav>
      <a href="tel:8002773633"><i class="material-icons">local_phone</i>(800) 277-3633</a>
      <a href="/account"><span aria-hidden="true">person_outline</span></a>
      <a href="/dentures"><svg></svg>Dentures</a>
      <a href="/implants">Dental Implants</a>
      </nav></header></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://aspen.com/", html }]);
    expect(p.services).toEqual(["dentures", "dental implants"]);
  });
});

describe("JSON-LD org detection — Product nodes never win (live check round 4)", () => {
  it("a Product node with sameAs/offers is NOT the business; og:site_name wins", () => {
    const html = `<html><head>
      <meta property="og:site_name" content="Square">
      <script type="application/ld+json">
      {"@type":"Product","name":"Square Reader for Contactless and Chip (2nd Generation)","sameAs":["https://www.facebook.com/square"],"offers":{"@type":"Offer","price":"49"}}
      </script></head><body></body></html>`;
    const p = deriveBusinessProfile([{ url: "https://squareup.com/", html }]);
    expect(p.name).toBe("Square");
    expect(p.nameSource).toBe("og-site-name");
    expect(p.industry).not.toBe("product");
  });
});
