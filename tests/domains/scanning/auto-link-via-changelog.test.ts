/**
 * Phase Auto-Link v2 (2026-04-24) — match-through-changelog contract.
 *
 * Replaces the Apr-21 "stamp from recommendation_responses" path. The
 * new path reads from recommendation-sourced changelog entries
 * (hypothesis_source === "recommendation") and respects strict
 * guardrails before stamping.
 *
 * These tests pin the contract operator specified:
 *   - happy path: content finding on URL where a rec-sourced content
 *     changelog was stamped earlier → source_rec_id + source_pattern_id
 *     + linkedChangeId stamped on finding
 *   - URL mismatch → no link
 *   - finding detected_at earlier than changelog timestamp → no link
 *     (edit can't post-date its observation)
 *   - changelog older than 14 days → no link
 *   - schema finding vs content recommendation changelog → no link
 *     (signal-type mismatch)
 *   - needs_review / split / watch actions produce no changelog entry,
 *     so they're naturally absent from the match set
 *   - multiple eligible entries → newest wins
 *   - finding status remains "pending" — never auto-accepted; legacy
 *     Path 1 stays retired
 *
 * The new path is gated on BEACON_AUTO_LINK_FINDINGS=1. These tests
 * stub the flag ON to exercise the code path. Real hosted state
 * remains OFF until operator approves.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { PageSnapshot } from "@/domains/pages/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

// Stub the flag ON so the gate allows the auto-link pass to execute.
vi.mock("@/lib/flags", () => ({
  isFindingAutoLinkEnabled: () => true,
  isSchemaAutoPromoteEnabled: () => false,
  isEventTruthPreviewEnabled: () => false,
}));

// recommendationResponses is no longer consulted by the new path. Keep
// the module loadable for unrelated imports.
vi.mock("@/domains/product/recommendation-response-store", () => ({
  recommendationResponses: [],
}));

import { generateFindings } from "@/domains/scanning/detect-findings";

// ── Fixtures ──────────────────────────────────────────────────────────

function snap(
  url: string,
  overrides: Partial<PageSnapshot> = {},
): PageSnapshot {
  return {
    id: `snap-${url}-${overrides.fetched_at ?? ""}`,
    page_id: `p-${url}`,
    url,
    canonical_url: null,
    fetched_at: "2026-04-22T00:00:00Z",
    http_status: 200,
    title: "T",
    meta_description: null,
    h1: "H1",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    word_count: 100,
    robots_meta: null,
    has_canonical_mismatch: false,
    content_hash: "c",
    headings_hash: "h",
    faq_hash: "f",
    schema_hash: "s",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    tenant_id: "",
    ...overrides,
  };
}

function changelog(
  overrides: Partial<ChangelogEntry> & { id: string },
): ChangelogEntry {
  return {
    timestamp: "2026-04-20T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://site.example/locations/palo-alto",
    asset_name: "/locations/palo-alto",
    change_description: "Strengthen /locations/palo-alto for Palo Alto prompts",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: "7-14 days",
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    tenant_id: "",
    hypothesis_source: "recommendation",
    source_rec_id: "rec-strengthen-palo-alto",
    source_pattern_id: "pat-p1",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("Phase Auto-Link v2 — match-through-changelog", () => {
  beforeEach(() => {
    // Use real timers so the stamp pass's `new Date()` reflects the
    // fixture windows. If a test needs to control "now", it mocks the
    // date explicitly.
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("happy path: h2_changed finding on URL where a Strengthen rec-sourced changelog was stamped earlier → stamped", () => {
    const prev = snap("https://site.example/locations/palo-alto", {
      h2_list: ["Old Heading"],
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      h2_list: ["New Heading"],
      fetched_at: "2026-04-22T12:00:00Z",
    });
    const rec = changelog({ id: "cl-rec-1" });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f).toBeDefined();
    expect(f?.source_rec_id).toBe("rec-strengthen-palo-alto");
    expect(f?.source_pattern_id).toBe("pat-p1");
    expect(f?.linkedChangeId).toBe("cl-rec-1");
    // Finding stays pending — legacy Path 1 auto-accept retired.
    expect(f?.status).toBe("pending");
  });

  it("URL mismatch: no link", () => {
    const prev = snap("https://site.example/foo", { h2_list: ["A"] });
    const curr = snap("https://site.example/foo", { h2_list: ["B"] });
    const rec = changelog({
      id: "cl-elsewhere",
      url: "https://site.example/bar",
      asset_name: "/bar",
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
    expect(f?.linkedChangeId).toBeFalsy();
  });

  it("finding detectedAt earlier than changelog timestamp: no link", () => {
    // Scenario: a changelog entry was stamped "in the future" relative
    // to the finding's detectedAt. The edit can't post-date its
    // observation — skip.
    //
    // Note: Finding.detectedAt defaults to `new Date().toISOString()`
    // inside detect-findings. The test forces a changelog dated
    // tomorrow so the "earlier" guardrail has to fire.
    const prev = snap("https://site.example/locations/palo-alto", {
      h2_list: ["A"],
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      h2_list: ["B"],
    });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const rec = changelog({ id: "cl-future", timestamp: future });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("changelog older than 14 days: no link", () => {
    const prev = snap("https://site.example/locations/palo-alto", {
      h2_list: ["A"],
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      h2_list: ["B"],
    });
    const stale = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const rec = changelog({ id: "cl-stale", timestamp: stale });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("schema_changed finding vs content-signal rec changelog: no link (signal-type mismatch)", () => {
    // A Strengthen/Expand changelog (signal_type="content") should NOT
    // claim a schema_changed finding, even on the same URL in the
    // 14-day window.
    const prev = snap("https://site.example/locations/palo-alto", {
      schema_types: ["Organization"],
      schema_hash: "hash-a",
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      schema_types: ["Organization", "FAQPage"],
      schema_hash: "hash-b",
    });
    const rec = changelog({
      id: "cl-content",
      signal_type: "content",
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "schema_changed");
    expect(f).toBeDefined();
    expect(f?.source_rec_id).toBeUndefined();
    expect(f?.linkedChangeId).toBeFalsy();
  });

  it("needs_review / split / watch produce no changelog entry → naturally absent from match set", () => {
    // needs_review, split_or_separate_page, and watch don't call
    // createChangelogEntry (Phase 5 shouldStampChangelog). This test
    // simulates that reality: an empty changelog. A finding on the
    // same URL as a needs_review/split/watch rec has nothing to link to.
    const prev = snap("https://site.example/services/teardown-rebuild", {
      h2_list: ["A"],
    });
    const curr = snap("https://site.example/services/teardown-rebuild", {
      h2_list: ["B"],
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [], // deliberately empty — no rec-sourced changelog
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("multiple eligible changelogs on same URL: newest wins", () => {
    const prev = snap("https://site.example/locations/palo-alto", {
      h2_list: ["A"],
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      h2_list: ["B"],
    });

    const old = changelog({
      id: "cl-old",
      source_rec_id: "rec-older",
      source_pattern_id: "pat-old",
      timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const newer = changelog({
      id: "cl-newer",
      source_rec_id: "rec-newer",
      source_pattern_id: "pat-new",
      timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [old, newer],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBe("rec-newer");
    expect(f?.source_pattern_id).toBe("pat-new");
    expect(f?.linkedChangeId).toBe("cl-newer");
  });

  it("legacy Path 1 retired: flag ON + URL-matching older changelog → finding stays pending, NOT auto-accepted to an unrelated old changelog", () => {
    // Before Phase Auto-Link v2, Path 1 would flip status to
    // "accepted" and point linkedChangeId at any 30-day-old changelog
    // whose signal_type or description keyword matched. That's the
    // Dogfeed Night 1 failure mode. This test proves it's gone.
    const prev = snap("https://site.example/locations/palo-alto", {
      h2_list: ["A"],
    });
    const curr = snap("https://site.example/locations/palo-alto", {
      h2_list: ["B"],
    });
    // A stale (20-day-old) operator-sourced changelog — NOT rec-sourced.
    // Old Path 1 would keyword-match "h1"/"heading" in the description
    // and auto-accept. New path ignores anything without
    // hypothesis_source === "recommendation".
    const stale = changelog({
      id: "cl-operator-stale",
      hypothesis_source: "operator",
      source_rec_id: undefined,
      source_pattern_id: undefined,
      change_description: "Manual h1 / heading rewrite",
      timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [stale],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.status).toBe("pending");
    expect(f?.source_rec_id).toBeUndefined();
    expect(f?.linkedChangeId).toBeFalsy();
    // Belt-and-suspenders: no auto-accept resolution note either.
    expect(f?.resolutionNote ?? "").not.toMatch(/Auto-linked/);
  });

  it("faq_changed finding with a technical-signal (add_section_or_faq) rec changelog: link (cross-signal compatibility)", () => {
    // FAQ-class findings legitimately map to both content (Strengthen)
    // and technical (add_section_or_faq) rec actions. Verify the
    // mapping table allows the technical path.
    const prev = snap("https://site.example/services/whole-home-remodel", {
      faqs: [],
      faq_schema_block_count: 0,
    });
    const curr = snap("https://site.example/services/whole-home-remodel", {
      faqs: Array.from({ length: 5 }, (_, i) => ({
        question: `Q${i}`,
        answer_excerpt: "A",
        source: "jsonld" as const,
      })),
      faq_schema_block_count: 1,
    });
    const rec = changelog({
      id: "cl-addsection",
      url: "https://site.example/services/whole-home-remodel",
      signal_type: "technical",
      change_description: "Add section to /services/whole-home-remodel",
      source_rec_id: "rec-add-section",
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [rec],
      scanRunId: "run-1",
    });

    const f = findings.find((x) => x.type === "faq_changed");
    expect(f?.source_rec_id).toBe("rec-add-section");
    expect(f?.linkedChangeId).toBe("cl-addsection");
  });
});
