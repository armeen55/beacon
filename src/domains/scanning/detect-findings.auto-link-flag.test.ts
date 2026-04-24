/**
 * Phase 1 hardening — auto-link flag test.
 *
 * Asserts that when `BEACON_AUTO_LINK_FINDINGS` is unset or not "1",
 * scan findings stay `pending` even when a compatible changelog entry
 * exists. And that when the flag IS "1", the legacy auto-link behavior
 * returns unchanged.
 *
 * This prevents the /our-process class of bug where a brand-new finding
 * got silently collapsed into a 16-day-old unrelated changelog entry.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateFindings } from "./detect-findings";
import type { PageSnapshot } from "@/domains/pages/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

function snap(over: Partial<PageSnapshot> & { url: string }): PageSnapshot {
  const base: PageSnapshot = {
    id: "snap-test",
    page_id: "pg-test",
    url: over.url,
    canonical_url: over.url,
    fetched_at: "2026-04-17T12:00:00Z",
    http_status: 200,
    title: "Test",
    meta_description: "Test",
    h1: "Test",
    h2_list: [],
    h3_count: 0,
    faqs: [],
    schema_types: [],
    location_terms: [],
    service_terms: [],
    internal_link_count: 0,
    external_link_count: 0,
    internal_links: [],
    word_count: 100,
    robots_meta: "index, follow",
    has_canonical_mismatch: false,
    content_hash: "c-test",
    headings_hash: "h-test",
    faq_hash: "f-test",
    schema_hash: "s-test",
    extraction_certainty: "confirmed",
    faq_schema_block_count: 0,
    table_count: 0,
    tenant_id: "",
    observation_run_id: "obs-test",
  } as PageSnapshot;
  return { ...base, ...over };
}

function entry(over: Partial<ChangelogEntry> & { id: string; timestamp: string; url: string }): ChangelogEntry {
  const base: ChangelogEntry = {
    id: over.id,
    timestamp: over.timestamp,
    signal_type: "technical",
    asset_type: "city_page",
    url: over.url,
    asset_name: over.url,
    change_description: "",
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: over.timestamp,
    updated_at: over.timestamp,
    source_system: "manual",
    tenant_id: "t",
  };
  return { ...base, ...over };
}

// ---------------------------------------------------------------------------
// Reproduction fixture: the /our-process bug
// ---------------------------------------------------------------------------

// A changelog entry from 16 days ago whose description includes "schema" and "faq".
// Under the old 30-day auto-link rule, a brand-new schema_changed finding on
// the same URL would silently collapse into this entry.
const OLD_GENERIC_ENTRY: ChangelogEntry = entry({
  id: "cl-old",
  timestamp: "2026-04-01T08:00:00+00:00",
  url: "/our-process",
  asset_type: "process_page",
  change_description:
    "Reconstructed /our-process page with updated metadata, rewritten hero/section copy, architect-led comparison section, replaced process content, updated FAQs and schema",
  signal_type: "content",
});

function buildScanInputWithSchemaChange() {
  const prev = snap({
    url: "https://ritzbuilders.com/our-process",
    schema_types: ["FAQPage"],
    schema_hash: "prev",
  });
  const cur = snap({
    url: "https://ritzbuilders.com/our-process",
    schema_types: ["FAQPage", "HowTo"],
    schema_hash: "curr",
    // Force diffSnapshots to see a change
  });
  return {
    currentSnapshots: [cur],
    previousSnapshots: [prev],
    currentGuardrails: [],
    previousGuardrails: [],
    changelog: [OLD_GENERIC_ENTRY],
    scanRunId: "scan-test",
  };
}

describe("auto-link feature flag (BEACON_AUTO_LINK_FINDINGS)", () => {
  const originalEnv = process.env.BEACON_AUTO_LINK_FINDINGS;

  beforeEach(() => {
    delete process.env.BEACON_AUTO_LINK_FINDINGS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BEACON_AUTO_LINK_FINDINGS;
    } else {
      process.env.BEACON_AUTO_LINK_FINDINGS = originalEnv;
    }
  });

  it("DEFAULT (flag unset) — schema_changed finding stays `pending` even when a matching old changelog entry exists", () => {
    // No env var set → flag is OFF → auto-link skipped.
    const findings = generateFindings(buildScanInputWithSchemaChange());
    const schemaFinding = findings.find((f) => f.type === "schema_changed");
    expect(schemaFinding).toBeDefined();
    expect(schemaFinding!.status).toBe("pending");
    expect(schemaFinding!.linkedChangeId).toBeNull();
    expect(schemaFinding!.resolvedAt).toBeNull();
  });

  it("DEFAULT — faq_changed finding also stays `pending`", () => {
    const prev = snap({
      url: "https://ritzbuilders.com/our-process",
      faqs: Array.from({ length: 8 }, (_, i) => ({
        question: `q${i}`,
        answer: `a${i}`,
        answer_excerpt: `a${i}`,
        source: "visible",
      })) as unknown as PageSnapshot["faqs"],
      faq_hash: "prev-faq",
    });
    const cur = snap({
      url: "https://ritzbuilders.com/our-process",
      faqs: Array.from({ length: 16 }, (_, i) => ({
        question: `q${i}`,
        answer: `a${i}`,
        answer_excerpt: `a${i}`,
        source: "visible",
      })) as unknown as PageSnapshot["faqs"],
      faq_hash: "curr-faq",
    });

    const findings = generateFindings({
      currentSnapshots: [cur],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [OLD_GENERIC_ENTRY],
      scanRunId: "scan-test",
    });
    const faqFinding = findings.find((f) => f.type === "faq_changed");
    expect(faqFinding?.status).toBe("pending");
    expect(faqFinding?.linkedChangeId).toBeNull();
  });

  // Phase Auto-Link v2 (2026-04-24): legacy Path 1 retired for good.
  // Flipping the flag no longer resurrects the keyword-match auto-accept
  // behaviour — it now enables ONLY the metadata stamp against
  // recommendation-sourced changelog entries, finding stays pending.
  // Deep contract for the new path lives in
  // tests/domains/scanning/auto-link-via-changelog.test.ts.

  it('FLAG ON ("1") with a non-recommendation-sourced old entry on the same URL → finding STILL stays pending (legacy keyword-match retired)', () => {
    process.env.BEACON_AUTO_LINK_FINDINGS = "1";
    // OLD_GENERIC_ENTRY has hypothesis_source unset (not
    // "recommendation"), so it's NOT a candidate under the new path
    // even with the flag on. Old Path 1 would have keyword-matched
    // "schema" in its description and auto-accepted — that behaviour
    // is gone.
    const findings = generateFindings(buildScanInputWithSchemaChange());
    const schemaFinding = findings.find((f) => f.type === "schema_changed");
    expect(schemaFinding?.status).toBe("pending");
    expect(schemaFinding?.linkedChangeId).toBeFalsy();
    expect(schemaFinding?.resolvedAt).toBeFalsy();
  });

  it("FLAG ON — URL mismatch still produces no link", () => {
    process.env.BEACON_AUTO_LINK_FINDINGS = "1";
    const unrelated = entry({
      id: "cl-unrelated",
      timestamp: "2026-04-10T08:00:00+00:00",
      url: "/different-page",
      change_description: "Added schema to different page",
      hypothesis_source: "recommendation",
      source_rec_id: "rec-unrelated",
    });
    const input = buildScanInputWithSchemaChange();
    input.changelog = [unrelated];
    const findings = generateFindings(input);
    const schemaFinding = findings.find((f) => f.type === "schema_changed");
    expect(schemaFinding?.status).toBe("pending");
    expect(schemaFinding?.source_rec_id).toBeFalsy();
  });

  it("Value other than '1' is treated as OFF (e.g. 'true' does NOT enable)", () => {
    process.env.BEACON_AUTO_LINK_FINDINGS = "true";
    const findings = generateFindings(buildScanInputWithSchemaChange());
    const schemaFinding = findings.find((f) => f.type === "schema_changed");
    expect(schemaFinding?.status).toBe("pending");
  });
});
