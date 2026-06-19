import { describe, it, expect } from "vitest";
import { classifyContentSchemaType } from "./draft-enrichment";
import type { PageSnapshot } from "@/domains/pages/types";

// Minimal snapshot factory — only the fields the classifier reads.
function snap(partial: Partial<PageSnapshot>): PageSnapshot {
  return {
    h2_list: [],
    ...partial,
  } as PageSnapshot;
}

describe("classifyContentSchemaType (content-aware schema @type)", () => {
  it("detects a recipe page from ingredients + steps headings (generic, any cuisine)", () => {
    expect(
      classifyContentSchemaType(
        snap({ h2_list: ["Ingredients", "Instructions"] }),
        "Joojeh Kabob",
      ),
    ).toBe("recipe");
    expect(
      classifyContentSchemaType(
        snap({ h2_list: ["What you need"], h3_list: ["Ingredients", "Method"] }),
        "Beef Bourguignon",
      ),
    ).toBe("recipe");
  });

  it("does NOT call it a recipe when only ingredients OR only steps are present", () => {
    expect(
      classifyContentSchemaType(snap({ h2_list: ["Ingredients"] }), "X"),
    ).toBe("article");
    expect(
      classifyContentSchemaType(snap({ h2_list: ["Instructions"] }), "X"),
    ).toBe("article");
  });

  it("detects a ranked list from a best/top headline + a multi-item body", () => {
    expect(
      classifyContentSchemaType(
        snap({ h2_list: ["Place A", "Place B", "Place C", "Place D"] }),
        "The Best Persian Restaurants in Washington",
      ),
    ).toBe("list");
    expect(
      classifyContentSchemaType(
        snap({ card_texts: ["1", "2", "3"] }),
        "Top 10 Iranian Films",
      ),
    ).toBe("list");
  });

  it("does NOT call it a list when the body has too few items", () => {
    expect(
      classifyContentSchemaType(
        snap({ h2_list: ["Only section"] }),
        "The Best Persian Restaurants",
      ),
    ).toBe("article");
  });

  it("defaults to article for an ordinary explainer page", () => {
    expect(
      classifyContentSchemaType(
        snap({ h2_list: ["History", "Meaning", "Today"] }),
        "Iran Flag: Meaning, Colors, and History",
      ),
    ).toBe("article");
  });
});
