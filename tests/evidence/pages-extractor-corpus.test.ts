/**
 * PAGES EXTRACTOR CORPUS (Core 100K Phase 6 merged suite).
 * Boundary cases carried from the retired files:
 *   src/domains/pages/extractor.test.ts (body-paragraph N19 + P24 images)
 *   tests/domains/pages/extractor.test.ts (FAQ / JSON-LD / certainty)
 *   src/domains/pages/extractors/element-key.test.ts (key determinism)
 * Deleted as D3/D5: extractor-expanded, extractors/extractors, extractors/
 * registry, extractors/persist per-permutation coverage (rules pinned here).
 */
import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import {
  contentHash,
  positionalKey,
  newElementKey,
  schemaTypeKey,
} from "@/domains/pages/extractors/element-key";

const TENANT = "tenant-test";
const URL = "https://example.com/page";

function wrapHtml(bodyInner: string): string {
  return `<!doctype html><html><head><title>Test Page</title></head><body>${bodyInner}</body></html>`;
}

describe("extractPageSnapshot: body_paragraph_sample boundaries", () => {
  it("treats zero-width-space-only <p> tags as empty, not real paragraphs", () => {
    // Ground-truthed live 2026-07-02 on Iranopedia /persian-kabobs/*.
    const zwsp = "​".repeat(20);
    const html = wrapHtml(`
      <main>
        <h1>Kabob Barg</h1>
        <p>${zwsp}</p>
        <p>${zwsp}</p>
        <div><span>Kabob Barg</span></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-3", TENANT);
    expect(snap.body_paragraph_sample ?? []).toHaveLength(0);
  });

  it("falls back to leaf block-level text when there are zero usable <p> tags", () => {
    const html = wrapHtml(`
      <main>
        <div class="hero">
          <div class="heroInner">
            <span>Explore the rich diversity of Iran animals and discover the Persian wildlife that inhabits this unique region.</span>
          </div>
        </div>
        <div class="cardGrid">
          <div class="card"><span>Persian Cat</span><span>Learn More</span></div>
        </div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-4", TENANT);
    const joined = (snap.body_paragraph_sample ?? []).join(" ");
    expect(joined).toContain("Explore the rich diversity");
    expect(joined).not.toContain("Learn More");
  });

  it("does not run the fallback when real <p> paragraphs already exist", () => {
    const html = wrapHtml(`
      <main>
        <p>This page has a perfectly normal paragraph with more than eight words present.</p>
        <div><span>This div text should never appear because the p tag pass already succeeded here.</span></div>
      </main>
    `);
    const snap = extractPageSnapshot(html, URL, "page-5", TENANT);
    expect(snap.body_paragraph_sample).toHaveLength(1);
    expect(snap.body_paragraph_sample![0]).toContain("perfectly normal paragraph");
  });

  it("caps the excerpt at 20 entries of up to 300 chars each", () => {
    const longSentence =
      "Word ".repeat(70) +
      "and this paragraph is deliberately long enough to exceed the three hundred character per-entry cap so we can verify fair truncation happens on every entry equally.";
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) => `<p>Paragraph number ${i} follows. ${longSentence}</p>`,
    ).join("\n");
    const snap = extractPageSnapshot(wrapHtml(`<main>${paragraphs}</main>`), URL, "page-7", TENANT);
    const sample = snap.body_paragraph_sample ?? [];
    expect(sample.length).toBe(20);
    for (const p of sample) expect(p.length).toBeLessThanOrEqual(300);
  });
});

describe("extractPageSnapshot: image inventory (P24)", () => {
  it("distinguishes a MISSING alt (null) from an EMPTY alt (\"\")", () => {
    const html = wrapHtml(`
      <main>
        <img src="/a.jpg" />
        <img src="/spacer.gif" alt="" />
        <img src="/c.jpg" alt="A cat" />
      </main>
    `);
    const imgs = extractPageSnapshot(html, URL, "img-2", TENANT).images ?? [];
    expect(imgs).toHaveLength(3);
    expect(imgs[0]!.alt).toBeNull();
    expect(imgs[1]!.alt).toBe("");
    expect(imgs[2]!.alt).toBe("A cat");
  });

  it("skips no-src and data:/blob: placeholders; resolves relative srcs", () => {
    const html = wrapHtml(`
      <main>
        <img alt="no src" />
        <img src="data:image/gif;base64,R0lGOD" alt="inline data" />
        <img src="pics/x.jpg" alt="rel" />
      </main>
    `);
    const imgs = extractPageSnapshot(html, URL, "img-4", TENANT).images ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.src).toBe("https://example.com/pics/x.jpg");
  });

  it("returns undefined (not []) when a page has no images", () => {
    const html = wrapHtml(`<main><p>Just words, no pictures at all here on this page.</p></main>`);
    expect(extractPageSnapshot(html, URL, "img-5", TENANT).images).toBeUndefined();
  });
});

describe("extractPageSnapshot: FAQ + JSON-LD extraction", () => {
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
    const snap = extractPageSnapshot(html, URL, "pg-1", TENANT);
    expect(snap.faqs).toHaveLength(2);
    expect(snap.faqs[0].source).toBe("jsonld");
    expect(snap.schema_types).toContain("FAQPage");
  });

  it("extracts FAQs from h2 FAQ heading + h3 question children and stops at the next h2", () => {
    const html = `<html><body>
      <h2>Frequently Asked Questions</h2>
      <h3>Who are the best custom home builders in Menlo Park?</h3>
      <p>The best builders are firms with strong design-build coordination.</p>
      <h2>Unrelated Section</h2>
      <h3>This is not a FAQ?</h3>
      <p>Should not be captured.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/menlo-park", "pg-3", TENANT);
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].source).toBe("html_section");
    expect(snap.faqs[0].question).toContain("best custom home builders");
  });

  it("extracts FAQs and all schema types from a top-level JSON-LD array (menlo-park fix)", () => {
    const html = `<html><head>
      <script type="application/ld+json">[
        {"@context":"https://schema.org","@type":"HomeAndConstructionBusiness","name":"Ritz Builders"},
        {"@context":"https://schema.org","@type":"BreadcrumbList"},
        {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
          {"@type":"Question","name":"Who are the best builders?","acceptedAnswer":{"@type":"Answer","text":"Firms with design-build."}}
        ]}
      ]</script>
    </head><body><p>Content here about building.</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/locations/menlo-park", "pg-mp", TENANT);
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].source).toBe("jsonld");
    expect(snap.schema_types).toContain("HomeAndConstructionBusiness");
    expect(snap.schema_types).toContain("BreadcrumbList");
    expect(snap.schema_types).toContain("FAQPage");
  });

  it("detects duplicate FAQPage blocks and sets a structural warning", () => {
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
    const snap = extractPageSnapshot(html, "https://example.com/dup", "pg-dup", TENANT);
    expect(snap.faq_schema_block_count).toBe(2);
    expect(snap.structural_warnings![0]).toContain("duplicate_faq_schema");
  });

  it("survives malformed JSON-LD and still extracts the valid block", () => {
    const html = `<html><head>
      <script type="application/ld+json">{"broken json</script>
      <script type="application/ld+json">{"@type":"FAQPage","mainEntity":[
        {"@type":"Question","name":"Valid Q?","acceptedAnswer":{"@type":"Answer","text":"A"}}
      ]}</script>
    </head><body><p>Content</p></body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/broken", "pg-br", TENANT);
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].question).toBe("Valid Q?");
  });

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
    const snap = extractPageSnapshot(html, "https://example.com/nested", "pg-nest", TENANT);
    expect(snap.faqs).toHaveLength(1);
    expect(snap.schema_types).toContain("Organization");
    expect(snap.schema_types).toContain("FAQPage");
  });
});

describe("extractPageSnapshot: extraction certainty + head fields", () => {
  it("marks extraction as uncertain when the body is nearly empty (SPA shell)", () => {
    const html = `<html><body><div id="root"></div></body></html>`;
    expect(extractPageSnapshot(html, "https://example.com/spa", "pg-u", TENANT).extraction_certainty).toBe("uncertain");
  });

  it("marks extraction as confirmed when body has substantial content", () => {
    const html = `<html><body><p>${"word ".repeat(100)}</p></body></html>`;
    expect(extractPageSnapshot(html, URL, "pg-c2", TENANT).extraction_certainty).toBe("confirmed");
  });

  it("extracts title, meta, h1, canonical correctly", () => {
    const html = `<html><head>
      <title>My Page Title</title>
      <meta name="description" content="A great page about things.">
      <link rel="canonical" href="https://example.com/page">
    </head><body>
      <h1>Main Heading</h1>
      <p>Content here.</p>
    </body></html>`;
    const snap = extractPageSnapshot(html, URL, "pg-8", TENANT);
    expect(snap.title).toBe("My Page Title");
    expect(snap.meta_description).toBe("A great page about things.");
    expect(snap.h1).toBe("Main Heading");
    expect(snap.canonical_url).toBe("https://example.com/page");
    expect(snap.has_canonical_mismatch).toBe(false);
  });
});

describe("element-key determinism (attribution-window rule)", () => {
  it("contentHash is whitespace-invariant: a reformat-only edit must not burn attribution windows", () => {
    expect(contentHash("hello world")).toBe(contentHash("  hello   world  "));
    expect(contentHash("hello world")).toBe(contentHash("hello\tworld"));
    expect(contentHash("hello world")).toBe(contentHash("hello world"));
    expect(contentHash("Custom Home Builder")).not.toBe(contentHash("custom home builder"));
  });

  it("distinct inputs produce distinct hashes across a sample corpus", () => {
    const samples = [
      "Custom Home Builder Bay Area",
      "Architect-Led Design-Build",
      "How long does a custom home take?",
      "FAQPage",
      ...Array.from({ length: 200 }, (_, i) => `test-input-${i}`),
    ];
    expect(new Set(samples.map(contentHash)).size).toBe(samples.length);
  });

  it("positional, new, and schema keys produce structurally distinct strings", () => {
    const p = positionalKey("h2", 0, "same content");
    const n = newElementKey("h2", "same content");
    const s = schemaTypeKey("FAQPage");
    expect(p).not.toBe(n);
    expect(p).not.toContain("schema[");
    expect(n).not.toContain("schema[");
    expect(s).not.toMatch(/h2\[/);
  });
});
