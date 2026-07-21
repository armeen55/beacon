/**
 * Pins the pure util that survived the deletion of the
 * /recommendations table builder (CORE 100K Lane D, 2026-07-21):
 *
 *   - actionRowTypeForEdit: the ActionType -> ActionRowType mapping the QA
 *     layer keys push readiness off (paste_ready vs review_only).
 */

import { describe, it, expect } from "vitest";
import { actionRowTypeForEdit } from "./recommendation-action-rows";

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
