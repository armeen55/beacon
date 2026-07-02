/**
 * Triage feed bridge (2026-07-02, BEACON 500 item 52).
 *
 * Pins:
 *   - only finding types that map to a real, pushable lever ever produce a
 *     suggestion (deploy_mismatch, page_added, robots_txt_blocked, ... never do),
 *   - the 90 percent acceptance threshold gates the suggestion, combined
 *     across every citation-bucket rule for that lever,
 *   - low-confidence and non-auto_accept rules never surface,
 *   - a lever the operator already has an explicit policy for (auto OR
 *     review) never gets suggested again - never self-enables,
 *   - loadTriageSuggestions fails soft to an empty list on a store error.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import type { TriageRule } from "@/domains/learning/triage-rules";
import {
  FINDING_TYPE_TO_LEVER,
  computeTriageSuggestions,
  filterSuggestionsForOperatorDecision,
  loadTriageSuggestions,
  SUGGESTED_DAILY_CAP,
} from "@/domains/autopilot/triage-feed";
import type { PerLeverPolicy } from "@/domains/autopilot/autopilot-policy";

function rule(partial: Partial<TriageRule> = {}): TriageRule {
  return {
    id: `${partial.finding_type ?? "meta_changed"}::medium_citation`,
    finding_type: "meta_changed",
    citation_bucket: "medium_citation",
    total_resolved: 15,
    accepted_count: 14,
    rejected_count: 1,
    ignored_count: 0,
    acceptance_rate: 0.93,
    rejection_rate: 0.07,
    recommendation: "auto_accept",
    confidence: "high",
    computed_at: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

describe("computeTriageSuggestions", () => {
  it("surfaces a suggestion for a mapped, high-confidence, auto_accept rule", () => {
    const suggestions = computeTriageSuggestions([rule()]);
    expect(suggestions).toHaveLength(1);
    const s = suggestions[0]!;
    expect(s.actionType).toBe("edit_meta");
    expect(s.totalResolved).toBe(15);
    expect(s.totalAccepted).toBe(14);
    expect(s.acceptancePct).toBe(93);
    expect(s.evidenceLine).toContain("14 of 15");
    expect(s.evidenceLine).toContain("93 percent");
    expect(s.evidenceLine).toContain("?");
    expect(s.suggestedDailyCap).toBe(SUGGESTED_DAILY_CAP);
  });

  it("a finding type with no lever mapping never produces a suggestion", () => {
    const unmapped: Array<TriageRule["finding_type"]> = [
      "deploy_mismatch",
      "page_added",
      "page_removed",
      "robots_txt_blocked",
      "stale_visibility",
      "unexpected_change",
      "content_changed",
      "links_changed",
      "canonical_changed",
      "new_guardrail",
      "guardrail_cleared",
      "h2_changed",
      "h3_changed",
      "schema_entity_names_changed",
    ];
    for (const finding_type of unmapped) {
      expect(FINDING_TYPE_TO_LEVER[finding_type]).toBeUndefined();
    }
    const suggestions = computeTriageSuggestions(
      unmapped.map((finding_type) => rule({ finding_type, id: `${finding_type}::x` })),
    );
    expect(suggestions).toHaveLength(0);
  });

  it("low confidence never surfaces, even at 100 percent acceptance", () => {
    const suggestions = computeTriageSuggestions([
      rule({ confidence: "low", total_resolved: 3, accepted_count: 3, rejected_count: 0 }),
    ]);
    expect(suggestions).toHaveLength(0);
  });

  it("a recommendation other than auto_accept never surfaces", () => {
    for (const recommendation of ["suppress", "boost", "none"] as const) {
      const suggestions = computeTriageSuggestions([rule({ recommendation })]);
      expect(suggestions).toHaveLength(0);
    }
  });

  it("below the 90 percent threshold never surfaces", () => {
    const suggestions = computeTriageSuggestions([
      rule({ total_resolved: 20, accepted_count: 17, recommendation: "auto_accept" }), // 85%
    ]);
    expect(suggestions).toHaveLength(0);
  });

  it("combines multiple citation-bucket rules for the same lever into one suggestion", () => {
    const suggestions = computeTriageSuggestions([
      rule({
        id: "meta_changed::high_citation",
        citation_bucket: "high_citation",
        total_resolved: 10,
        accepted_count: 10,
      }),
      rule({
        id: "meta_changed::low_citation",
        citation_bucket: "low_citation",
        total_resolved: 10,
        accepted_count: 8,
      }),
    ]);
    // Combined: 18 of 20 = 90 percent, right at the threshold.
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.totalResolved).toBe(20);
    expect(suggestions[0]!.totalAccepted).toBe(18);
    expect(suggestions[0]!.ruleIds).toEqual(["meta_changed::high_citation", "meta_changed::low_citation"]);
  });

  it("maps every known lever-bearing finding type to a real autopilot lever", () => {
    expect(FINDING_TYPE_TO_LEVER.title_changed).toBe("edit_title");
    expect(FINDING_TYPE_TO_LEVER.meta_changed).toBe("edit_meta");
    expect(FINDING_TYPE_TO_LEVER.h1_changed).toBe("change_h1");
    expect(FINDING_TYPE_TO_LEVER.faq_changed).toBe("add_faq");
    expect(FINDING_TYPE_TO_LEVER.schema_changed).toBe("fix_schema");
  });

  it("emits no em or en dashes in the evidence line", () => {
    const suggestions = computeTriageSuggestions([rule()]);
    expect(suggestions[0]!.evidenceLine).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("filterSuggestionsForOperatorDecision", () => {
  const suggestion = computeTriageSuggestions([rule()])[0]!;

  it("keeps a suggestion when the operator has no policy for that lever yet", () => {
    const kept = filterSuggestionsForOperatorDecision([suggestion], null);
    expect(kept).toHaveLength(1);
  });

  it("drops a suggestion once the operator turned it on (never re-suggest an enabled lever)", () => {
    const policies: PerLeverPolicy[] = [{ actionType: "edit_meta", mode: "auto", dailyCap: 1 }];
    const kept = filterSuggestionsForOperatorDecision([suggestion], policies);
    expect(kept).toHaveLength(0);
  });

  it("drops a suggestion once the operator explicitly held it for review (do not nag)", () => {
    const policies: PerLeverPolicy[] = [{ actionType: "edit_meta", mode: "review", dailyCap: 1 }];
    const kept = filterSuggestionsForOperatorDecision([suggestion], policies);
    expect(kept).toHaveLength(0);
  });

  it("a policy for a DIFFERENT lever does not affect this suggestion", () => {
    const policies: PerLeverPolicy[] = [{ actionType: "edit_title", mode: "auto", dailyCap: 1 }];
    const kept = filterSuggestionsForOperatorDecision([suggestion], policies);
    expect(kept).toHaveLength(1);
  });
});

describe("loadTriageSuggestions", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/persistence/json-store");
    vi.resetModules();
  });

  it("never enables anything itself - it only returns suggestions", async () => {
    vi.resetModules();
    vi.doMock("@/lib/persistence/json-store", () => ({
      readStore: vi.fn(async () => [rule()]),
    }));
    const { loadTriageSuggestions: load } = await import("@/domains/autopilot/triage-feed");
    const suggestions = await load({ perLeverPolicies: null });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.actionType).toBe("edit_meta");
  });

  it("fails soft to an empty list on a store read error", async () => {
    vi.resetModules();
    vi.doMock("@/lib/persistence/json-store", () => ({
      readStore: vi.fn(async () => {
        throw new Error("boom");
      }),
    }));
    const { loadTriageSuggestions: load } = await import("@/domains/autopilot/triage-feed");
    const suggestions = await load({ perLeverPolicies: null });
    expect(suggestions).toEqual([]);
  });
});
