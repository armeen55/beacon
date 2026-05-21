/**
 * Slice 4.5.G-A.2 (2026-05-21) — render tests for the operator-only
 * recommendation safety audit diagnostic page.
 *
 * Coverage:
 *   • Non-operator + non-test env → notFound()
 *   • Operator/test env renders page wrapper
 *   • Empty rows → calm empty state with scanned=0
 *   • Clean rows → empty-violations success banner
 *   • Violation rows render the table with correct data-attrs
 *   • Multi-violation row produces multiple DOM rows
 *   • Counter strip totals (scanned / rows-with-violations / total
 *     violations / high / medium / low)
 *   • Active competitor entity flows into the scanner
 *   • Inactive competitor entity is excluded
 *   • data-safety-violation-kind + data-safety-violation-severity +
 *     data-safety-violation-field + data-safety-rec-id present
 *   • No action buttons, no forms, no submit elements
 *   • Read-only copy visible
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

let _isOperator = true;
vi.mock("@/lib/operator-mode", () => ({
  isOperatorModeServer: () => _isOperator,
}));

const _notFoundSpy = vi.fn();
vi.mock("next/navigation", () => ({
  notFound: () => {
    _notFoundSpy();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-test"),
}));

let _recommendedEdits: RecommendedEditRow[] = [];
let _trackedEntities: TrackedEntity[] = [];
vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (_tenantId: string) => ({
      getRecommendedEdits: async () => _recommendedEdits,
      getTrackedEntities: async () => _trackedEntities,
    }),
  }),
}));

import RecommendationSafetyAuditPage from "@/app/(shell)/diagnostics/recommendation-safety-audit/page";

function makeEdit(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-test",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://test.example/services/kitchen",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    implementation_status: "verified_live",
    ...overrides,
  };
}

function makeCompetitor(
  name: string,
  overrides: Partial<TrackedEntity> = {},
): TrackedEntity {
  return {
    id: `entity-${name}`,
    account_id: "tenant-test",
    tenant_id: "tenant-test",
    entity_type: "competitor",
    name,
    aliases: [],
    domain: null,
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    ...overrides,
  };
}

async function render(): Promise<string> {
  const node = (await RecommendationSafetyAuditPage()) as ReactElement;
  return renderToStaticMarkup(node);
}

beforeEach(() => {
  _isOperator = true;
  _recommendedEdits = [];
  _trackedEntities = [];
  _notFoundSpy.mockClear();
});

describe("Recommendation Safety Audit page render", () => {
  it("non-operator + non-test env → notFound()", async () => {
    _isOperator = false;
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(render()).rejects.toThrow(/NEXT_NOT_FOUND/);
      expect(_notFoundSpy).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("operator/test env renders the page wrapper", async () => {
    const html = await render();
    expect(html).toContain('data-diagnostic="recommendation-safety-audit"');
    expect(html).toContain("Recommendation Safety Audit");
    expect(html).toContain(
      "Read-only operator audit for customer-facing recommendation",
    );
  });

  it("empty rows → calm empty state with scanned=0", async () => {
    _recommendedEdits = [];
    const html = await render();
    expect(html).toContain(
      'data-diagnostic-section="recommendation-safety-audit-empty"',
    );
    expect(html).toContain("No safety violations detected");
    expect(html).toMatch(
      /data-counter="scanned_count"[^>]*>[^<]*<span[^>]*>0</,
    );
  });

  it("clean rows → no violations detected (success banner)", async () => {
    _recommendedEdits = [
      makeEdit({ proposed_text: "Add a clear service-area heading.", why: "Helps." }),
      makeEdit({ rec_id: "rec-2", proposed_text: "Add an FAQ.", why: "Helps." }),
    ];
    const html = await render();
    expect(html).toContain(
      'data-diagnostic-section="recommendation-safety-audit-empty"',
    );
    expect(html).toMatch(
      /data-counter="scanned_count"[^>]*>[^<]*<span[^>]*>2</,
    );
    expect(html).toMatch(
      /data-counter="total_violations"[^>]*>[^<]*<span[^>]*>0</,
    );
  });

  it("violation rows render the table", async () => {
    _recommendedEdits = [
      makeEdit({
        rec_id: "rec-violator-1",
        proposed_text: "TODO finish this copy.",
      }),
    ];
    const html = await render();
    expect(html).toContain(
      'data-diagnostic-section="recommendation-safety-audit"',
    );
    expect(html).toContain('data-safety-rec-id="rec-violator-1"');
    expect(html).toContain('data-safety-violation-kind="placeholder"');
    expect(html).toContain('data-safety-violation-severity="high"');
    expect(html).toContain('data-safety-violation-field="proposed_text"');
  });

  it("one recommended_edit with multiple violations renders multiple DOM rows", async () => {
    _recommendedEdits = [
      makeEdit({
        rec_id: "rec-multi",
        proposed_text: "Best service — TODO finish.",
      }),
    ];
    const html = await render();
    const matches = html.match(/data-safety-rec-id="rec-multi"/g) ?? [];
    // leading_superlative + em_dash + placeholder + (`best` unsupported_claim)
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("counter strip totals match for mixed-severity dataset", async () => {
    _recommendedEdits = [
      makeEdit({
        rec_id: "rec-high",
        proposed_text: "TODO finish this.", // 1 high (placeholder)
      }),
      makeEdit({
        rec_id: "rec-medium",
        proposed_text: "Our service is best in town.", // 1 medium (unsupported_claim)
      }),
      makeEdit({
        rec_id: "rec-low",
        proposed_text: "Modern home — quality.", // 1 low (em_dash)
      }),
      makeEdit({
        rec_id: "rec-clean",
        proposed_text: "A clear, plain message.",
      }),
    ];
    const html = await render();
    expect(html).toMatch(
      /data-counter="scanned_count"[^>]*>[^<]*<span[^>]*>4</,
    );
    expect(html).toMatch(
      /data-counter="rows_with_violations"[^>]*>[^<]*<span[^>]*>3</,
    );
    expect(html).toMatch(
      /data-counter="violations_high"[^>]*>[^<]*<span[^>]*>1</,
    );
    expect(html).toMatch(
      /data-counter="violations_medium"[^>]*>[^<]*<span[^>]*>1</,
    );
    expect(html).toMatch(
      /data-counter="violations_low"[^>]*>[^<]*<span[^>]*>1</,
    );
  });

  it("active competitor entity flows into the scanner", async () => {
    _trackedEntities = [makeCompetitor("Supple Homes")];
    _recommendedEdits = [
      makeEdit({
        rec_id: "rec-with-competitor",
        proposed_text: "We beat Supple Homes on quality.",
      }),
    ];
    const html = await render();
    expect(html).toContain('data-safety-violation-kind="competitor_name"');
    expect(html).toContain('data-safety-rec-id="rec-with-competitor"');
  });

  it("inactive competitor entity is excluded from the scan", async () => {
    _trackedEntities = [makeCompetitor("Supple Homes", { is_active: false })];
    _recommendedEdits = [
      makeEdit({
        rec_id: "rec-no-competitor-leak",
        proposed_text: "We beat Supple Homes on quality.",
      }),
    ];
    const html = await render();
    expect(html).not.toContain(
      'data-safety-violation-kind="competitor_name"',
    );
  });

  it("renders read-only copy + no action buttons / forms", async () => {
    _recommendedEdits = [
      makeEdit({ proposed_text: "TODO marker triggers a violation." }),
    ];
    const html = await render();
    expect(html).toContain("Read-only operator audit");
    expect(html).not.toMatch(/<button\b/i);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/type="submit"/);
  });
});
