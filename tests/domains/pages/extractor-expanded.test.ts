/**
 * Plan A (2026-04-20) — extractor expansion tests.
 *
 * Asserts the four new PageSnapshot fields populate correctly from crafted
 * HTML, and that content-only selectors keep nav/footer/header boilerplate
 * out of coverage-feeding fields.
 */

import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";

function extract(html: string) {
  return extractPageSnapshot(
    html,
    "https://site.example/page",
    "page-1",
    "tenant-test",
    200,
  );
}

describe("extractor — h3_list", () => {
  it("captures H3 text in document order, parallel to h2_list", () => {
    const html = `
      <html><body><main>
        <h3>Old Palo Alto</h3>
        <h3>Crescent Park</h3>
        <h3>Midtown</h3>
      </main></body></html>
    `;
    const snap = extract(html);
    expect(snap.h3_list).toEqual(["Old Palo Alto", "Crescent Park", "Midtown"]);
  });

  it("is undefined when there are no H3s", () => {
    const snap = extract("<html><body><p>hi</p></body></html>");
    expect(snap.h3_list).toBeUndefined();
  });

  it("caps at 30 entries", () => {
    const h3s = Array.from({ length: 40 }, (_, i) => `<h3>Item ${i}</h3>`).join("");
    const snap = extract(`<html><body><main>${h3s}</main></body></html>`);
    expect(snap.h3_list?.length).toBe(30);
  });
});

describe("extractor — body_paragraph_sample", () => {
  it("captures paragraphs inside <main>", () => {
    const html = `
      <html><body>
        <main>
          <p>We build luxury custom homes for discerning clients in the Bay Area peninsula.</p>
          <p>Our design-build process combines architect-led design with construction management to deliver modern homes.</p>
        </main>
      </body></html>
    `;
    const snap = extract(html);
    expect(snap.body_paragraph_sample?.length).toBe(2);
    expect(snap.body_paragraph_sample?.[0]).toContain("luxury custom homes");
  });

  it("excludes paragraphs inside <nav>", () => {
    const html = `
      <html><body>
        <nav><p>Home About Services Contact Reviews</p></nav>
        <main><p>This is the real content about custom home building in menlo park.</p></main>
      </body></html>
    `;
    const snap = extract(html);
    expect(snap.body_paragraph_sample?.length).toBe(1);
    expect(snap.body_paragraph_sample?.[0]).toContain("custom home building");
    expect(
      snap.body_paragraph_sample?.some((p) => p.includes("About Services")),
    ).toBe(false);
  });

  it("excludes paragraphs inside <footer>", () => {
    const html = `
      <html><body>
        <main><p>We are a design-build firm specializing in luxury custom homes in the bay area.</p></main>
        <footer><p>Copyright 2026 Ritz Builders, Palo Alto, California. All rights reserved. Licensed contractor.</p></footer>
      </body></html>
    `;
    const snap = extract(html);
    expect(snap.body_paragraph_sample?.length).toBe(1);
    expect(snap.body_paragraph_sample?.[0]).toContain("design-build firm");
  });

  it("falls back to <body> minus boilerplate when no <main>/<article>", () => {
    const html = `
      <html><body>
        <div><p>This is content-area text describing custom home construction projects.</p></div>
      </body></html>
    `;
    const snap = extract(html);
    expect(snap.body_paragraph_sample?.length).toBe(1);
    expect(snap.body_paragraph_sample?.[0]).toContain("custom home construction");
  });

  it("drops paragraphs with fewer than 8 words", () => {
    const html = `
      <html><body><main>
        <p>Short.</p>
        <p>Tiny note here.</p>
        <p>This paragraph is long enough to pass the word-count floor for body sample capture.</p>
      </main></body></html>
    `;
    const snap = extract(html);
    expect(snap.body_paragraph_sample?.length).toBe(1);
    expect(snap.body_paragraph_sample?.[0]).toContain("body sample capture");
  });

  it("caps at 20 entries x 300 chars each (N19 raised the excerpt budget)", () => {
    const longP = "x ".repeat(200); // 400 chars
    const ps = Array.from({ length: 25 }, (_, i) => `<p>Paragraph number ${i} with enough words to pass the floor ${longP}</p>`).join("");
    const snap = extract(`<html><body><main>${ps}</main></body></html>`);
    expect(snap.body_paragraph_sample?.length).toBe(20);
    for (const p of snap.body_paragraph_sample ?? []) {
      expect(p.length).toBeLessThanOrEqual(300);
    }
  });
});

describe("extractor — card_texts", () => {
  it("captures <li> elements inside content area", () => {
    const html = `
      <html><body><main>
        <ul>
          <li>Custom Home Builder in Palo Alto</li>
          <li>Whole-Home Remodel Services</li>
          <li>Luxury Bay Area Construction</li>
        </ul>
      </main></body></html>
    `;
    const snap = extract(html);
    expect(snap.card_texts?.length).toBeGreaterThanOrEqual(3);
    expect(snap.card_texts?.some((t) => t.includes("Custom Home Builder"))).toBe(true);
  });

  it("captures elements with card/tile/neighborhood class names", () => {
    const html = `
      <html><body><main>
        <div class="neighborhood-card">Old Palo Alto — classic streets and period homes built since 1900.</div>
        <div class="service-tile">Luxury Custom Home Builder — design-build excellence in the bay area.</div>
      </main></body></html>
    `;
    const snap = extract(html);
    expect(snap.card_texts?.length).toBeGreaterThanOrEqual(2);
    expect(snap.card_texts?.some((t) => t.includes("Old Palo Alto"))).toBe(true);
    expect(snap.card_texts?.some((t) => t.includes("Luxury Custom Home Builder"))).toBe(true);
  });

  it("excludes cards inside <nav>", () => {
    const html = `
      <html><body>
        <nav>
          <ul>
            <li>Navigation menu item about services</li>
          </ul>
        </nav>
        <main>
          <ul><li>Content area card about custom homes in the bay area.</li></ul>
        </main>
      </body></html>
    `;
    const snap = extract(html);
    expect(
      snap.card_texts?.some((t) => t.includes("Navigation menu")),
    ).toBe(false);
    expect(
      snap.card_texts?.some((t) => t.includes("custom homes")),
    ).toBe(true);
  });

  it("drops cards shorter than 8 chars", () => {
    const html = `
      <html><body><main>
        <ul>
          <li>x</li>
          <li>Short</li>
          <li>Custom Home Builder Palo Alto</li>
        </ul>
      </main></body></html>
    `;
    const snap = extract(html);
    expect(snap.card_texts?.some((t) => t === "x")).toBe(false);
    expect(snap.card_texts?.some((t) => t.includes("Custom Home Builder"))).toBe(true);
  });
});

describe("extractor — schema_entity_names", () => {
  it("captures Service.name", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          { "@type": "Service", "name": "Whole-Home Remodel" }
        </script>
      </head><body><main><p>Real content about design-build firms in the bay area peninsula.</p></main></body></html>
    `;
    const snap = extract(html);
    expect(snap.schema_entity_names).toContain("Whole-Home Remodel");
  });

  it("captures Offer.name from nested @graph", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@graph": [
              { "@type": "Offer", "name": "Major Structural Renovation Package" }
            ]
          }
        </script>
      </head><body><main><p>Real content to ensure extraction certainty confirmed.</p></main></body></html>
    `;
    const snap = extract(html);
    expect(snap.schema_entity_names).toContain("Major Structural Renovation Package");
  });

  it("captures BreadcrumbList item names", () => {
    const html = `
      <html><head>
        <script type="application/ld+json">
          {
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Locations" },
              { "@type": "ListItem", "position": 2, "name": "Palo Alto" }
            ]
          }
        </script>
      </head><body><main><p>Real page content with enough words for body sample capture.</p></main></body></html>
    `;
    const snap = extract(html);
    expect(snap.schema_entity_names).toContain("Locations");
    expect(snap.schema_entity_names).toContain("Palo Alto");
  });

  it("is undefined when no named-entity types exist", () => {
    const html = `
      <html><body><main><p>No structured data here, just some content text for body sample floor.</p></main></body></html>
    `;
    const snap = extract(html);
    expect(snap.schema_entity_names).toBeUndefined();
  });
});

describe("extractor — nav_labels NOT captured (coverage-safety)", () => {
  it("does not expose a nav_labels field on the snapshot", () => {
    const html = `
      <html><body>
        <nav><a href="/a">Custom Homes</a><a href="/b">Renovations</a></nav>
        <main><p>This is real content that should not be nav-polluted for coverage.</p></main>
      </body></html>
    `;
    const snap = extract(html);
    expect((snap as Record<string, unknown>).nav_labels).toBeUndefined();
  });
});
