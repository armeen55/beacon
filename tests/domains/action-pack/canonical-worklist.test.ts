import { describe, it, expect } from "vitest";
import { familyBucketOf } from "@/domains/action-pack/load-canonical-worklist";
import type { ActionType } from "@/domains/action-pack/types";

describe("canonical worklist family bucketing", () => {
  it("maps every ActionType to exactly one render family", () => {
    const cases: Array<[ActionType, string]> = [
      ["edit_existing_page", "existingPageFixes"],
      ["add_answer_block", "answerBlocks"],
      ["create_new_page", "newPages"],
      ["create_hub", "hubs"],
      ["add_internal_links", "internalLinks"],
      ["consolidate_pages", "internalLinks"],
      ["fix_title_meta_ctr", "titleMetaFixes"],
      ["fix_conversion_friction", "experienceFixes"],
    ];
    for (const [a, fam] of cases) expect(familyBucketOf(a)).toBe(fam);
  });
});
