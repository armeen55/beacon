/**
 * Phase 1 — Tests for `buildSchemaParityActions`.
 *
 * Covers:
 *   - Severity-based sort (high > medium > low)
 *   - Citation-count tiebreaker
 *   - maxActions cap (default 1)
 *   - Filters to pending findings of the correct type only
 *   - Action shape: bucket/confidence/href/specificMove mappings
 *   - Parses missing + present from Finding.currentState/previousState
 */

import { describe, it, expect } from "vitest";
import { buildSchemaParityActions } from "./schema-parity-actions";
import type { Finding, FindingSeverity, FindingPriority } from "@/domains/scanning/types";

function finding(overrides: Partial<Finding> & Pick<Finding, "url">): Finding {
  const sev: FindingSeverity = overrides.severity ?? "medium";
  const pri: FindingPriority =
    overrides.priority ??
    (sev === "high" ? "important" : sev === "medium" ? "minor" : "informational");
  return {
    id: overrides.id ?? "fnd-1",
    type: overrides.type ?? "schema_missing_for_page_type",
    url: overrides.url,
    pagePath:
      overrides.pagePath ??
      (overrides.url.replace(/^https?:\/\/[^/]+/, "") || "/"),
    detectedAt: "2026-04-16T12:00:00Z",
    scanRunId: "scan-test",
    previousState:
      overrides.previousState ?? "schema_types: [FAQPage]",
    currentState:
      overrides.currentState ??
      "missing_required: [BreadcrumbList, WebPage, (one of) LocalBusiness | HomeAndConstructionBusiness | ProfessionalService]",
    severity: sev,
    priority: pri,
    priorityScore: overrides.priorityScore ?? 50,
    summary: overrides.summary ?? "summary",
    suggestedAction: overrides.suggestedAction ?? "suggested",
    status: overrides.status ?? "pending",
    resolvedAt: null,
    linkedChangeId: null,
    promotionStatus: "none",
    resolutionNote: null,
    suppressUntil: null,
    citationCount: overrides.citationCount ?? 0,
    isHomepage: overrides.isHomepage ?? false,
    contradictsChangelog: false,
    tenant_id: "",
  };
}

describe("buildSchemaParityActions — filtering", () => {
  it("returns empty array when there are no schema_missing findings", () => {
    const actions = buildSchemaParityActions({
      findings: [finding({ url: "https://r.co/x", type: "title_changed" })],
    });
    expect(actions).toEqual([]);
  });

  it("ignores non-pending findings (accepted / rejected / ignored)", () => {
    const actions = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/a", status: "accepted" }),
        finding({ url: "https://r.co/b", status: "rejected" }),
        finding({ url: "https://r.co/c", status: "ignored" }),
      ],
    });
    expect(actions).toEqual([]);
  });

  it("includes pending findings only", () => {
    const actions = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/a", status: "pending" }),
        finding({ url: "https://r.co/b", status: "accepted" }),
      ],
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].targetPageUrl).toBe("https://r.co/a");
  });
});

describe("buildSchemaParityActions — sorting + cap", () => {
  it("returns at most 1 action by default (plan rule)", () => {
    const actions = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/a", id: "f1", severity: "high", citationCount: 100 }),
        finding({ url: "https://r.co/b", id: "f2", severity: "high", citationCount: 50 }),
        finding({ url: "https://r.co/c", id: "f3", severity: "medium", citationCount: 500 }),
      ],
    });
    expect(actions).toHaveLength(1);
  });

  it("sorts by severity first (high > medium > low)", () => {
    const actions = buildSchemaParityActions({
      maxActions: 3,
      findings: [
        finding({ url: "https://r.co/low", id: "low", severity: "low", citationCount: 1000 }),
        finding({ url: "https://r.co/med", id: "med", severity: "medium", citationCount: 500 }),
        finding({ url: "https://r.co/high", id: "high", severity: "high", citationCount: 5 }),
      ],
    });
    expect(actions.map((a) => a.id)).toEqual(["high", "med", "low"]);
  });

  it("breaks ties within a severity by citation count desc", () => {
    const actions = buildSchemaParityActions({
      maxActions: 3,
      findings: [
        finding({ url: "https://r.co/a", id: "a", severity: "high", citationCount: 50 }),
        finding({ url: "https://r.co/b", id: "b", severity: "high", citationCount: 300 }),
        finding({ url: "https://r.co/c", id: "c", severity: "high", citationCount: 100 }),
      ],
    });
    expect(actions.map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("respects maxActions > 1 when caller passes it", () => {
    const actions = buildSchemaParityActions({
      maxActions: 2,
      findings: [
        finding({ url: "https://r.co/a", id: "f1", severity: "high" }),
        finding({ url: "https://r.co/b", id: "f2", severity: "medium" }),
        finding({ url: "https://r.co/c", id: "f3", severity: "low" }),
      ],
    });
    expect(actions).toHaveLength(2);
  });
});

describe("buildSchemaParityActions — action shape", () => {
  it("maps severity to bucket + confidence correctly", () => {
    const [high] = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/x", severity: "high", citationCount: 100 }),
      ],
    });
    expect(high.bucket).toBe("critical");
    expect(high.confidence).toBe("high");
    expect(high.type).toBe("schema_parity");
    expect(high.actionClass).toBe("schema_experiment");

    const [med] = buildSchemaParityActions({
      findings: [finding({ url: "https://r.co/y", severity: "medium" })],
    });
    expect(med.bucket).toBe("high_leverage");
    expect(med.confidence).toBe("medium");

    const [low] = buildSchemaParityActions({
      findings: [finding({ url: "https://r.co/z", severity: "low" })],
    });
    expect(low.bucket).toBe("opportunistic");
    expect(low.confidence).toBe("low");
  });

  it("builds href pointing at /changes/truth?focus=<path>", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://ritzbuilders.com/locations/palo-alto",
          pagePath: "/locations/palo-alto",
        }),
      ],
    });
    expect(a.href).toBe(
      "/changes/truth?focus=%2Flocations%2Fpalo-alto",
    );
  });

  it("headline mentions the page path + missing count (singular vs plural)", () => {
    const [single] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://r.co/our-process",
          pagePath: "/our-process",
          currentState: "missing_required: [HowTo]",
        }),
      ],
    });
    expect(single.headline).toContain("1 missing schema type");
    expect(single.headline).toContain("/our-process");

    const [multi] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://r.co/loc/x",
          pagePath: "/loc/x",
          currentState:
            "missing_required: [BreadcrumbList, WebPage, (one of) LocalBusiness | HomeAndConstructionBusiness | ProfessionalService]",
        }),
      ],
    });
    expect(multi.headline).toContain("3 missing schema types");
  });

  it("specificMove lists the exact missing types and warns against visible-copy changes", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://r.co/x",
          pagePath: "/x",
          currentState: "missing_required: [Article, BreadcrumbList]",
        }),
      ],
    });
    expect(a.specificMove).toContain("Article");
    expect(a.specificMove).toContain("BreadcrumbList");
    expect(a.specificMove).toContain("Do not change visible content");
  });

  it("lineageBullets carry the diagnostic context", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://r.co/locations/palo-alto",
          pagePath: "/locations/palo-alto",
          citationCount: 272,
          currentState:
            "missing_required: [BreadcrumbList, WebPage]",
          previousState: "schema_types: [FAQPage]",
        }),
      ],
    });
    expect(a.lineageBullets).toBeDefined();
    const joined = a.lineageBullets!.join(" | ");
    expect(joined).toContain("city page");
    expect(joined).toContain("FAQPage");
    expect(joined).toContain("BreadcrumbList, WebPage");
    expect(joined).toContain("272");
  });

  it("baselineCitations uses citationsByUrl when provided", () => {
    const citationsByUrl = new Map([["/x", 999]]);
    const [a] = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/x", pagePath: "/x", citationCount: 10 }),
      ],
      citationsByUrl,
    });
    expect(a.baselineCitations).toBe(999);
  });

  it("baselineCitations falls back to finding.citationCount if map missing", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/x", pagePath: "/x", citationCount: 42 }),
      ],
    });
    expect(a.baselineCitations).toBe(42);
  });

  it("baselineCitations is null when both sources are 0", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/x", pagePath: "/x", citationCount: 0 }),
      ],
    });
    expect(a.baselineCitations).toBeNull();
  });

  it("hasExperiment is false (no deploy yet)", () => {
    const [a] = buildSchemaParityActions({
      findings: [finding({ url: "https://r.co/x" })],
    });
    expect(a.hasExperiment).toBe(false);
  });

  it("sourceChangeId is null (no linked change yet)", () => {
    const [a] = buildSchemaParityActions({
      findings: [finding({ url: "https://r.co/x" })],
    });
    expect(a.sourceChangeId).toBeNull();
  });
});

describe("buildSchemaParityActions — (none) schema sentinel (wave-10 visual ground-truth)", () => {
  it("renders 'has no JSON-LD' (NOT 'has only (none) schema') for a page with zero schema", () => {
    // Caught on /today's Next Best Action: "This brand page has only (none)
    // schema." The detector writes "(none)" as the no-schema sentinel; it must
    // not be parsed back as a present type.
    const [a] = buildSchemaParityActions({
      findings: [
        finding({
          url: "https://r.co/our-partners",
          previousState: "schema_types: [(none)]",
        }),
      ],
    });
    expect(a).toBeDefined();
    expect(a.rationale).toContain("has no JSON-LD");
    expect(a.rationale).not.toContain("(none)");
    expect(a.rationale).not.toContain("has only");
  });

  it("still lists the real present type when schema IS present", () => {
    const [a] = buildSchemaParityActions({
      findings: [
        finding({ url: "https://r.co/x", previousState: "schema_types: [FAQPage]" }),
      ],
    });
    expect(a.rationale).toContain("has only FAQPage schema");
  });
});
