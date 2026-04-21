/**
 * Fix 2 (2026-04-21) — auto-link tests for detect-findings.
 *
 * When a pending change is detected on a URL that has a recently-accepted
 * recommendation, the finding is stamped with `source_rec_id` and
 * `source_pattern_id`. Manual Confirm path unchanged — this is linkage,
 * not auto-confirmation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateFindings } from "@/domains/scanning/detect-findings";
import {
  recommendationResponses,
  recordResponse,
} from "@/domains/product/recommendation-response-store";
import type { PageSnapshot } from "@/domains/pages/types";

function snap(url: string, overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    id: `snap-${url}`,
    page_id: `p-${url}`,
    url,
    canonical_url: null,
    fetched_at: "2026-04-21T00:00:00Z",
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
    table_count: 0,
    tenant_id: "",
    ...overrides,
  };
}

function reset() {
  recommendationResponses.length = 0;
}

describe("generateFindings — Fix 2 auto-link", () => {
  beforeEach(reset);

  it("stamps source_rec_id on findings when a recent accepted rec matches the URL", () => {
    recordResponse("rec-xyz", "accepted", {
      targetPageUrl: "https://site.example/locations/atherton",
      patternId: "pattern-abc",
    });

    const prev = snap("https://site.example/locations/atherton", {
      h2_list: ["Old Heading"],
    });
    const curr = snap("https://site.example/locations/atherton", {
      h2_list: ["New Heading"],
    });

    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });

    const h2Finding = findings.find((f) => f.type === "h2_changed");
    expect(h2Finding).toBeDefined();
    expect(h2Finding?.source_rec_id).toBe("rec-xyz");
    expect(h2Finding?.source_pattern_id).toBe("pattern-abc");
  });

  it("does not stamp when no accepted rec exists for the URL", () => {
    const prev = snap("https://site.example/foo", { h2_list: ["A"] });
    const curr = snap("https://site.example/foo", { h2_list: ["B"] });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });
    const f = findings.find((x) => x.type === "h2_changed");
    expect(f).toBeDefined();
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("does not stamp when accepted rec is older than 14 days", () => {
    // Respond normally, then mutate respondedAt to 30 days ago.
    recordResponse("rec-stale", "accepted", {
      targetPageUrl: "https://site.example/foo",
      patternId: null,
    });
    const staleDate = new Date(Date.now() - 30 * 86400000).toISOString();
    const r = recommendationResponses.find((x) => x.recId === "rec-stale")!;
    r.respondedAt = staleDate;

    const prev = snap("https://site.example/foo", { h2_list: ["A"] });
    const curr = snap("https://site.example/foo", { h2_list: ["B"] });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });
    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("picks the most recent accepted rec when multiple exist for the same URL", () => {
    recordResponse("rec-older", "accepted", {
      targetPageUrl: "https://site.example/x",
      patternId: "p-old",
    });
    // Force a later timestamp explicitly.
    recordResponse("rec-newer", "accepted", {
      targetPageUrl: "https://site.example/x",
      patternId: "p-new",
    });
    const older = recommendationResponses.find((r) => r.recId === "rec-older")!;
    older.respondedAt = new Date(Date.now() - 5 * 86400000).toISOString();
    const newer = recommendationResponses.find((r) => r.recId === "rec-newer")!;
    newer.respondedAt = new Date().toISOString();

    const prev = snap("https://site.example/x", { h2_list: ["A"] });
    const curr = snap("https://site.example/x", { h2_list: ["B"] });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });
    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBe("rec-newer");
    expect(f?.source_pattern_id).toBe("p-new");
  });

  it("does not stamp for dismissed responses even if within the window", () => {
    recordResponse("rec-dismissed", "dismissed", {
      targetPageUrl: "https://site.example/d",
      patternId: "p-d",
    });
    const prev = snap("https://site.example/d", { h2_list: ["A"] });
    const curr = snap("https://site.example/d", { h2_list: ["B"] });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });
    const f = findings.find((x) => x.type === "h2_changed");
    expect(f?.source_rec_id).toBeUndefined();
  });

  it("stamps h3_changed and schema_entity_names_changed findings too", () => {
    recordResponse("rec-multi", "accepted", {
      targetPageUrl: "https://site.example/y",
      patternId: "p-multi",
    });
    const prev = snap("https://site.example/y", {
      h3_list: ["A"],
      schema_entity_names: ["Old Service"],
    });
    const curr = snap("https://site.example/y", {
      h3_list: ["A", "B"],
      schema_entity_names: ["Old Service", "New Service"],
    });
    const findings = generateFindings({
      currentSnapshots: [curr],
      previousSnapshots: [prev],
      currentGuardrails: [],
      previousGuardrails: [],
      changelog: [],
      scanRunId: "run-1",
    });
    const h3 = findings.find((x) => x.type === "h3_changed");
    const schemaNames = findings.find(
      (x) => x.type === "schema_entity_names_changed",
    );
    expect(h3?.source_rec_id).toBe("rec-multi");
    expect(schemaNames?.source_rec_id).toBe("rec-multi");
  });
});
