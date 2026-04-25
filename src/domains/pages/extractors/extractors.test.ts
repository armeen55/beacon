import { describe, it, expect } from "vitest";
import type { PageSnapshot, FaqItem } from "../types";
import {
  extractTitle,
  extractMeta,
  extractCanonical,
  extractH1,
  extractH2,
  extractH3,
  extractFaqQuestion,
  extractFaqAnswer,
  extractSchemaType,
  extractSchemaProperty,
  extractInternalLink,
  extractCityMention,
  extractServiceMention,
  EXTRACTORS,
  EXTRACTOR_MAP_SIZE,
} from "./extractors";
import { extractAllElements, extractSingle } from "./dispatcher";
import {
  ELEMENT_TYPES,
  EXTRACTOR_REGISTRY,
  type ElementType,
} from "./registry";
import type { ExtractorContext } from "./types";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 5 — extractor tests.
//
// Every active extractor gets a fixture-based unit test. Tests are
// resilience-first — empty/missing inputs don't throw, malformed JSON-LD
// is swallowed, dictionary-driven extractors work with arbitrary
// dictionaries (no Ritz hardcoding).
// ---------------------------------------------------------------------------

// ── Test fixture builders ──────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: "snap-test-1",
    page_id: "pg-test",
    url: "https://example.com/services/design-build",
    canonical_url: null,
    fetched_at: "2026-04-24T10:00:00Z",
    http_status: 200,
    title: null,
    meta_description: null,
    h1: null,
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 0,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "h",
    headings_hash: "h",
    faq_hash: "h",
    schema_hash: "h",
    ...overrides,
  } as PageSnapshot;
}

const DEFAULT_CTX: ExtractorContext = {
  pageUrl: "https://example.com/services/design-build",
};

// ── Title / Meta / Canonical (singletons) ──────────────────────────────────

describe("Phase 6A.1.5 — title / meta / canonical extractors", () => {
  it("extractTitle emits exactly one row when snapshot.title is set", () => {
    const rows = extractTitle(
      makeSnapshot({ title: "My Page Title" }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].elementType).toBe("title");
    expect(rows[0].elementText).toBe("My Page Title");
    expect(rows[0].elementKey).toMatch(/^title\[0\]:[0-9a-f]{12}$/);
    expect(rows[0].displayLabel).toContain("Title tag");
    expect(rows[0].displayLabel).toContain("My Page Title");
  });

  it("extractTitle emits zero rows when snapshot.title is null/empty", () => {
    expect(extractTitle(makeSnapshot({ title: null }), "", DEFAULT_CTX)).toHaveLength(0);
    expect(extractTitle(makeSnapshot({ title: "" }), "", DEFAULT_CTX)).toHaveLength(0);
    expect(extractTitle(makeSnapshot({ title: "   " }), "", DEFAULT_CTX)).toHaveLength(0);
  });

  it("extractMeta emits exactly one row when meta_description is set", () => {
    const rows = extractMeta(
      makeSnapshot({ meta_description: "We design + build custom homes." }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].elementType).toBe("meta");
    expect(rows[0].elementText).toBe("We design + build custom homes.");
  });

  it("extractMeta emits zero rows when meta_description is missing", () => {
    expect(extractMeta(makeSnapshot({ meta_description: null }), "", DEFAULT_CTX)).toHaveLength(0);
  });

  it("extractCanonical emits exactly one row when canonical_url is set", () => {
    const rows = extractCanonical(
      makeSnapshot({ canonical_url: "https://example.com/canonical-x/" }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].elementText).toBe("https://example.com/canonical-x/");
  });

  it("extractCanonical emits zero rows when canonical_url is null", () => {
    expect(extractCanonical(makeSnapshot({ canonical_url: null }), "", DEFAULT_CTX)).toHaveLength(0);
  });
});

// ── Headings ────────────────────────────────────────────────────────────────

describe("Phase 6A.1.5 — heading extractors", () => {
  it("extractH1 emits one row when snapshot.h1 is set", () => {
    const rows = extractH1(
      makeSnapshot({ h1: "Custom Home Builder" }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].elementText).toBe("Custom Home Builder");
    expect(rows[0].elementKey).toMatch(/^h1\[0\]:[0-9a-f]{12}$/);
  });

  it("extractH2 emits one row per non-empty h2 in h2_list", () => {
    const rows = extractH2(
      makeSnapshot({
        h2_list: ["Why Choose Us", "Our Process", "What We Build"],
      }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].elementKey).toMatch(/^h2\[0\]:/);
    expect(rows[1].elementKey).toMatch(/^h2\[1\]:/);
    expect(rows[2].elementKey).toMatch(/^h2\[2\]:/);
    expect(rows.map((r) => r.elementText)).toEqual([
      "Why Choose Us",
      "Our Process",
      "What We Build",
    ]);
  });

  it("extractH2 skips empty/whitespace entries gracefully", () => {
    const rows = extractH2(
      makeSnapshot({ h2_list: ["Real H2", "", "   ", "Another H2"] }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.elementText)).toEqual(["Real H2", "Another H2"]);
  });

  it("extractH3 parses h3 text from raw HTML (snapshot only has count)", () => {
    const html = `<html><body>
      <h3>FAQ Q1</h3>
      <h3>FAQ Q2</h3>
      <h3></h3>
      <h3>  FAQ Q3  </h3>
    </body></html>`;
    const rows = extractH3(makeSnapshot(), html, DEFAULT_CTX);
    expect(rows).toHaveLength(3); // empty h3 skipped
    expect(rows.map((r) => r.elementText)).toEqual(["FAQ Q1", "FAQ Q2", "FAQ Q3"]);
    // Position uses DOM order (cheerio iteration index), not "kept order".
    // The empty h3 at DOM position 2 is skipped but still consumes the
    // index — so the third KEPT h3 lives at DOM position 3. This is the
    // intended semantic: filling in an empty h3 later won't shift the
    // positions of its siblings, preserving attribution windows.
    expect(rows[0].elementKey).toMatch(/^h3\[0\]:[0-9a-f]{12}$/);
    expect(rows[1].elementKey).toMatch(/^h3\[1\]:[0-9a-f]{12}$/);
    expect(rows[2].elementKey).toMatch(/^h3\[3\]:[0-9a-f]{12}$/);
  });

  it("extractH3 caps at 30 entries", () => {
    const html =
      "<html><body>" +
      Array.from({ length: 50 }, (_, i) => `<h3>H${i}</h3>`).join("") +
      "</body></html>";
    const rows = extractH3(makeSnapshot(), html, DEFAULT_CTX);
    expect(rows).toHaveLength(30);
  });

  it("extractH3 returns [] on empty html", () => {
    expect(extractH3(makeSnapshot(), "", DEFAULT_CTX)).toHaveLength(0);
  });
});

// ── FAQ ─────────────────────────────────────────────────────────────────────

describe("Phase 6A.1.5 — FAQ extractors", () => {
  const faqs: FaqItem[] = [
    {
      question: "How long does a custom home take?",
      answer_excerpt: "Typically 12-18 months from design to move-in.",
      source: "jsonld",
    },
    {
      question: "Do you handle architect-led builds?",
      answer_excerpt: "Yes, design-build is our specialty.",
      source: "html_section",
    },
    {
      question: "What is your fee model?",
      answer_excerpt: "Fixed-price contracts, no surprises.",
      source: "html_details",
    },
  ];

  it("extractFaqQuestion emits one row per FAQ with source in metadata", () => {
    const rows = extractFaqQuestion(makeSnapshot({ faqs }), "", DEFAULT_CTX);
    expect(rows).toHaveLength(3);
    expect(rows[0].elementText).toBe("How long does a custom home take?");
    expect(rows[0].elementMetadata.source).toBe("jsonld");
    expect(rows[1].elementMetadata.source).toBe("html_section");
    expect(rows[2].elementMetadata.source).toBe("html_details");
  });

  it("extractFaqAnswer emits one row per FAQ with source + paired question in metadata", () => {
    const rows = extractFaqAnswer(makeSnapshot({ faqs }), "", DEFAULT_CTX);
    expect(rows).toHaveLength(3);
    expect(rows[0].elementText).toBe(
      "Typically 12-18 months from design to move-in.",
    );
    expect(rows[0].elementMetadata.source).toBe("jsonld");
    expect(rows[0].elementMetadata.question).toBe(
      "How long does a custom home take?",
    );
  });

  it("FAQ extractors return [] when snapshot.faqs is missing/empty", () => {
    expect(extractFaqQuestion(makeSnapshot(), "", DEFAULT_CTX)).toHaveLength(0);
    expect(extractFaqAnswer(makeSnapshot(), "", DEFAULT_CTX)).toHaveLength(0);
  });

  it("FAQ extractors skip rows with empty question/answer text", () => {
    const partial: FaqItem[] = [
      { question: "Real?", answer_excerpt: "Yes.", source: "jsonld" },
      { question: "", answer_excerpt: "Orphan answer", source: "jsonld" },
      { question: "Orphan question?", answer_excerpt: "", source: "jsonld" },
    ];
    const qs = extractFaqQuestion(makeSnapshot({ faqs: partial }), "", DEFAULT_CTX);
    const as = extractFaqAnswer(makeSnapshot({ faqs: partial }), "", DEFAULT_CTX);
    expect(qs).toHaveLength(2); // skips empty question
    expect(as).toHaveLength(2); // skips empty answer
  });
});

// ── Schema ──────────────────────────────────────────────────────────────────

describe("Phase 6A.1.5 — schema extractors", () => {
  it("extractSchemaType emits one row per distinct @type", () => {
    const rows = extractSchemaType(
      makeSnapshot({
        schema_types: ["FAQPage", "LocalBusiness", "BreadcrumbList"],
      }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.elementText)).toEqual([
      "FAQPage",
      "LocalBusiness",
      "BreadcrumbList",
    ]);
    expect(rows[0].elementKey).toBe("schema[FAQPage]");
    expect(rows[1].elementKey).toBe("schema[LocalBusiness]");
  });

  it("extractSchemaType deduplicates repeated @types", () => {
    const rows = extractSchemaType(
      makeSnapshot({
        schema_types: ["FAQPage", "FAQPage", "Service"],
      }),
      "",
      DEFAULT_CTX,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.elementText).sort()).toEqual([
      "FAQPage",
      "Service",
    ]);
  });

  it("extractSchemaProperty walks JSON-LD and emits string-leaf rows", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {
          "@type": "Service",
          "name": "Custom Home Building",
          "description": "Architect-led design-build",
          "provider": { "@type": "Organization", "name": "Ritz Builders" }
        }
      </script>
    </head><body></body></html>`;
    const rows = extractSchemaProperty(makeSnapshot(), html, DEFAULT_CTX);
    // Expect: Service.name, Service.description, Service.provider.name
    // (Service.provider.@type is filtered as a JSON-LD keyword.)
    const paths = rows.map((r) => {
      const md = r.elementMetadata as { path: Array<string | number> };
      return md.path.map((p) => (typeof p === "number" ? `[${p}]` : p)).join(".");
    });
    expect(paths).toContain("name");
    expect(paths).toContain("description");
    expect(paths).toContain("provider.name");
    // None should contain @type (filtered).
    for (const p of paths) {
      expect(p).not.toContain("@type");
    }
  });

  it("extractSchemaProperty handles @graph-wrapped JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "FAQPage", "mainEntity": [
              { "@type": "Question", "name": "Q1?", "acceptedAnswer": { "@type": "Answer", "text": "A1" } },
              { "@type": "Question", "name": "Q2?", "acceptedAnswer": { "@type": "Answer", "text": "A2" } }
            ]}
          ]
        }
      </script>
    </head><body></body></html>`;
    const rows = extractSchemaProperty(makeSnapshot(), html, DEFAULT_CTX);
    const values = rows.map((r) => r.elementText);
    expect(values).toContain("Q1?");
    expect(values).toContain("Q2?");
    expect(values).toContain("A1");
    expect(values).toContain("A2");
  });

  it("extractSchemaProperty does not throw on malformed JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ "@type": "Service" "broken json` +
      `</script>
      <script type="application/ld+json">{"@type":"FAQPage","name":"valid"}</script>
    </head></html>`;
    expect(() => extractSchemaProperty(makeSnapshot(), html, DEFAULT_CTX)).not.toThrow();
    const rows = extractSchemaProperty(makeSnapshot(), html, DEFAULT_CTX);
    // The valid block still produces a row.
    expect(rows.some((r) => r.elementText === "valid")).toBe(true);
  });

  it("extractSchemaProperty caps at 100 properties per snapshot", () => {
    // Build a JSON-LD blob with way more than 100 leaf strings.
    const items = Array.from({ length: 200 }, (_, i) => ({
      "@type": "Question",
      name: `Q${i}?`,
      acceptedAnswer: { "@type": "Answer", text: `A${i}` },
    }));
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "FAQPage",
        mainEntity: items,
      })}</script>
    </head></html>`;
    const rows = extractSchemaProperty(makeSnapshot(), html, DEFAULT_CTX);
    expect(rows.length).toBeLessThanOrEqual(100);
  });

  it("extractSchemaProperty returns [] on empty html", () => {
    expect(extractSchemaProperty(makeSnapshot(), "", DEFAULT_CTX)).toHaveLength(0);
  });
});

// ── Internal links ──────────────────────────────────────────────────────────

describe("Phase 6A.1.5 — internal link extractor", () => {
  const html = `<html><body>
    <a href="/services/design-build">Design + Build</a>
    <a href="/locations/palo-alto">Palo Alto</a>
    <a href="https://example.com/faq">FAQ</a>
    <a href="https://other-site.com/x">External</a>
    <a href="#section">Anchor only</a>
    <a href="mailto:hi@example.com">Email</a>
    <a href="tel:+15551234">Phone</a>
    <a href="javascript:void(0)">JS</a>
    <a>No href</a>
  </body></html>`;

  it("emits same-origin links only; skips external + non-navigational hrefs", () => {
    const rows = extractInternalLink(makeSnapshot(), html, DEFAULT_CTX);
    const hrefs = rows.map(
      (r) => (r.elementMetadata as { href: string }).href,
    );
    expect(hrefs).toContain("/services/design-build");
    expect(hrefs).toContain("/locations/palo-alto");
    expect(hrefs).toContain("/faq");
    // External and non-navigational filtered out
    for (const bad of ["other-site.com", "mailto:", "tel:", "javascript:", "#"]) {
      for (const h of hrefs) {
        expect(h).not.toContain(bad);
      }
    }
    expect(rows).toHaveLength(3);
  });

  it("normalizes absolute same-origin URLs to path-only", () => {
    const rows = extractInternalLink(makeSnapshot(), html, DEFAULT_CTX);
    const fqdn = rows.find(
      (r) =>
        (r.elementMetadata as { href: string }).href === "/faq",
    );
    expect(fqdn).toBeDefined();
  });

  it("captures anchor text in elementText AND metadata.anchor", () => {
    const rows = extractInternalLink(makeSnapshot(), html, DEFAULT_CTX);
    const designLink = rows.find(
      (r) =>
        (r.elementMetadata as { href: string }).href === "/services/design-build",
    );
    expect(designLink?.elementText).toBe("Design + Build");
    expect((designLink?.elementMetadata as { anchor: string }).anchor).toBe(
      "Design + Build",
    );
  });

  it("returns [] when pageUrl is invalid", () => {
    const rows = extractInternalLink(
      makeSnapshot(),
      "<a href='/x'>x</a>",
      { pageUrl: "not-a-url" },
    );
    expect(rows).toHaveLength(0);
  });

  it("returns [] on empty html", () => {
    expect(extractInternalLink(makeSnapshot(), "", DEFAULT_CTX)).toHaveLength(0);
  });
});

// ── City / service mentions (dictionary-driven, NOT Ritz-hardcoded) ────────

describe("Phase 6A.1.5 — city + service mention extractors (dictionary-driven)", () => {
  const html = `<html><body>
    <header>Custom homes in many cities</header>
    <main>
      <p>We build custom homes in Palo Alto and Atherton. Our process supports
      teardown rebuilds, design-build, and architect-provided plans.</p>
      <p>Menlo Park residents trust us for whole home remodels.</p>
    </main>
    <footer>© 2026 Builder</footer>
  </body></html>`;

  it("city_mention finds dictionary terms that appear in body (header/footer ignored)", () => {
    const ctx: ExtractorContext = {
      pageUrl: "https://example.com/x",
      cityDictionary: ["Palo Alto", "Atherton", "Menlo Park", "Cupertino"],
    };
    const rows = extractCityMention(makeSnapshot(), html, ctx);
    const found = rows.map((r) => r.elementText).sort();
    expect(found).toEqual(["Atherton", "Menlo Park", "Palo Alto"]);
    // "Cupertino" not in body → not emitted.
  });

  it("service_mention works with a totally different (non-Ritz) dictionary", () => {
    const ctx: ExtractorContext = {
      pageUrl: "https://example.com/x",
      // Dictionary uses different terms than Ritz's services — proves
      // no hardcoding.
      serviceDictionary: [
        "teardown rebuilds",
        "design-build",
        "architect-provided plans",
        "whole home remodels",
        "kitchen renovation",
      ],
    };
    const rows = extractServiceMention(makeSnapshot(), html, ctx);
    const found = rows.map((r) => r.elementText).sort();
    expect(found).toEqual([
      "architect-provided plans",
      "design-build",
      "teardown rebuilds",
      "whole home remodels",
    ]);
  });

  it("returns [] when dictionary is empty / undefined", () => {
    expect(
      extractCityMention(makeSnapshot(), html, { pageUrl: "x" }),
    ).toHaveLength(0);
    expect(
      extractCityMention(makeSnapshot(), html, {
        pageUrl: "x",
        cityDictionary: [],
      }),
    ).toHaveLength(0);
  });

  it("ignores nav/header/footer/aside content (cross-page boilerplate)", () => {
    const htmlWithNavCity = `<html><body>
      <nav>Visit our Palo Alto location</nav>
      <main>We build in Atherton.</main>
    </body></html>`;
    const rows = extractCityMention(makeSnapshot(), htmlWithNavCity, {
      pageUrl: "x",
      cityDictionary: ["Palo Alto", "Atherton"],
    });
    expect(rows.map((r) => r.elementText)).toEqual(["Atherton"]);
  });

  it("counts occurrences and stores in metadata", () => {
    const heavyHtml = `<html><body><main>
      Palo Alto. Palo Alto, Palo Alto! Palo Alto?
    </main></body></html>`;
    const rows = extractCityMention(makeSnapshot(), heavyHtml, {
      pageUrl: "x",
      cityDictionary: ["Palo Alto"],
    });
    expect(rows).toHaveLength(1);
    expect((rows[0].elementMetadata as { occurrences: number }).occurrences).toBe(4);
  });

  it("matches case-insensitively but stores the dictionary's canonical case", () => {
    const ciHtml = `<html><body><main>palo alto and PALO ALTO and Palo Alto</main></body></html>`;
    const rows = extractCityMention(makeSnapshot(), ciHtml, {
      pageUrl: "x",
      cityDictionary: ["Palo Alto"],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].elementText).toBe("Palo Alto");
    expect((rows[0].elementMetadata as { occurrences: number }).occurrences).toBe(3);
  });
});

// ── Resilience: nothing throws on garbage input ────────────────────────────

describe("Phase 6A.1.5 — resilience (no throws on bad input)", () => {
  it("every active extractor is throw-safe on totally empty inputs", () => {
    const empty = makeSnapshot();
    const ctx: ExtractorContext = { pageUrl: "https://example.com/" };
    for (const elementType of ELEMENT_TYPES) {
      const spec = EXTRACTOR_REGISTRY[elementType];
      if (!spec.active) continue;
      const extractor = EXTRACTORS[elementType];
      expect(() => extractor(empty, "", ctx)).not.toThrow();
    }
  });

  it("every active extractor returns [] for empty inputs", () => {
    const empty = makeSnapshot();
    const ctx: ExtractorContext = { pageUrl: "https://example.com/" };
    for (const elementType of ELEMENT_TYPES) {
      const spec = EXTRACTOR_REGISTRY[elementType];
      if (!spec.active) continue;
      const rows = EXTRACTORS[elementType](empty, "", ctx);
      expect(rows, `${elementType} should return [] on empty input`).toEqual(
        [],
      );
    }
  });

  it("schema extractor swallows bad JSON-LD and continues with valid blocks", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ broken</script>
      <script type="application/ld+json">{"@type":"FAQPage","name":"ok"}</script>
      <script type="application/ld+json">{ also broken</script>
      <script type="application/ld+json">{"@type":"Service","name":"also-ok"}</script>
    </head></html>`;
    const rows = extractSchemaProperty(makeSnapshot(), html, {
      pageUrl: "https://example.com/",
    });
    const values = rows.map((r) => r.elementText);
    expect(values).toContain("ok");
    expect(values).toContain("also-ok");
  });
});

// ── EXTRACTORS map shape ───────────────────────────────────────────────────

describe("Phase 6A.1.5 — EXTRACTORS map", () => {
  it("contains an entry for every ElementType (no orphans)", () => {
    expect(EXTRACTOR_MAP_SIZE).toBe(ELEMENT_TYPES.length);
    for (const t of ELEMENT_TYPES) {
      expect(EXTRACTORS[t]).toBeDefined();
    }
  });

  it("inactive extractors are stub functions returning []", () => {
    const empty = makeSnapshot();
    const ctx: ExtractorContext = { pageUrl: "https://example.com/" };
    for (const t of ELEMENT_TYPES) {
      if (EXTRACTOR_REGISTRY[t].active) continue;
      // Inactive extractors are stubs that always return [] regardless
      // of input. Sprint 6A.2 replaces them with real implementations.
      expect(EXTRACTORS[t](empty, "<html><body>real content</body></html>", ctx)).toEqual(
        [],
      );
    }
  });
});

// ── Dispatcher ─────────────────────────────────────────────────────────────

describe("Phase 6A.1.5 — dispatcher", () => {
  const richSnapshot = makeSnapshot({
    title: "Custom Home Builder",
    meta_description: "We build custom homes.",
    canonical_url: "https://example.com/builder/",
    h1: "Custom Home Builder",
    h2_list: ["Why Choose Us", "Our Process"],
    schema_types: ["FAQPage", "LocalBusiness"],
    faqs: [
      {
        question: "How long?",
        answer_excerpt: "12-18 months.",
        source: "jsonld",
      },
    ],
  });
  const richHtml = `<html><head>
    <script type="application/ld+json">{"@type":"Service","name":"Design Build"}</script>
  </head><body>
    <h3>FAQ Q1</h3>
    <main>We build in Palo Alto and Atherton. Our design-build is loved.</main>
    <a href="/services/design-build">Internal</a>
  </body></html>`;
  const richCtx: ExtractorContext = {
    pageUrl: "https://example.com/services",
    cityDictionary: ["Palo Alto", "Atherton"],
    serviceDictionary: ["design-build"],
  };

  it("extractAllElements runs only active extractors", () => {
    const rows = extractAllElements(richSnapshot, richHtml, richCtx);
    const typesEmitted = new Set(rows.map((r) => r.elementType));
    // No inactive type appears.
    for (const t of ELEMENT_TYPES) {
      if (!EXTRACTOR_REGISTRY[t].active) {
        expect(typesEmitted, `${t} should NOT appear`).not.toContain(t);
      }
    }
    // At least the active ones with data appear.
    const expectedActiveWithData: ElementType[] = [
      "title",
      "meta",
      "canonical",
      "h1",
      "h2",
      "h3",
      "faq_question",
      "faq_answer",
      "schema_type",
      "schema_property",
      "internal_link",
      "city_mention",
      "service_mention",
    ];
    for (const t of expectedActiveWithData) {
      expect(typesEmitted, `${t} should appear`).toContain(t);
    }
  });

  it("extractAllElements emits zero rows for inactive types even when HTML has matching content", () => {
    // The HTML has a `<table>` and a `<ul>` and a competitor name — but
    // table/list/competitor_mention extractors are inactive, so zero
    // rows for those types.
    const html = `<html><body>
      <table><tr><td>data</td></tr></table>
      <ul><li>item</li></ul>
      <p>Beat KastenBuilders today.</p>
      <a href="https://other.com/x">external</a>
    </body></html>`;
    const ctx: ExtractorContext = {
      pageUrl: "https://example.com/",
      competitorDictionary: ["KastenBuilders"],
    };
    const rows = extractAllElements(makeSnapshot(), html, ctx);
    const types = new Set(rows.map((r) => r.elementType));
    expect(types).not.toContain("table");
    expect(types).not.toContain("table_row");
    expect(types).not.toContain("list");
    expect(types).not.toContain("competitor_mention");
    expect(types).not.toContain("external_link");
  });

  it("extractAllElements catches per-extractor errors without aborting the rest", () => {
    // Forge a snapshot that would crash one extractor (here we use a
    // valid snapshot but pass an unparseable URL to break the
    // internal_link extractor's URL parsing — it should return [] not
    // crash the whole dispatcher).
    const rows = extractAllElements(richSnapshot, richHtml, {
      pageUrl: "::::not-a-url::::",
    });
    // The other extractors should still run.
    const types = new Set(rows.map((r) => r.elementType));
    expect(types).toContain("title");
    expect(types).toContain("h1");
  });

  it("extractSingle respects the active flag (returns [] for inactive)", () => {
    const rows = extractSingle(
      "table" as ElementType,
      makeSnapshot(),
      "<table><tr><td>x</td></tr></table>",
      DEFAULT_CTX,
    );
    expect(rows).toEqual([]);
  });

  it("extractSingle runs the requested extractor when active", () => {
    const rows = extractSingle("title", makeSnapshot({ title: "X" }), "", DEFAULT_CTX);
    expect(rows).toHaveLength(1);
    expect(rows[0].elementText).toBe("X");
  });
});
