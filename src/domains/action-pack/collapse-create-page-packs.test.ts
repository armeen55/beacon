import { describe, it, expect } from "vitest";
import { collapseCreatePagePacks } from "./adapters";
import type { ActionPack, ActionType } from "./types";

const pack = (o: Partial<ActionPack> & { id: string; label: string; actionType: ActionType }): ActionPack => ({
  tenantId: "t",
  targetUrl: null,
  newPageSlug: null,
  priorityScore: 1,
  confidence: "medium",
  evidenceSources: [],
  gscDemand: null,
  ga4Value: null,
  clarityFriction: null,
  profoundReceipt: null,
  dataforseoValidation: null,
  competitorPagesToBeat: [],
  draftStatus: "none",
  proofPlan: null,
  whyNotNoise: "",
  origin: "rank_revenue",
  evidenceHash: "h",
  ...o,
});

describe("collapseCreatePagePacks — cross-source create_new_page canonicalization", () => {
  it("collapses identical-token-set create_new_page packs from different sources into one", () => {
    const { packs, removed } = collapseCreatePagePacks(
      [
        pack({ id: "rr:wed", label: "Persian Wedding", actionType: "create_new_page", origin: "rank_revenue", priorityScore: 80, competitorPagesToBeat: ["https://theknot.com/x"] }),
        pack({ id: "cov:wed", label: "Iranian Wedding", actionType: "create_new_page", origin: "profound_coverage", priorityScore: 60, competitorPagesToBeat: ["https://brides.com/y"] }),
      ],
      [],
    );
    const creates = packs.filter((p) => p.actionType === "create_new_page");
    expect(creates.length).toBe(1);
    expect(removed).toBe(1);
    expect(creates[0].canonicalGroup?.alsoCovers).toContain("Iranian Wedding");
    // canonical absorbs the sibling's competitor target
    expect(creates[0].competitorPagesToBeat).toEqual(expect.arrayContaining(["https://theknot.com/x", "https://brides.com/y"]));
  });

  it("keeps distinct create_new_page topics separate", () => {
    const { packs, removed } = collapseCreatePagePacks(
      [
        pack({ id: "a", label: "Persian Gardens", actionType: "create_new_page" }),
        pack({ id: "b", label: "Persian Mythology", actionType: "create_new_page" }),
      ],
      [],
    );
    expect(packs.filter((p) => p.actionType === "create_new_page").length).toBe(2);
    expect(removed).toBe(0);
  });

  it("never touches non-create_new_page packs", () => {
    const { packs } = collapseCreatePagePacks(
      [
        pack({ id: "edit", label: "Edit cities", actionType: "edit_existing_page" }),
        pack({ id: "rr:wed", label: "Persian Wedding", actionType: "create_new_page" }),
        pack({ id: "cov:wed", label: "Iranian Wedding", actionType: "create_new_page" }),
      ],
      [],
    );
    expect(packs.find((p) => p.id === "edit")).toBeTruthy();
    expect(packs.filter((p) => p.actionType === "edit_existing_page").length).toBe(1);
    expect(packs.filter((p) => p.actionType === "create_new_page").length).toBe(1);
  });

  it("the higher-opportunity (priorityScore) pack survives as canonical", () => {
    const { packs } = collapseCreatePagePacks(
      [
        pack({ id: "lo", label: "Persian Wedding", actionType: "create_new_page", priorityScore: 30 }),
        pack({ id: "hi", label: "Iranian Wedding", actionType: "create_new_page", priorityScore: 90 }),
      ],
      [],
    );
    const creates = packs.filter((p) => p.actionType === "create_new_page");
    expect(creates.length).toBe(1);
    // priorityScore is the opportunity tiebreaker → the 90 pack wins (verdict/volume/brief equal)
    expect(creates[0].id).toBe("hi");
    expect(creates[0].canonicalGroup?.alsoCovers).toContain("Persian Wedding");
  });
});
