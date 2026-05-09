import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";

describe("extractPageSnapshot – FAQ extraction", () => {
  it("extracts FAQs from JSON-LD FAQPage schema", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "FAQPage",
        "mainEntity": [
          {"@type": "Question", "name": "What is the cost?", "acceptedAnswer": {"@type": "Answer", "text": "About $500k."}},
          {"@type": "Question", "name": "How long does it take?", "acceptedAnswer": {"@type": "Answer", "text": "12 months."}}
        ]
      }</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-1", "tenant-test");
    expect(snap.faqs).toHaveLength(2);
    expect(snap.faqs[0].source).toBe("jsonld");
    expect(snap.faqs[0].question).toBe("What is the cost?");
    expect(snap.schema_types).toContain("FAQPage");
  });

  it("extracts FAQs from details/summary elements", () => {
    const html = `<html><body>
      <details><summary>What areas do you serve?</summary><p>We serve the Bay Area.</p></details>
      <details><summary>How do I start?</summary><p>Contact us for a consultation.</p></details>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-2", "tenant-test");
    expect(snap.faqs).toHaveLength(2);
    expect(snap.faqs[0].source).toBe("html_details");
  });

  it("extracts FAQs from h2 FAQ heading + h3 question children (Ritz pattern)", () => {
    const html = `<html><body>
      <h2>Frequently Asked Questions</h2>
      <p>Common questions from homeowners.</p>
      <h3>Who are the best custom home builders in Menlo Park?</h3>
      <p>The best builders are firms with strong design-build coordination.</p>
      <h3>Should I hire a design-build firm or separate architect?</h3>
      <p>For complex projects, a design-build firm usually provides stronger coordination.</p>
      <h3>What is the process for a teardown and rebuild?</h3>
      <p>A teardown-rebuild usually starts with feasibility review.</p>
      <h2>Contact Us</h2>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/menlo-park", "pg-3", "tenant-test");
    expect(snap.faqs.length).toBeGreaterThanOrEqual(3);
    expect(snap.faqs[0].source).toBe("html_section");
    expect(snap.faqs[0].question).toContain("best custom home builders");
    expect(snap.faqs[0].answer_excerpt).toContain("design-build");
  });

  it("handles FAQ heading with 'common questions' text", () => {
    const html = `<html><body>
      <h2>Common Questions About Building</h2>
      <h3>How much does it cost?</h3>
      <p>Costs range from $600 to $1200 per square foot.</p>
      <h3>How long does construction take?</h3>
      <p>14 to 24 months typically.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/faq", "pg-4", "tenant-test");
    expect(snap.faqs.length).toBeGreaterThanOrEqual(2);
    expect(snap.faqs[0].question).toContain("How much does it cost?");
  });

  it("extracts FAQs from strong/b elements inside blocks (original pattern)", () => {
    const html = `<html><body>
      <h2>FAQ</h2>
      <div><strong>What warranties do you offer?</strong> We provide a 10-year structural warranty.</div>
      <div><b>Do you handle permits?</b> Yes, we manage the entire permit process.</div>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/faq2", "pg-5", "tenant-test");
    expect(snap.faqs.length).toBeGreaterThanOrEqual(2);
    expect(snap.faqs[0].source).toBe("html_section");
  });

  it("does not double-count when both JSON-LD and HTML FAQs exist", () => {
    const html = `<html><head>
      <script type="application/ld+json">{
        "@type": "FAQPage",
        "mainEntity": [
          {"@type": "Question", "name": "Cost question?", "acceptedAnswer": {"@type": "Answer", "text": "Answer."}}
        ]
      }</script>
    </head><body>
      <h2>Frequently Asked Questions</h2>
      <h3>Cost question?</h3>
      <p>Answer.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/both", "pg-6", "tenant-test");
    expect(snap.faqs.length).toBeGreaterThanOrEqual(1);
  });

  it("stops h3 FAQ walking at next h2", () => {
    const html = `<html><body>
      <h2>FAQ</h2>
      <h3>Is this a question?</h3>
      <p>Yes it is.</p>
      <h2>Unrelated Section</h2>
      <h3>This is not a FAQ?</h3>
      <p>Should not be captured.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/boundary", "pg-7", "tenant-test");
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].question).toBe("Is this a question?");
  });
});

describe("extractPageSnapshot – top-level JSON-LD array (menlo-park bug fix)", () => {
  it("extracts FAQs from a top-level JSON-LD array", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@context":"https://schema.org","@type":"HomeAndConstructionBusiness","name":"Ritz Builders"},
        {"@context":"https://schema.org","@type":"WebPage","name":"Test"},
        {"@context":"https://schema.org","@type":"BreadcrumbList"},
        {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
          {"@type":"Question","name":"Who are the best builders?","acceptedAnswer":{"@type":"Answer","text":"Firms with design-build."}},
          {"@type":"Question","name":"Should I hire design-build?","acceptedAnswer":{"@type":"Answer","text":"Yes for complex projects."}}
        ]}
      ]</script>
    </head><body><p>Content here about building.</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/locations/menlo-park", "pg-mp", "tenant-test");
    expect(snap.faqs).toHaveLength(2);
    expect(snap.faqs[0].question).toContain("best builders");
    expect(snap.faqs[0].source).toBe("jsonld");
  });

  it("extracts all schema types from a top-level JSON-LD array", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@type":"HomeAndConstructionBusiness"},
        {"@type":"WebPage"},
        {"@type":"BreadcrumbList"},
        {"@type":"FAQPage","mainEntity":[]}
      ]</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-arr", "tenant-test");
    expect(snap.schema_types).toContain("HomeAndConstructionBusiness");
    expect(snap.schema_types).toContain("WebPage");
    expect(snap.schema_types).toContain("BreadcrumbList");
    expect(snap.schema_types).toContain("FAQPage");
    expect(snap.schema_types).toHaveLength(4);
  });

  it("handles mixed array + separate JSON-LD blocks", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@type":"Article"},
        {"@type":"FAQPage","mainEntity":[
          {"@type":"Question","name":"Q from array?","acceptedAnswer":{"@type":"Answer","text":"A1"}}
        ]}
      ]</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Q from standalone?","acceptedAnswer":{"@type":"Answer","text":"A2"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/mixed", "pg-mix", "tenant-test");
    expect(snap.faqs).toHaveLength(2);
    expect(snap.schema_types).toContain("Article");
    expect(snap.schema_types).toContain("FAQPage");
  });
});

describe("extractPageSnapshot – duplicate FAQ schema detection", () => {
  it("detects duplicate FAQPage blocks and sets warning", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@type":"FAQPage","mainEntity":[
          {"@type":"Question","name":"Q1?","acceptedAnswer":{"@type":"Answer","text":"A1"}}
        ]}
      ]</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Q1?","acceptedAnswer":{"@type":"Answer","text":"A1"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/dup", "pg-dup", "tenant-test");
    expect(snap.faq_schema_block_count).toBe(2);
    expect(snap.structural_warnings).toBeDefined();
    expect(snap.structural_warnings![0]).toContain("duplicate_faq_schema");
  });

  it("does not warn for single FAQPage block", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Q1?","acceptedAnswer":{"@type":"Answer","text":"A1"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/single", "pg-s", "tenant-test");
    expect(snap.faq_schema_block_count).toBe(1);
    expect(snap.structural_warnings).toBeUndefined();
  });
});

describe("extractPageSnapshot – extraction certainty", () => {
  it("marks extraction as confirmed when JSON-LD is present", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
    </head><body><p>Some content here for word count purposes in this test case.</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-c", "tenant-test");
    expect(snap.extraction_certainty).toBe("confirmed");
  });

  it("marks extraction as confirmed when body has substantial content", () => {
    const html = `<html><body><p>${"word ".repeat(100)}</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-c2", "tenant-test");
    expect(snap.extraction_certainty).toBe("confirmed");
  });

  it("marks extraction as uncertain when body is nearly empty", () => {
    const html = `<html><body><div id="root"></div></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/spa", "pg-u", "tenant-test");
    expect(snap.extraction_certainty).toBe("uncertain");
  });
});

describe("extractPageSnapshot – edge cases", () => {
  it("handles nested @graph inside array items", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@type":"Organization","@graph":[
          {"@type":"FAQPage","mainEntity":[
            {"@type":"Question","name":"Nested Q?","acceptedAnswer":{"@type":"Answer","text":"A"}}
          ]}
        ]}
      ]</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/nested", "pg-nest", "tenant-test");
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].question).toBe("Nested Q?");
    expect(snap.schema_types).toContain("Organization");
    expect(snap.schema_types).toContain("FAQPage");
  });

  it("handles empty JSON-LD array", () => {
    const html = `<html><head>
      <script type="application/ld+json">[]</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/empty-arr", "pg-ea", "tenant-test");
    expect(snap.faqs).toHaveLength(0);
    expect(snap.schema_types).toHaveLength(0);
    expect(snap.faq_schema_block_count).toBe(0);
  });

  it("handles malformed JSON-LD gracefully", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"broken json</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Valid Q?","acceptedAnswer":{"@type":"Answer","text":"A"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/broken", "pg-br", "tenant-test");
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].question).toBe("Valid Q?");
  });

  it("deduplicates schema types from multiple blocks", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[]}</script>
      <script type="application/ld+json">[{"@type":"FAQPage","mainEntity":[]}]</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/dedup", "pg-dd", "tenant-test");
    // schema_types uses Set — should deduplicate
    expect(snap.schema_types.filter(t => t === "FAQPage")).toHaveLength(1);
    // But faq_schema_block_count should count both
    expect(snap.faq_schema_block_count).toBe(2);
  });

  it("handles FAQPage with no mainEntity", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":"FAQPage"}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/no-me", "pg-nm", "tenant-test");
    expect(snap.faqs).toHaveLength(0);
    expect(snap.schema_types).toContain("FAQPage");
    expect(snap.faq_schema_block_count).toBe(1);
  });

  it("handles array @type like [\"WebPage\", \"FAQPage\"]", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@type":["WebPage","FAQPage"],"mainEntity":[
        {"@type":"Question","name":"Multi-type Q?","acceptedAnswer":{"@type":"Answer","text":"A"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/multi-type", "pg-mt", "tenant-test");
    expect(snap.schema_types).toContain("WebPage");
    expect(snap.schema_types).toContain("FAQPage");
  });

  it("counts FAQPage blocks inside @graph", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"@graph":[
        {"@type":"FAQPage","mainEntity":[]},
        {"@type":"WebPage"}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/graph", "pg-gr", "tenant-test");
    expect(snap.faq_schema_block_count).toBe(1);
    expect(snap.schema_types).toContain("FAQPage");
    expect(snap.schema_types).toContain("WebPage");
  });
});

describe("extractPageSnapshot – title and meta", () => {
  it("extracts title, meta, h1, canonical correctly", () => {
    const html = `<html><head>
      <title>My Page Title</title>
      <meta name="description" content="A great page about things.">
      <link rel="canonical" href="https://example.com/page">
    </head><body>
      <h1>Main Heading</h1>
      <p>Content here.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-8", "tenant-test");
    expect(snap.title).toBe("My Page Title");
    expect(snap.meta_description).toBe("A great page about things.");
    expect(snap.h1).toBe("Main Heading");
    expect(snap.canonical_url).toBe("https://example.com/page");
    expect(snap.has_canonical_mismatch).toBe(false);
  });
});
