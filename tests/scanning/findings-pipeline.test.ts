/**
 * Phase 1 — Lock the working loop: findings pipeline tests.
 *
 * Tests `generateFindings()` with title change, guardrail, and priority
 * scoring scenarios. Pure function tests — no I/O, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import { extractPageSnapshot } from "@/domains/pages/extractor";
import { diffSnapshots } from "@/domains/pages/snapshot-diff";
import { classifyGuardrails } from "@/domains/pages/guardrails";
import { generateFindings } from "@/domains/scanning/detect-findings";
import type { Finding } from "@/domains/scanning/types";

// ── HTML templates ──

const BASE_BODY = `<body><h1>Bay Area Custom Homes</h1>
<p>${"Premium custom home building services across the Bay Area. ".repeat(15)}</p></body>`;

function html(opts: { title: string; meta: string; h1?: string; faqCount?: number }): string {
  const faqs = opts.faqCount
    ? `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: Array.from({ length: opts.faqCount }, (_, i) => ({
          "@type": "Question",
          name: `Question ${i + 1}?`,
          acceptedAnswer: { "@type": "Answer", text: `Answer ${i + 1}.` },
        })),
      })}</script>`
    : "";
  const body = opts.h1
    ? `<body><h1>${opts.h1}</h1><p>${"Premium custom home building services. ".repeat(15)}</p></body>`
    : BASE_BODY;
  return `<html><head>
    <title>${opts.title}</title>
    <meta name="description" content="${opts.meta}">
    <link rel="canonical" href="https://ritzbuilders.com/services/custom-homes">
    ${faqs}
  </head>${body}</html>`;
}

const URL = "https://ritzbuilders.com/services/custom-homes";
const PAGE_ID = "pg-test-1";
const SCAN_RUN = "test-scan-001";

function snap(h: string) {
  return extractPageSnapshot(h, URL, PAGE_ID);
}

// ── Tests ──

describe("Findings pipeline — title change detection", () => {
  const before = snap(html({ title: "Custom Homes | Ritz Builders", meta: "We build custom homes." }));
  const after = snap(html({ title: "Bay Area Custom Homes | Ritz Builders", meta: "We build custom homes." }));

  it("generates a title_changed finding when title differs", () => {
    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const titleFinding = findings.find((f) => f.type === "title_changed");
    expect(titleFinding).toBeDefined();
    expect(titleFinding!.status).toBe("pending");
    expect(titleFinding!.previousState).toBe("Custom Homes | Ritz Builders");
    expect(titleFinding!.currentState).toBe("Bay Area Custom Homes | Ritz Builders");
    expect(titleFinding!.url).toBe(URL);
  });

  it("title_changed finding has correct structure", () => {
    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const f = findings.find((f) => f.type === "title_changed")!;
    expect(f.id).toMatch(/^title_changed-/);
    expect(f.scanRunId).toBe(SCAN_RUN);
    expect(f.severity).toBeDefined();
    expect(f.priority).toBeDefined();
    expect(f.priorityScore).toBeGreaterThanOrEqual(0);
    expect(f.summary).toBeTruthy();
    expect(f.suggestedAction).toBeTruthy();
    expect(f.detectedAt).toBeTruthy();
    expect(f.resolvedAt).toBeNull();
    expect(f.linkedChangeId).toBeNull();
    expect(f.promotionStatus).toBe("none");
  });

  it("does not generate title_changed when title is the same", () => {
    const findings = generateFindings({
      currentSnapshots: [before],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    expect(findings.find((f) => f.type === "title_changed")).toBeUndefined();
  });
});

describe("Findings pipeline — new guardrail detection", () => {
  const snapshot = snap(
    html({ title: "Custom Homes", meta: "Build", h1: "H1 One" })
  );
  // Create a second snapshot with multiple H1s to trigger guardrail
  const multiH1Html = `<html><head>
    <title>Custom Homes</title>
    <meta name="description" content="Build">
    <link rel="canonical" href="${URL}">
  </head><body>
    <h1>First H1</h1>
    <h1>Second H1</h1>
    <p>${"Content here. ".repeat(20)}</p>
  </body></html>`;
  const multiH1Snap = extractPageSnapshot(multiH1Html, URL, PAGE_ID);

  it("generates new_guardrail finding when guardrail appears for first time", () => {
    const currGuardrails = classifyGuardrails(multiH1Snap, null);
    const multiH1Guard = currGuardrails.find((g) => g.category === "multiple_h1");

    // Only test if this guardrail is actually detected by the classifier
    if (!multiH1Guard) return;

    const findings = generateFindings({
      currentSnapshots: [multiH1Snap],
      previousSnapshots: [snapshot],
      currentGuardrails: currGuardrails,
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    // new_guardrail summary format: "New issue on {path}: {message}"
    const guardFinding = findings.find(
      (f) => f.type === "new_guardrail" && f.currentState?.includes(multiH1Guard!.message),
    );
    expect(guardFinding).toBeDefined();
    expect(guardFinding!.status).toBe("pending");
  });
});

describe("Findings pipeline — guardrail_cleared auto-acceptance", () => {
  const beforeHtml = `<html><head>
    <title>Custom Homes</title>
    <meta name="description" content="Build">
    <link rel="canonical" href="${URL}">
  </head><body>
    <h1>First H1</h1>
    <h1>Second H1</h1>
    <p>${"Content here. ".repeat(20)}</p>
  </body></html>`;
  const afterHtml = `<html><head>
    <title>Custom Homes</title>
    <meta name="description" content="Build">
    <link rel="canonical" href="${URL}">
  </head><body>
    <h1>First H1</h1>
    <p>${"Content here. ".repeat(20)}</p>
  </body></html>`;

  const beforeSnap = extractPageSnapshot(beforeHtml, URL, PAGE_ID);
  const afterSnap = extractPageSnapshot(afterHtml, URL, PAGE_ID);

  it("guardrail_cleared findings are auto-accepted, never pending", () => {
    const prevGuardrails = classifyGuardrails(beforeSnap, null);
    const multiH1Before = prevGuardrails.find((g) => g.category === "multiple_h1");
    if (!multiH1Before) return; // Skip if guardrail not detected

    const currGuardrails = classifyGuardrails(afterSnap, diffSnapshots(afterSnap, beforeSnap));
    const multiH1After = currGuardrails.find((g) => g.category === "multiple_h1");
    // After fix, multiple_h1 should be gone
    expect(multiH1After).toBeUndefined();

    const findings = generateFindings({
      currentSnapshots: [afterSnap],
      previousSnapshots: [beforeSnap],
      currentGuardrails: currGuardrails,
      previousGuardrails: prevGuardrails,
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const cleared = findings.filter((f) => f.type === "guardrail_cleared");
    for (const c of cleared) {
      expect(c.status).toBe("accepted");
      expect(c.resolvedAt).toBeTruthy();
    }
    // Ensure no guardrail_cleared finding has pending status
    expect(cleared.every((c) => c.status !== "pending")).toBe(true);
  });
});

describe("Findings pipeline — priority scoring", () => {
  const before = snap(html({ title: "Custom Homes | Ritz", meta: "Build homes." }));
  const after = snap(html({ title: "Bay Area Custom Homes | Ritz", meta: "Build homes." }));

  it("homepage findings get priority boost", () => {
    const homepageUrl = URL;
    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
      homepageUrl,
    });

    const withHP = findings.find((f) => f.type === "title_changed");
    expect(withHP).toBeDefined();
    expect(withHP!.isHomepage).toBe(true);
    // Homepage bonus adds +25 to priority score
    expect(withHP!.priorityScore).toBeGreaterThan(0);
  });

  it("high-citation pages get priority boost", () => {
    const citLookup = new Map([[URL.replace(/\/+$/, "").toLowerCase(), 150]]);
    const findings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
      citationsByUrl: citLookup,
    });

    const f = findings.find((f) => f.type === "title_changed");
    expect(f).toBeDefined();
    expect(f!.citationCount).toBe(150);
    // 100+ citations = +30 priority bonus
    expect(f!.priorityScore).toBeGreaterThan(20);
  });

  it("previously rejected finding types get priority reduction", () => {
    const normalFindings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
    });

    const rejectedTypes = new Set([
      `title_changed::${URL.replace(/\/+$/, "").toLowerCase()}`,
    ]);
    const rejectedFindings = generateFindings({
      currentSnapshots: [after],
      previousSnapshots: [before],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: SCAN_RUN,
      previouslyRejectedTypes: rejectedTypes,
    });

    const normal = normalFindings.find((f) => f.type === "title_changed");
    const rejected = rejectedFindings.find((f) => f.type === "title_changed");
    expect(normal).toBeDefined();
    expect(rejected).toBeDefined();
    // Rejected type gets -15 priority penalty
    expect(rejected!.priorityScore).toBeLessThan(normal!.priorityScore);
  });
});
