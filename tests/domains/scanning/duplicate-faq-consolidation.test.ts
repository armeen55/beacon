/**
 * End-to-end test: Duplicate FAQ consolidation flow.
 *
 * Scenario: Dev removes identical duplicate FAQPage JSON-LD blocks,
 * keeping one consolidated block. Verifies the full pipeline detects
 * the change and produces the right findings for changelog.
 *
 * Flow: extractor → diff → guardrails → findings engine
 */

import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import { classifyGuardrails } from "@/domains/pages/guardrails";
import { generateFindings } from "@/domains/scanning/detect-findings";

// ── Test HTML: before (2 identical FAQPage blocks) and after (1 block) ──

const THREE_QUESTIONS = [
  { q: "Who are the best custom home builders in the Bay Area?", a: "Firms with strong design-build coordination and local experience." },
  { q: "How much does a custom home cost?", a: "Typically $600 to $1,200 per square foot in the Bay Area." },
  { q: "How long does a custom home build take?", a: "Most custom homes take 14 to 24 months from design to completion." },
];

function makeFaqPageJsonLd(questions: { q: string; a: string }[]): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  });
}

const BODY_CONTENT = `<body>
  <h1>Custom Home Builders Bay Area</h1>
  <p>${"We build premium custom homes in the Bay Area with decades of experience. ".repeat(10)}</p>
</body>`;

/** Before: two identical FAQPage JSON-LD blocks (the duplicate state) */
const HTML_BEFORE = `<html><head>
  <title>Custom Home Builders Bay Area | Ritz Builders</title>
  <meta name="description" content="Premier custom home builders in the Bay Area.">
  <link rel="canonical" href="https://ritzbuilders.com/custom-homes">
  <script type="application/ld+json">${makeFaqPageJsonLd(THREE_QUESTIONS)}</script>
  <script type="application/ld+json">${makeFaqPageJsonLd(THREE_QUESTIONS)}</script>
</head>${BODY_CONTENT}</html>`;

/** After: one consolidated FAQPage JSON-LD block (duplicates removed) */
const HTML_AFTER = `<html><head>
  <title>Custom Home Builders Bay Area | Ritz Builders</title>
  <meta name="description" content="Premier custom home builders in the Bay Area.">
  <link rel="canonical" href="https://ritzbuilders.com/custom-homes">
  <script type="application/ld+json">${makeFaqPageJsonLd(THREE_QUESTIONS)}</script>
</head>${BODY_CONTENT}</html>`;

const PAGE_URL = "https://ritzbuilders.com/custom-homes";
const PAGE_ID = "pg-custom-homes";

describe("Duplicate FAQ consolidation – full detection flow", () => {
  // ── Step 1: Extractor correctly counts duplicates ──

  it("extractor: before state has 6 FAQs (3 questions × 2 duplicate blocks)", () => {
    const snap = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    expect(snap.faqs).toHaveLength(6);
    expect(snap.faq_schema_block_count).toBe(2);
    expect(snap.structural_warnings).toBeDefined();
    expect(snap.structural_warnings!.some((w) => w.includes("duplicate_faq_schema"))).toBe(true);
  });

  it("extractor: after state has 3 FAQs (3 questions × 1 block)", () => {
    const snap = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    expect(snap.faqs).toHaveLength(3);
    expect(snap.faq_schema_block_count).toBe(1);
    expect(snap.structural_warnings).toBeUndefined();
  });

  it("extractor: title, H1, word count, content unchanged between before/after", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    expect(after.title).toBe(before.title);
    expect(after.h1).toBe(before.h1);
    expect(after.word_count).toBe(before.word_count);
    expect(after.content_hash).toBe(before.content_hash);
  });

  // ── Step 2: Diff engine detects FAQ count change ──

  it("diff: detects faq_count_changed (6 → 3)", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const diff = diffSnapshots(after, before);

    expect(diff.changed).toBe(true);
    expect(diff.faq_count_changed).toBe(true);
    expect(diff.title_changed).toBe(false);
    expect(diff.h1_changed).toBe(false);
    expect(diff.content_changed).toBe(false);
    expect(diff.summary).toContain("-3 FAQs");
  });

  // ── Step 3: Guardrails fire before, clear after ──

  it("guardrails: before state triggers duplicate_faq_schema warning", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const alerts = classifyGuardrails(before, null, 50);
    const dupAlert = alerts.find((a) => a.category === "duplicate_faq_schema");
    expect(dupAlert).toBeDefined();
    expect(dupAlert!.severity).toBe("warning");
    expect(dupAlert!.message).toContain("2 duplicate FAQPage");
  });

  it("guardrails: after state has NO duplicate_faq_schema warning", () => {
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const alerts = classifyGuardrails(after, null, 50);
    const dupAlert = alerts.find((a) => a.category === "duplicate_faq_schema");
    expect(dupAlert).toBeUndefined();
  });

  // ── Step 4: Findings engine generates correct findings for changelog ──

  it("findings: generates faq_changed finding (6 → 3 Q&A blocks)", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const prevGuardrails = classifyGuardrails(before, null, 50);
    const currGuardrails = classifyGuardrails(after, diffSnapshots(after, before), 50);

    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: currGuardrails,
      previousGuardrails: prevGuardrails,
      changelog: [],
      scanRunId: "test-run-1",
    });

    const faqFinding = findings.find((f) => f.type === "faq_changed");
    expect(faqFinding).toBeDefined();
    expect(faqFinding!.previousState).toBe("6 Q&A blocks");
    expect(faqFinding!.currentState).toBe("3 Q&A blocks");
    expect(faqFinding!.summary).toContain("Q&A count changed");
    expect(faqFinding!.status).toBe("pending");
  });

  it("findings: generates guardrail_cleared for duplicate_faq_schema (auto-accepted)", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const prevGuardrails = classifyGuardrails(before, null, 50);
    const currGuardrails = classifyGuardrails(after, diffSnapshots(after, before), 50);

    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: currGuardrails,
      previousGuardrails: prevGuardrails,
      changelog: [],
      scanRunId: "test-run-1",
    });

    const clearedFinding = findings.find(
      (f) => f.type === "guardrail_cleared" && f.previousState?.includes("duplicate FAQPage")
    );
    expect(clearedFinding).toBeDefined();
    expect(clearedFinding!.summary).toContain("Issue resolved");
    expect(clearedFinding!.summary).toContain("duplicate_faq_schema");
    // Auto-accepted — not pending
    expect(clearedFinding!.status).toBe("accepted");
    expect(clearedFinding!.resolvedAt).toBeDefined();
  });

  it("findings: faq_changed is pending, guardrail_cleared is auto-accepted", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const prevGuardrails = classifyGuardrails(before, null, 50);
    const currGuardrails = classifyGuardrails(after, diffSnapshots(after, before), 50);

    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: currGuardrails,
      previousGuardrails: prevGuardrails,
      changelog: [],
      scanRunId: "test-run-1",
    });

    const faqFinding = findings.find((f) => f.type === "faq_changed");
    const clearedFinding = findings.find(
      (f) => f.type === "guardrail_cleared" && f.summary.includes("duplicate_faq_schema")
    );
    expect(faqFinding).toBeDefined();
    expect(clearedFinding).toBeDefined();
    expect(faqFinding!.status).toBe("pending");
    expect(clearedFinding!.status).toBe("accepted");
  });

  it("findings: no false positives — title/h1/content/schema_changed do NOT fire", () => {
    const before = extractPageSnapshot(HTML_BEFORE, PAGE_URL, PAGE_ID);
    const after = extractPageSnapshot(HTML_AFTER, PAGE_URL, PAGE_ID);
    const prevGuardrails = classifyGuardrails(before, null, 50);
    const currGuardrails = classifyGuardrails(after, diffSnapshots(after, before), 50);

    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: currGuardrails,
      previousGuardrails: prevGuardrails,
      changelog: [],
      scanRunId: "test-run-1",
    });

    expect(findings.find((f) => f.type === "title_changed")).toBeUndefined();
    expect(findings.find((f) => f.type === "h1_changed")).toBeUndefined();
    expect(findings.find((f) => f.type === "content_changed")).toBeUndefined();
    expect(findings.find((f) => f.type === "schema_changed")).toBeUndefined();
  });
});
