import { describe, it, expect } from "vitest";
import { collapseCreatePageSiblings, type CollapseContext } from "./collapse-create-page-siblings";
import type { MoveCandidate } from "./build-graph";

// Minimal MoveCandidate (the post-pass only reads gap/label/demandKey/competitorUrls/
// fanoutSeeds/aeoEvidence); the rest is filler cast to satisfy the type.
const mv = (o: Partial<MoveCandidate> & { demandKey: string; label: string; gap: MoveCandidate["gap"] }): MoveCandidate => ({
  score: 1,
  components: { demand: 1, winnability: 1, dollarValue: 0, visibilityGap: 1, friction: 0 } as MoveCandidate["components"],
  confidence: "medium",
  signals: [],
  ownedUrl: null,
  competitorUrls: [],
  fanoutSeeds: [],
  rationale: "",
  ...o,
});

const EMPTY: CollapseContext = { keywords: [], drafts: new Map() };

describe("collapseCreatePageSiblings — upstream create_page dedup post-pass", () => {
  it("collapses identical-token-set siblings (Persian/Iranian Wedding) into ONE canonical move", () => {
    const out = collapseCreatePageSiblings(
      [
        mv({ demandKey: "gap:wedding-a", label: "Persian Wedding", gap: "create_page", competitorUrls: ["https://theknot.com/persian"] }),
        mv({ demandKey: "gap:wedding-b", label: "Iranian Wedding", gap: "create_page", competitorUrls: ["https://brides.com/iranian"] }),
      ],
      EMPTY,
    );
    const creates = out.filter((m) => m.gap === "create_page");
    expect(creates.length).toBe(1);
    expect(creates[0].canonicalGroup?.alsoCovers.length).toBe(1);
    // teardown coverage preserved across the merge
    expect(creates[0].competitorUrls).toEqual(expect.arrayContaining(["https://theknot.com/persian", "https://brides.com/iranian"]));
  });

  it("leaves non-create_page moves untouched and in place", () => {
    const out = collapseCreatePageSiblings(
      [
        mv({ demandKey: "edit-1", label: "Edit the cities page", gap: "edit_page" }),
        mv({ demandKey: "gap:wedding-a", label: "Persian Wedding", gap: "create_page" }),
        mv({ demandKey: "gap:wedding-b", label: "Iranian Wedding", gap: "create_page" }),
      ],
      EMPTY,
    );
    expect(out.find((m) => m.demandKey === "edit-1")).toBeTruthy();
    expect(out.filter((m) => m.gap === "edit_page").length).toBe(1);
    expect(out.filter((m) => m.gap === "create_page").length).toBe(1);
  });

  it("does NOT merge distinct topics and attaches no canonicalGroup to singletons", () => {
    const out = collapseCreatePageSiblings(
      [
        mv({ demandKey: "gap:garden", label: "Persian Gardens", gap: "create_page" }),
        mv({ demandKey: "gap:myth", label: "Persian Mythology", gap: "create_page" }),
      ],
      EMPTY,
    );
    expect(out.filter((m) => m.gap === "create_page").length).toBe(2);
    expect(out.every((m) => m.canonicalGroup == null)).toBe(true);
  });

  it("returns the input unchanged when there are <2 create_page moves", () => {
    const moves = [mv({ demandKey: "gap:solo", label: "Persian Astronomy", gap: "create_page" })];
    const out = collapseCreatePageSiblings(moves, EMPTY);
    expect(out.length).toBe(1);
    expect(out[0].canonicalGroup).toBeUndefined();
  });

  it("inherits a sibling's passing brief onto the canonical only for a high-confidence (same-keyword) group", () => {
    const keywords = [{ keyword: "persian wedding", searchVolume: 1900, source: "dataforseo", fetchedAt: "2026-06-29" } as CollapseContext["keywords"][number]];
    const drafts = new Map<string, { content: string }>([
      // sibling has a passing brief; canonical does not
      ["gap:wedding-b::create_page_brief", { content: JSON.stringify({ proposedTitle: "Iranian Wedding Traditions and Customs Explained", metaDescription: "A clear guide to the ceremonies, sofreh aghd, and customs of an Iranian wedding for guests and couples planning one.", openingAnswer: "An Iranian wedding blends the aghd ceremony and the jashn celebration, centered on the symbolic sofreh aghd spread that represents the couple's shared future and family blessings.", outline: ["The aghd ceremony", "The sofreh aghd spread", "The jashn reception", "Modern adaptations"], faqQuestions: ["What is a sofreh aghd?", "How long is the ceremony?"], schemaTypes: ["Article", "FAQPage"] }) }],
      ["gap:wedding-b::serp_verdict", { content: JSON.stringify({ verdict: "build" }) }],
    ]);
    const out = collapseCreatePageSiblings(
      [
        mv({ demandKey: "gap:wedding-a", label: "Persian Wedding", gap: "create_page" }),
        mv({ demandKey: "gap:wedding-b", label: "Iranian Wedding", gap: "create_page" }),
      ],
      { keywords, drafts },
    );
    const canon = out.find((m) => m.gap === "create_page");
    // wedding-b carries the brief; it becomes canonical (has-passing-brief outranks).
    expect(canon?.demandKey).toBe("gap:wedding-b");
    // token-set merge alone = medium → no inheritance pointer needed (canonical owns the brief)
    expect(canon?.canonicalGroup?.alsoCovers).toContain("Persian Wedding");
  });
});
