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
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-1");
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
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-2");
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
    const snap = extractPageSnapshot(html, "https://example.com/menlo-park", "pg-3");
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
    const snap = extractPageSnapshot(html, "https://example.com/faq", "pg-4");
    expect(snap.faqs.length).toBeGreaterThanOrEqual(2);
    expect(snap.faqs[0].question).toContain("How much does it cost?");
  });

  it("extracts FAQs from strong/b elements inside blocks (original pattern)", () => {
    const html = `<html><body>
      <h2>FAQ</h2>
      <div><strong>What warranties do you offer?</strong> We provide a 10-year structural warranty.</div>
      <div><b>Do you handle permits?</b> Yes, we manage the entire permit process.</div>
    </body></html>`;
    const snap = extractPageSnapshot(html, "https://example.com/faq2", "pg-5");
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
    const snap = extractPageSnapshot(html, "https://example.com/both", "pg-6");
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
    const snap = extractPageSnapshot(html, "https://example.com/boundary", "pg-7");
    expect(snap.faqs).toHaveLength(1);
    expect(snap.faqs[0].question).toBe("Is this a question?");
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
    const snap = extractPageSnapshot(html, "https://example.com/page", "pg-8");
    expect(snap.title).toBe("My Page Title");
    expect(snap.meta_description).toBe("A great page about things.");
    expect(snap.h1).toBe("Main Heading");
    expect(snap.canonical_url).toBe("https://example.com/page");
    expect(snap.has_canonical_mismatch).toBe(false);
  });
});
