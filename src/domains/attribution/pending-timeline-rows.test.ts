/**
 * Merged tests for pending-timeline-rows.ts (folded 2026-07-21 from the former
 * lifecycle-counts.test.ts + synthesize-pending-changelog.test.ts, pruned to
 * the surviving live exports).
 */

import { describe, expect, it } from "vitest";

import {
  buildSyntheticChangelogRows,
  computeLifecycleCounts,
  editNeedsRewrite,
  LIFECYCLE_PENDING_SOURCE_SYSTEM,
  synthesizePendingChangelog,
} from "./pending-timeline-rows";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-ritz-founder";
const REC_ID = "create_cluster_page:geo:Los Altos";

function editStub(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: `${REC_ID}__add_h2_section__h2[new]:c75a1120a6aa`,
    tenant_id: TENANT,
    rec_id: REC_ID,
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/locations/los-altos",
    target_element_key: "h2[new]:c75a1120a6aa",
    display_label:
      'H2 heading (new): "Why teams choose us over De Mattei Construction"',
    current_text: null,
    proposed_text:
      "Why teams choose us over De Mattei Construction\nAn architect-led design-build approach keeps design, budget, and construction tightly coordinated…",
    why: "Establishes a clear positioning vs. competitors",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "openai",
    provider_name: "openai",
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-04-25T19:15:18.778Z",
    updated_at: "2026-04-27T09:42:58.574Z",
    implementation_status: "accepted",
    live_at: null,
    not_found_reason: null,
    ...overrides,
  };
}

describe("computeLifecycleCounts", () => {
  it("buckets every status correctly", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "1", implementation_status: "verified_live" }),
      editStub({ id: "2", implementation_status: "verified_live_modified" }),
      editStub({ id: "3", implementation_status: "accepted" }),
      editStub({ id: "4", implementation_status: "accepted" }),
      editStub({ id: "5", implementation_status: "needs_review" }),
      editStub({ id: "6", implementation_status: "partially_implemented" }),
      editStub({ id: "7", implementation_status: "wrong_page" }),
      editStub({ id: "8", implementation_status: "not_found_after_7d" }),
      editStub({ id: "9", implementation_status: "dismissed" }),
      editStub({ id: "10", implementation_status: "recommended" }),
    ]);
    expect(result.counts.liveVerified).toBe(2);
    expect(result.counts.pendingImplementation).toBe(2);
    expect(result.counts.needsReview).toBe(3);
    expect(result.counts.notFoundAfter7d).toBe(1);
    expect(result.counts.actionableTotal).toBe(5); // pending + needs review
  });

  it("dismissed and recommended are NOT counted (production sanity)", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "d1", implementation_status: "dismissed" }),
      editStub({ id: "d2", implementation_status: "dismissed" }),
      editStub({ id: "r1", implementation_status: "recommended" }),
    ]);
    expect(result.counts.liveVerified).toBe(0);
    expect(result.counts.pendingImplementation).toBe(0);
    expect(result.counts.needsReview).toBe(0);
    expect(result.counts.notFoundAfter7d).toBe(0);
    expect(result.counts.actionableTotal).toBe(0);
  });

  it("undefined status is not counted (legacy file rows with no implementation_status field)", () => {
    const result = computeLifecycleCounts([
      editStub({ id: "legacy", implementation_status: undefined }),
    ]);
    expect(result.counts.actionableTotal).toBe(0);
  });

  it("Los Altos production fixture: 5 accepted → pendingImplementation=5", () => {
    const losAltosEdits: RecommendedEditRow[] = [
      editStub({ id: "h2", action_type: "add_h2_section", implementation_status: "accepted" }),
      editStub({ id: "f1", action_type: "add_faq", target_element_key: "faq_question[new]:d1", implementation_status: "accepted" }),
      editStub({ id: "f2", action_type: "add_faq", target_element_key: "faq_question[new]:f2", implementation_status: "accepted" }),
      editStub({ id: "f3", action_type: "add_faq", target_element_key: "faq_question[new]:93", implementation_status: "accepted" }),
      editStub({ id: "f4", action_type: "add_faq", target_element_key: "faq_question[new]:ff", implementation_status: "accepted" }),
    ];
    const result = computeLifecycleCounts(losAltosEdits);
    expect(result.counts.pendingImplementation).toBe(5);
    expect(result.buckets.pendingEdits).toHaveLength(5);
    expect(result.counts.actionableTotal).toBe(5);
  });

  it("returns the original edit rows in their bucket arrays", () => {
    const accepted = editStub({ id: "a", implementation_status: "accepted" });
    const live = editStub({ id: "l", implementation_status: "verified_live" });
    const result = computeLifecycleCounts([accepted, live]);
    expect(result.buckets.pendingEdits).toEqual([accepted]);
    expect(result.buckets.liveVerifiedEdits).toEqual([live]);
  });
});

describe("editNeedsRewrite", () => {
  it("returns true when proposed_text contains the generator placeholder", () => {
    expect(
      editNeedsRewrite({
        proposed_text:
          "Q: Who builds in Los Altos?\n\nA: Draft answer (operator: rewrite). Anchor on: Los Altos.",
      }),
    ).toBe(true);
  });

  it("returns false for clean operator-written FAQ answers", () => {
    expect(
      editNeedsRewrite({
        proposed_text: "Q: Who builds in Los Altos?\n\nA: Hire an architect-led firm.",
      }),
    ).toBe(false);
  });

  it("returns false when proposed_text is null or empty", () => {
    expect(editNeedsRewrite({ proposed_text: null })).toBe(false);
    expect(editNeedsRewrite({ proposed_text: "" })).toBe(false);
  });
});

describe("synthesizePendingChangelog", () => {
  it("produces a ChangelogEntry-shaped record with the edit's deterministic id", () => {
    const edit = editStub();
    const synth = synthesizePendingChangelog(edit);
    expect(synth.id).toBe(edit.id);
    expect(synth.timestamp).toBe(edit.updated_at);
    expect(synth.url).toBe(edit.target_url);
    expect(synth.tenant_id).toBe(edit.tenant_id);
    expect(synth.live_at).toBeNull();
    expect(synth.archived).toBe(false);
  });

  it("uses display_label for asset_name when present, action_type fallback otherwise", () => {
    expect(
      synthesizePendingChangelog(editStub({ display_label: "Custom label" })).asset_name,
    ).toBe("Custom label");
    expect(
      synthesizePendingChangelog(editStub({ display_label: null })).asset_name,
    ).toBe("add_h2_section");
  });

  it("change_description is the proposed_text snippet (≤240 chars), action_type fallback", () => {
    const long = synthesizePendingChangelog(editStub({ proposed_text: "x".repeat(500) }));
    expect(long.change_description.length).toBeLessThanOrEqual(240);
    const fallback = synthesizePendingChangelog(
      editStub({ proposed_text: null, action_type: "add_h2_section" }),
    );
    expect(fallback.change_description).toBe("add_h2_section");
  });

  it("source_system is the lifecycle_pending sentinel", () => {
    expect(synthesizePendingChangelog(editStub()).source_system).toBe(
      LIFECYCLE_PENDING_SOURCE_SYSTEM,
    );
  });

  it("source_rec_id + action_type + target_element_key match the edit (so the classifier join key resolves)", () => {
    const edit = editStub();
    const synth = synthesizePendingChangelog(edit);
    expect(synth.source_rec_id).toBe(edit.rec_id);
    expect(synth.action_type).toBe(edit.action_type);
    expect(synth.target_element_key).toBe(edit.target_element_key);
  });
});

describe("buildSyntheticChangelogRows", () => {
  it("returns empty array when no pending edits", () => {
    const result = buildSyntheticChangelogRows({
      changelogEntries: [],
      editsToSynthesize: [],
    });
    expect(result).toEqual([]);
  });

  it("returns one synthetic row for an edit with no matching changelog row", () => {
    const result = buildSyntheticChangelogRows({
      changelogEntries: [],
      editsToSynthesize: [editStub({ id: "e1" })],
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e1");
    expect(result[0].source_system).toBe(LIFECYCLE_PENDING_SOURCE_SYSTEM);
  });

  it("skips edits that already have a matching changelog row by id", () => {
    const existingChangelog: ChangelogEntry = {
      id: "e1",
      timestamp: "2026-04-27T00:00:00Z",
      signal_type: "content",
      asset_type: "service_page",
      url: "x",
      asset_name: "x",
      change_description: "x",
      topic_targeted: "x",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "x",
      updated_at: "x",
      tenant_id: TENANT,
    };
    const result = buildSyntheticChangelogRows({
      changelogEntries: [existingChangelog],
      editsToSynthesize: [editStub({ id: "e1" })],
    });
    expect(result).toEqual([]);
  });

  it("skips edits that match by join key (rec_id + action_type + target_element_key)", () => {
    const existingChangelog: ChangelogEntry = {
      id: "different-id-but-same-join-key",
      timestamp: "2026-04-27T00:00:00Z",
      signal_type: "content",
      asset_type: "service_page",
      url: "x",
      asset_name: "x",
      change_description: "x",
      topic_targeted: "x",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "x",
      updated_at: "x",
      tenant_id: TENANT,
      source_rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:c75a1120a6aa",
    };
    const result = buildSyntheticChangelogRows({
      changelogEntries: [existingChangelog],
      editsToSynthesize: [editStub({ id: "e1" })],
    });
    expect(result).toEqual([]);
  });

  it("Los Altos production scenario: 5 pending edits, 0 changelog rows → 5 synthetic", () => {
    const losAltosEdits: RecommendedEditRow[] = [
      editStub({ id: "h2", action_type: "add_h2_section", target_element_key: "h2[new]:c75" }),
      editStub({ id: "fq1", action_type: "add_faq", target_element_key: "faq_question[new]:d1" }),
      editStub({ id: "fq2", action_type: "add_faq", target_element_key: "faq_question[new]:f2" }),
      editStub({ id: "fq3", action_type: "add_faq", target_element_key: "faq_question[new]:93" }),
      editStub({ id: "fq4", action_type: "add_faq", target_element_key: "faq_question[new]:ff" }),
    ];
    const result = buildSyntheticChangelogRows({
      changelogEntries: [],
      editsToSynthesize: losAltosEdits,
    });
    expect(result).toHaveLength(5);
    expect(result.map((r) => r.id)).toEqual(["h2", "fq1", "fq2", "fq3", "fq4"]);
  });

  it("idempotent: same inputs produce same output ids in same order", () => {
    const inputs = {
      changelogEntries: [],
      editsToSynthesize: [
        editStub({ id: "a", target_element_key: "a" }),
        editStub({ id: "b", target_element_key: "b" }),
      ],
    };
    const r1 = buildSyntheticChangelogRows(inputs);
    const r2 = buildSyntheticChangelogRows(inputs);
    expect(r1.map((r) => r.id)).toEqual(r2.map((r) => r.id));
  });
});
