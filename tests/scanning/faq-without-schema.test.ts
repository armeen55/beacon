/**
 * Phase A — FAQ without schema detection tests.
 *
 * Tests that generateFindings() detects pages with visible FAQ content
 * but no matching FAQPage JSON-LD schema.
 */

import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import { generateFindings } from "@/domains/scanning/detect-findings";
import type { Finding } from "@/domains/scanning/types";

const URL_A = "https://example.com/locations/atherton";
const URL_B = "https://example.com/services/kitchen";
const PAGE_ID_A = "pg-a";
const PAGE_ID_B = "pg-b";
const SCAN_RUN = "test-scan-faq";

function htmlWithFaqNoSchema(faqCount: number): string {
  const faqHtml = Array.from({ length: faqCount }, (_, i) =>
    `<h3>Question ${i + 1}?</h3><p>Answer ${i + 1}.</p>`,
  ).join("\n");
  return `<html><head>
    <title>Test Page</title>
    <meta name="description" content="A test page">
    <link rel="canonical" href="${URL_A}">
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding for word count. ".repeat(20)}</p>
    <h2>FAQ</h2>
    ${faqHtml}
  </body></html>`;
}

function htmlWithFaqAndSchema(faqCount: number): string {
  const faqHtml = Array.from({ length: faqCount }, (_, i) =>
    `<h3>Question ${i + 1}?</h3><p>Answer ${i + 1}.</p>`,
  ).join("\n");
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: Array.from({ length: faqCount }, (_, i) => ({
      "@type": "Question",
      name: `Question ${i + 1}?`,
      acceptedAnswer: { "@type": "Answer", text: `Answer ${i + 1}.` },
    })),
  });
  return `<html><head>
    <title>Test Page</title>
    <meta name="description" content="A test page">
    <link rel="canonical" href="${URL_B}">
    <script type="application/ld+json">${schema}</script>
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding for word count. ".repeat(20)}</p>
    <h2>FAQ</h2>
    ${faqHtml}
  </body></html>`;
}

function htmlNoFaq(): string {
  return `<html><head>
    <title>Test Page</title>
    <meta name="description" content="A test page">
    <link rel="canonical" href="${URL_A}">
  </head><body>
    <h1>Test Page</h1>
    <p>${"Content padding for word count. ".repeat(20)}</p>
  </body></html>`;
}

function snap(h: string, url: string, pageId: string) {
  return extractPageSnapshot(h, url, pageId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("faq_without_schema detection", () => {
  it("detects page with visible FAQ but no FAQPage schema", () => {
    const current = snap(htmlWithFaqNoSchema(6), URL_A, PAGE_ID_A);

    const findings = generateFindings({
      currentSnapshots: [current],
      previousSnapshots: [current], // same — no changes, just static check
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const faqFindings = findings.filter((f) => f.type === "faq_without_schema");
    expect(faqFindings.length).toBe(1);
    expect(faqFindings[0].summary).toContain("FAQ questions visible but no FAQPage schema");
    // Without citations, severity = "medium" (not "high") — citation-gated
    expect(faqFindings[0].severity).toBe("medium");
    // Score: 20 (medium severity) + 15 (high-impact type) = 35 → "important"
    expect(faqFindings[0].priority).toBe("important");
  });

  it("does NOT flag page with FAQ + matching FAQPage schema", () => {
    const current = snap(htmlWithFaqAndSchema(6), URL_B, PAGE_ID_B);

    const findings = generateFindings({
      currentSnapshots: [current],
      previousSnapshots: [current],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const faqFindings = findings.filter((f) => f.type === "faq_without_schema");
    expect(faqFindings.length).toBe(0);
  });

  it("does NOT flag page with no FAQ content at all", () => {
    const current = snap(htmlNoFaq(), URL_A, PAGE_ID_A);

    const findings = generateFindings({
      currentSnapshots: [current],
      previousSnapshots: [current],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const faqFindings = findings.filter((f) => f.type === "faq_without_schema");
    expect(faqFindings.length).toBe(0);
  });

  it("includes citation count in finding when provided", () => {
    const current = snap(htmlWithFaqNoSchema(4), URL_A, PAGE_ID_A);
    // citationsByUrl uses normalized paths (protocol+domain stripped)
    const normPath = URL_A.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "").toLowerCase();
    const citMap = new Map([[normPath, 250]]);

    const findings = generateFindings({
      currentSnapshots: [current],
      previousSnapshots: [current],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
      citationsByUrl: citMap,
    });

    const faqFindings = findings.filter((f) => f.type === "faq_without_schema");
    expect(faqFindings.length).toBe(1);
    expect(faqFindings[0].citationCount).toBe(250);
    // With 250 citations + high severity + high impact type = very high priority score
    expect(faqFindings[0].priority).toBe("critical");
  });

  it("reports correct FAQ count in summary", () => {
    const current = snap(htmlWithFaqNoSchema(8), URL_A, PAGE_ID_A);

    const findings = generateFindings({
      currentSnapshots: [current],
      previousSnapshots: [current],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const faqFindings = findings.filter((f) => f.type === "faq_without_schema");
    expect(faqFindings[0].summary).toContain("8 FAQ questions");
    expect(faqFindings[0].suggestedAction).toContain("8 visible FAQ questions");
  });
});
