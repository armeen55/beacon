/**
 * Pins the two pure utils that survived the deletion of the
 * /recommendations table builder (CORE 100K Lane D, 2026-07-21):
 *
 *   - actionRowTypeForEdit: the ActionType -> ActionRowType mapping the QA
 *     layer keys push readiness off (paste_ready vs review_only).
 *   - computeEvidenceDepth: the grounding-category counter feeding
 *     deriveConfidence (coverage carried over from the deleted
 *     recommendation-action-rows-ranking.test.ts).
 */

import { describe, it, expect } from "vitest";
import {
  actionRowTypeForEdit,
  computeEvidenceDepth,
} from "./recommendation-action-rows";
import type { SpecificEditEvidenceRef } from "./specific-edit-provider";

describe("actionRowTypeForEdit", () => {
  it("maps paste-ready copy edits onto their row types", () => {
    expect(actionRowTypeForEdit("edit_title")).toBe("edit_title");
    expect(actionRowTypeForEdit("edit_meta")).toBe("edit_meta");
    expect(actionRowTypeForEdit("change_h1")).toBe("edit_h1");
    expect(actionRowTypeForEdit("add_h2_section")).toBe("edit_h2");
    expect(actionRowTypeForEdit("rewrite_h2")).toBe("edit_h2");
    expect(actionRowTypeForEdit("add_faq")).toBe("add_faq");
    expect(actionRowTypeForEdit("rewrite_faq")).toBe("add_faq");
    expect(actionRowTypeForEdit("add_schema")).toBe("add_schema");
    expect(actionRowTypeForEdit("add_answer_block")).toBe("add_section");
    expect(actionRowTypeForEdit("add_table")).toBe("add_comparison_table");
    expect(actionRowTypeForEdit("add_internal_link")).toBe(
      "add_internal_links",
    );
  });

  it("maps directives and manual tasks to review_decision (never paste-ready)", () => {
    for (const at of [
      "fix_robots",
      "fix_noindex",
      "fix_canonical",
      "fix_status_code",
      "fix_sitemap",
      "fix_page_experience",
      "improve_meta",
      "split_page",
      "merge_pages",
      "watch",
      "claim_gbp",
    ] as const) {
      expect(actionRowTypeForEdit(at)).toBe("review_decision");
    }
  });

  it("maps page-lifecycle types", () => {
    expect(actionRowTypeForEdit("create_page")).toBe("create_page");
    expect(actionRowTypeForEdit("reorder_sections")).toBe("technical_fix");
  });
});

describe("computeEvidenceDepth", () => {
  it("returns 0 for empty evidence", () => {
    expect(computeEvidenceDepth([])).toBe(0);
  });

  it("counts a single prompt as depth 1", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
      ] as SpecificEditEvidenceRef[]),
    ).toBe(1);
  });

  it("awards the multi-prompt bonus", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
        { type: "prompt", promptId: "p2" },
      ] as SpecificEditEvidenceRef[]),
    ).toBe(2);
  });

  it("counts distinct grounding categories", () => {
    expect(
      computeEvidenceDepth([
        { type: "prompt", promptId: "p1" },
        { type: "owned_page", pageId: "pg1" },
        { type: "competitor", competitorId: "c1" },
      ] as unknown as SpecificEditEvidenceRef[]),
    ).toBe(3);
  });

  it("caps categories, not raw counts (duplicates in one category add nothing)", () => {
    expect(
      computeEvidenceDepth([
        { type: "owned_page", pageId: "pg1" },
        { type: "owned_page", pageId: "pg2" },
        { type: "owned_page", pageId: "pg3" },
      ] as unknown as SpecificEditEvidenceRef[]),
    ).toBe(1);
  });
});
