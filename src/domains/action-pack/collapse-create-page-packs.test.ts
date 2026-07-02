import { describe, it, expect } from "vitest";
import { collapseCreateContentPacks } from "./adapters";
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
  forecast: null,
  origin: "rank_revenue",
  evidenceHash: "h",
  ...o,
});

describe("collapseCreateContentPacks — cross-source create_new_page canonicalization", () => {
  it("collapses identical-token-set create_new_page packs from different sources into one", () => {
    const { packs, removed } = collapseCreateContentPacks(
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
    const { packs, removed } = collapseCreateContentPacks(
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
    const { packs } = collapseCreateContentPacks(
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
    const { packs } = collapseCreateContentPacks(
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

describe("collapseCreateContentPacks — create_hub canonicalization (hub↔hub only)", () => {
  it("collapses same-comparison hub packs phrased differently into one", () => {
    const { packs, removed } = collapseCreateContentPacks(
      [
        pack({ id: "h1", label: "What is the difference between Persian and Arabic", actionType: "create_hub", priorityScore: 200, profoundReceipt: { topPrompt: "difference between persian and arabic", promptCount: 1, fanoutCount: 3, citedDomains: [], ownAbsent: true } }),
        pack({ id: "h2", label: "What's the difference between Arabic and Persian", actionType: "create_hub", priorityScore: 150, profoundReceipt: { topPrompt: "difference between arabic and persian", promptCount: 1, fanoutCount: 9, citedDomains: [], ownAbsent: true } }),
      ],
      [],
    );
    const hubs = packs.filter((p) => p.actionType === "create_hub");
    expect(hubs.length).toBe(1);
    expect(removed).toBe(1);
    expect(hubs[0].id).toBe("h1"); // higher priorityScore wins
    expect(hubs[0].canonicalGroup?.alsoCovers.length).toBe(1);
    // richest profound receipt kept (h2 has more fan-outs)
    expect(hubs[0].profoundReceipt?.fanoutCount).toBe(9);
  });

  it("does NOT merge a hub with a page even when they share a token set", () => {
    const { packs, removed } = collapseCreateContentPacks(
      [
        pack({ id: "hub", label: "Persian Wedding", actionType: "create_hub" }),
        pack({ id: "page", label: "Persian Wedding", actionType: "create_new_page" }),
      ],
      [],
    );
    // distinct action types are grouped in separate buckets → never merge
    expect(removed).toBe(0);
    expect(packs.filter((p) => p.actionType === "create_hub").length).toBe(1);
    expect(packs.filter((p) => p.actionType === "create_new_page").length).toBe(1);
  });

  it("keeps distinct comparison hubs separate (different token sets)", () => {
    const { packs, removed } = collapseCreateContentPacks(
      [
        pack({ id: "a", label: "Difference between Farsi and Persian", actionType: "create_hub" }),
        pack({ id: "b", label: "Difference between Persian and Arabic", actionType: "create_hub" }),
      ],
      [],
    );
    expect(removed).toBe(0);
    expect(packs.filter((p) => p.actionType === "create_hub").length).toBe(2);
  });

  it("collapses pages AND hubs in the same call, independently", () => {
    const { packs } = collapseCreateContentPacks(
      [
        pack({ id: "pw", label: "Persian Wedding", actionType: "create_new_page" }),
        pack({ id: "iw", label: "Iranian Wedding", actionType: "create_new_page" }),
        pack({ id: "h1", label: "Common Persian Superstitions", actionType: "create_hub" }),
        pack({ id: "h2", label: "Common Persian Superstitions", actionType: "create_hub" }),
      ],
      [],
    );
    expect(packs.filter((p) => p.actionType === "create_new_page").length).toBe(1);
    expect(packs.filter((p) => p.actionType === "create_hub").length).toBe(1);
  });
});
