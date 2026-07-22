import { describe, expect, it } from "vitest";

import {
  changelogJoinKey,
  classifyAll,
  classifyChangelogRow,
  DEFAULT_LIFECYCLE_TAB,
  indexEditsByJoinKey,
  LIFECYCLE_TAB_ORDER,
  recommendedEditJoinKey,
} from "@/domains/attribution/lifecycle-classification";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-ritz-founder";
const REC_ID = "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)";

function changelogStub(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    id: "cl-test",
    timestamp: "2026-04-27T00:00:00Z",
    signal_type: "content",
    asset_type: "service_page",
    url: "https://ritzbuilders.com/services/whole-home-remodel",
    asset_name: "Whole Home Remodel",
    change_description: "Test row",
    topic_targeted: "whole-home",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: "2026-04-27T00:00:00Z",
    updated_at: "2026-04-27T00:00:00Z",
    tenant_id: TENANT,
    ...overrides,
  };
}

function editStub(overrides: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  return {
    id: `${REC_ID}__add_h2_section__h2[new]:abc`,
    tenant_id: TENANT,
    rec_id: REC_ID,
    action_type: "add_h2_section",
    target_url: "https://ritzbuilders.com/services/whole-home-remodel",
    target_element_key: "h2[new]:abc",
    display_label: null,
    current_text: null,
    proposed_text: "Test",
    why: "Test",
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
    created_at: "2026-04-27T00:00:00Z",
    updated_at: "2026-04-27T00:00:00Z",
    implementation_status: "accepted",
    live_at: null,
    not_found_reason: null,
    ...overrides,
  };
}

describe("changelogJoinKey", () => {
  it("returns concatenated key when all three fields present", () => {
    const key = changelogJoinKey({
      source_rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
    });
    expect(key).toBe(`${REC_ID}__add_h2_section__h2[new]:abc`);
  });

  it("returns null when any field is missing", () => {
    expect(
      changelogJoinKey({ source_rec_id: undefined, action_type: "x", target_element_key: "y" }),
    ).toBeNull();
    expect(
      changelogJoinKey({ source_rec_id: "x", action_type: undefined, target_element_key: "y" }),
    ).toBeNull();
    expect(
      changelogJoinKey({ source_rec_id: "x", action_type: "y", target_element_key: undefined }),
    ).toBeNull();
  });
});

describe("recommendedEditJoinKey", () => {
  it("matches changelogJoinKey for same logical edit", () => {
    const cKey = changelogJoinKey({
      source_rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
    });
    const eKey = recommendedEditJoinKey({
      rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
    });
    expect(eKey).toBe(cKey);
  });
});

describe("classifyChangelogRow", () => {
  describe("Rule 1: live_verified", () => {
    it("classifies rows with live_at set", () => {
      const entry = changelogStub({ live_at: "2026-04-28T05:26:26.05+00:00" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("live_verified");
    });

    it("classifies rows whose linked edit is verified_live (even without live_at on changelog)", () => {
      const entry = changelogStub({});
      const edit = editStub({ implementation_status: "verified_live" });
      expect(classifyChangelogRow({ entry, edit })).toBe("live_verified");
    });

    it("classifies rows whose linked edit is verified_live_modified", () => {
      const entry = changelogStub({});
      const edit = editStub({ implementation_status: "verified_live_modified" });
      expect(classifyChangelogRow({ entry, edit })).toBe("live_verified");
    });

    it("Whole Home Remodel H2 fixture classifies as live_verified", () => {
      // Mirrors the actual production row.
      const entry = changelogStub({
        id: "cl-mogzw78nv8pu54",
        live_at: "2026-04-28T05:26:26.05+00:00",
        source_rec_id: REC_ID,
        action_type: "add_h2_section",
        target_element_key: "h2[new]:a1b2c3d4e5f6g7h8",
      });
      const edit = editStub({
        id: `${REC_ID}__add_h2_section__h2[new]:a1b2c3d4e5f6g7h8`,
        target_element_key: "h2[new]:a1b2c3d4e5f6g7h8",
        implementation_status: "verified_live",
        live_at: "2026-04-28T05:26:26.05+00:00",
      });
      expect(classifyChangelogRow({ entry, edit })).toBe("live_verified");
    });
  });

  describe("Rule 2: needs_review", () => {
    it.each(["needs_review", "partially_implemented", "wrong_page"] as const)(
      "classifies edit status %s as needs_review",
      (status) => {
        const entry = changelogStub({});
        const edit = editStub({ implementation_status: status });
        expect(classifyChangelogRow({ entry, edit })).toBe("needs_review");
      },
    );
  });

  describe("Rule 3: pending_implementation", () => {
    it("classifies accepted edits with no live_at", () => {
      const entry = changelogStub({ live_at: null });
      const edit = editStub({ implementation_status: "accepted", live_at: null });
      expect(classifyChangelogRow({ entry, edit })).toBe("pending_implementation");
    });

    it("does NOT classify as pending when live_at IS set (Rule 1 wins)", () => {
      const entry = changelogStub({ live_at: "2026-04-28T05:26:26Z" });
      const edit = editStub({ implementation_status: "accepted" });
      expect(classifyChangelogRow({ entry, edit })).toBe("live_verified");
    });
  });

  describe("Rule 4: scan_confirmed", () => {
    it("classifies source_system=scan_detection rows", () => {
      const entry = changelogStub({ source_system: "scan_detection" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("scan_confirmed");
    });

    it("classifies source_system=scan_promoted rows", () => {
      const entry = changelogStub({ source_system: "scan_promoted" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("scan_confirmed");
    });
  });

  describe("Rule 5: imported_legacy", () => {
    it("classifies pdf_changelog_rebuild rows", () => {
      const entry = changelogStub({ source_system: "pdf_changelog_rebuild" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("imported_legacy");
    });

    it("classifies CSV import rows by source_system='import'", () => {
      const entry = changelogStub({ source_system: "import" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("imported_legacy");
    });

    it("classifies any row with import_batch_id", () => {
      const entry = changelogStub({ import_batch_id: "import-1776222344423" });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("imported_legacy");
    });
  });

  describe("Rule 6: unclassified fall-through", () => {
    it("classifies dismissed edits as unclassified (operator decision; not in default tabs)", () => {
      const entry = changelogStub({});
      const edit = editStub({ implementation_status: "dismissed" });
      expect(classifyChangelogRow({ entry, edit })).toBe("unclassified");
    });

    it("classifies not_found_after_7d edits as unclassified", () => {
      const entry = changelogStub({});
      const edit = editStub({ implementation_status: "not_found_after_7d" });
      expect(classifyChangelogRow({ entry, edit })).toBe("unclassified");
    });

    it("classifies legacy rows with no source_system + no edit linkage", () => {
      const entry = changelogStub({ source_system: undefined, import_batch_id: undefined });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("unclassified");
    });
  });

  describe("Archived guard", () => {
    it("never classifies archived rows into a visible tab — even if they would otherwise match", () => {
      // An archived row that LOOKS like live_verified must still be unclassified
      // (defense-in-depth: the loader should already filter archived, but if a
      // bug lets one through, we must NOT pollute Live verified).
      const entry = changelogStub({
        archived: true,
        live_at: "2026-04-28T05:26:26.05+00:00",
      });
      expect(classifyChangelogRow({ entry, edit: null })).toBe("unclassified");
    });

    it("archived FAQ test rows (real cleanup output) classify as unclassified", () => {
      // Mirrors the post-Phase-6A.1 state of cl-mogzw78n87lkhq.
      const entry = changelogStub({
        id: "cl-mogzw78n87lkhq",
        archived: true,
        archived_reason: "test_pollution:faq_never_implemented",
        live_at: null,
        source_rec_id: REC_ID,
        action_type: "add_faq",
        target_element_key: "faq_question[new]:b1c2d3e4f5g6h7i8",
      });
      const edit = editStub({
        id: `${REC_ID}__add_faq__faq_question[new]:b1c2d3e4f5g6h7i8`,
        target_element_key: "faq_question[new]:b1c2d3e4f5g6h7i8",
        action_type: "add_faq",
        implementation_status: "dismissed",
        not_found_reason: "test_pollution:faq_never_implemented",
      });
      expect(classifyChangelogRow({ entry, edit })).toBe("unclassified");
    });
  });
});

describe("classifyAll", () => {
  it("groups rows correctly + computes counts including 'all'", () => {
    const h2 = changelogStub({
      id: "cl-h2",
      live_at: "2026-04-28T05:26:26Z",
      source_rec_id: REC_ID,
      action_type: "add_h2_section",
      target_element_key: "h2[new]:abc",
    });
    const pending = changelogStub({
      id: "cl-pending",
      live_at: null,
      source_rec_id: REC_ID,
      action_type: "edit_title",
      target_element_key: "title[0]:def",
    });
    const legacy = changelogStub({
      id: "cl-legacy",
      source_system: "pdf_changelog_rebuild",
    });
    const scan = changelogStub({
      id: "cl-scan",
      source_system: "scan_detection",
    });

    const edits: RecommendedEditRow[] = [
      editStub({
        id: `${REC_ID}__add_h2_section__h2[new]:abc`,
        target_element_key: "h2[new]:abc",
        implementation_status: "verified_live",
        live_at: "2026-04-28T05:26:26Z",
      }),
      editStub({
        id: `${REC_ID}__edit_title__title[0]:def`,
        action_type: "edit_title",
        target_element_key: "title[0]:def",
        implementation_status: "accepted",
      }),
    ];

    const editsByKey = indexEditsByJoinKey(edits);
    const result = classifyAll({
      entries: [h2, pending, legacy, scan],
      editsByJoinKey: editsByKey,
    });

    expect(result.counts.all).toBe(4);
    expect(result.counts.live_verified).toBe(1);
    expect(result.counts.pending_implementation).toBe(1);
    expect(result.counts.imported_legacy).toBe(1);
    expect(result.counts.scan_confirmed).toBe(1);
    expect(result.counts.needs_review).toBe(0);
    expect(result.counts.unclassified).toBe(0);

    expect(result.classOf.get("cl-h2")).toBe("live_verified");
    expect(result.classOf.get("cl-pending")).toBe("pending_implementation");
    expect(result.classOf.get("cl-legacy")).toBe("imported_legacy");
    expect(result.classOf.get("cl-scan")).toBe("scan_confirmed");

    expect(result.byTab.live_verified.map((e) => e.id)).toEqual(["cl-h2"]);
    expect(result.byTab.pending_implementation.map((e) => e.id)).toEqual(["cl-pending"]);
    expect(result.byTab.imported_legacy.map((e) => e.id)).toEqual(["cl-legacy"]);
    expect(result.byTab.scan_confirmed.map((e) => e.id)).toEqual(["cl-scan"]);
  });

  it("preserves input order within each tab bucket", () => {
    const a = changelogStub({ id: "a", source_system: "pdf_changelog_rebuild" });
    const b = changelogStub({ id: "b", source_system: "pdf_changelog_rebuild" });
    const c = changelogStub({ id: "c", source_system: "pdf_changelog_rebuild" });
    const result = classifyAll({
      entries: [c, a, b],
      editsByJoinKey: new Map(),
    });
    expect(result.byTab.imported_legacy.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});

describe("UI constants", () => {
  it("DEFAULT_LIFECYCLE_TAB is live_verified (operator lands on truth)", () => {
    expect(DEFAULT_LIFECYCLE_TAB).toBe("live_verified");
  });

  it("LIFECYCLE_TAB_ORDER opens with live_verified", () => {
    expect(LIFECYCLE_TAB_ORDER[0]).toBe("live_verified");
  });

  it("LIFECYCLE_TAB_ORDER ends with all (catch-all is last)", () => {
    expect(LIFECYCLE_TAB_ORDER[LIFECYCLE_TAB_ORDER.length - 1]).toBe("all");
  });
});
