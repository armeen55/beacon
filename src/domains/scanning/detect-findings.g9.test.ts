/**
 * G9 regression tests — new finding types emitted by generateFindings:
 *   - schema_invalid  (from PageSnapshot.schema_validation_warnings — G8)
 *   - robots_txt_blocked  (from parsed RobotsFile — G6)
 *
 * We intentionally scope these tests narrowly to the G9 wiring; the legacy
 * finding branches (title_changed, faq_without_schema, etc.) have their own
 * integration coverage via end-to-end scan runs.
 */

import { describe, it, expect } from "vitest";
import { generateFindings } from "./detect-findings";
import type { PageSnapshot } from "@/domains/pages/types";
import { parseRobotsText } from "@/domains/pages/robots-parser";

function snapshot(overrides: Partial<PageSnapshot>): PageSnapshot {
  const url = overrides.url ?? "https://example.com/services/foo";
  return {
    id: "ps-t",
    page_id: "p-t",
    url,
    canonical_url: null,
    fetched_at: "2026-04-16T00:00:00Z",
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
    content_hash: "",
    headings_hash: "",
    faq_hash: "",
    schema_hash: "",
    tenant_id: "",
    ...overrides,
  };
}

describe("generateFindings — schema_invalid (G8/G9)", () => {
  it("emits schema_invalid when PageSnapshot has schema_validation_warnings", () => {
    const curr = snapshot({
      schema_validation_warnings: [
        "schema_critical:FAQPage: 2 of 5 questions missing acceptedAnswer.text — rich results won't fire for these.",
      ],
    });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/services/foo", 50]]),
    });
    const schemaF = findings.filter((f) => f.type === "schema_invalid");
    expect(schemaF).toHaveLength(1);
    expect(schemaF[0].severity).toBe("high");
    expect(schemaF[0].summary).toContain("FAQPage");
  });

  it("does not emit when snapshot has no schema_validation_warnings", () => {
    const curr = snapshot({});
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
    });
    expect(findings.filter((f) => f.type === "schema_invalid")).toHaveLength(0);
  });

  it("lower severity when page has no citations (not homepage)", () => {
    const curr = snapshot({
      schema_validation_warnings: [
        "schema_warning:Article: Article missing author — E-E-A-T signal lost.",
      ],
    });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/services/foo", 0]]),
    });
    const schemaF = findings.filter((f) => f.type === "schema_invalid");
    expect(schemaF).toHaveLength(1);
    expect(schemaF[0].severity).toBe("medium");
  });
});

describe("generateFindings — robots_txt_blocked (G6/G9)", () => {
  it("emits robots_txt_blocked when GPTBot is disallowed on a cited URL", () => {
    const curr = snapshot({ url: "https://example.com/locations/palo-alto" });
    const robots = parseRobotsText(
      `User-agent: *\nDisallow:\n\nUser-agent: GPTBot\nDisallow: /`,
      "https://example.com/robots.txt",
      200,
    );
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/locations/palo-alto", 25]]),
      robots,
    });
    const blocked = findings.filter((f) => f.type === "robots_txt_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe("high");
    expect(blocked[0].currentState).toMatch(/GPTBot/);
  });

  it("does NOT emit when robots.txt is permissive", () => {
    const curr = snapshot({ url: "https://example.com/locations/palo-alto" });
    const robots = parseRobotsText(
      `User-agent: *\nDisallow:`,
      "https://example.com/robots.txt",
      200,
    );
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/locations/palo-alto", 25]]),
      robots,
    });
    expect(findings.filter((f) => f.type === "robots_txt_blocked")).toHaveLength(0);
  });

  it("skips non-cited, non-homepage pages even when blocked", () => {
    const curr = snapshot({ url: "https://example.com/internal/draft" });
    const robots = parseRobotsText(
      `User-agent: GPTBot\nDisallow: /`,
      "https://example.com/robots.txt",
      200,
    );
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/internal/draft", 0]]), // not cited
      robots,
    });
    // We don't emit blocks on non-cited, non-homepage URLs (noise reduction).
    expect(findings.filter((f) => f.type === "robots_txt_blocked")).toHaveLength(0);
  });

  it("emits when robots is null/undefined does not throw", () => {
    const curr = snapshot({ url: "https://example.com/x" });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [curr],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/x", 10]]),
      // robots intentionally omitted
    });
    expect(findings.filter((f) => f.type === "robots_txt_blocked")).toHaveLength(0);
  });

  it("emits when robots.status is 404 (no rules = no blocks)", () => {
    const robots = parseRobotsText("", "https://example.com/robots.txt", 404);
    const findings = generateFindings({
      currentSnapshots: [snapshot({ url: "https://example.com/x" })],
      previousSnapshots: [snapshot({ url: "https://example.com/x" })],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "r1",
      citationsByUrl: new Map([["/x", 10]]),
      robots,
    });
    expect(findings.filter((f) => f.type === "robots_txt_blocked")).toHaveLength(0);
  });
});
