import { describe, it, expect } from "vitest";
import { linkProofRowsToActionPacks, type ProofRowLike } from "./proof-linker";
import type { ActionPack, ActionType } from "./types";

function pack(over: Partial<ActionPack> & { id: string; actionType: ActionType; targetUrl: string | null }): ActionPack {
  return {
    tenantId: "t", newPageSlug: null, label: "L", priorityScore: 1, confidence: "medium",
    evidenceSources: ["gsc"], gscDemand: null, ga4Value: null, clarityFriction: null,
    profoundReceipt: null, competitorPagesToBeat: [], draftStatus: "none", proofPlan: null,
    dataforseoValidation: null, whyNotNoise: "", origin: "rank_revenue", evidenceHash: "h",
    ...over,
  } as ActionPack;
}
function row(over: Partial<ProofRowLike> & { id: string }): ProofRowLike {
  return { page: "https://x.com/p", path: "/p", actionType: "edit_title", targetQueries: [], ...over };
}

describe("linkProofRowsToActionPacks", () => {
  it("strong-links same page + compatible family", () => {
    const packs = [pack({ id: "fix_title_meta_ctr:1", actionType: "fix_title_meta_ctr", targetUrl: "https://iranopedia.com/cities" })];
    const rows = [row({ id: "r1", page: "https://iranopedia.com/cities", path: "/cities", actionType: "edit_title" })];
    const [link] = linkProofRowsToActionPacks({ proofRows: rows, actionPacks: packs });
    expect(link.confidence).toBe("strong");
    expect(link.actionPack?.id).toBe("fix_title_meta_ctr:1");
  });

  it("weak-links same page but different family", () => {
    const packs = [pack({ id: "add_answer_block:1", actionType: "add_answer_block", targetUrl: "https://iranopedia.com/cities" })];
    const rows = [row({ id: "r1", path: "/cities", page: "https://iranopedia.com/cities", actionType: "fix_conversion_friction" })];
    const [link] = linkProofRowsToActionPacks({ proofRows: rows, actionPacks: packs });
    expect(link.confidence).toBe("weak");
  });

  it("never matches a different page (no over-match)", () => {
    const packs = [pack({ id: "p1", actionType: "fix_title_meta_ctr", targetUrl: "https://iranopedia.com/other" })];
    const rows = [row({ id: "r1", path: "/cities", page: "https://iranopedia.com/cities", actionType: "edit_title" })];
    const [link] = linkProofRowsToActionPacks({ proofRows: rows, actionPacks: packs });
    expect(link.confidence).toBe("none");
    expect(link.actionPack).toBeNull();
  });

  it("honors a stored actionPackId as exact", () => {
    const packs = [pack({ id: "p1", actionType: "edit_existing_page", targetUrl: "https://x.com/a" })];
    const rows = [row({ id: "r1", actionPackId: "p1" })];
    const [link] = linkProofRowsToActionPacks({ proofRows: rows, actionPacks: packs });
    expect(link.confidence).toBe("exact");
  });

  it("normalizes trailing slash + host when matching", () => {
    const packs = [pack({ id: "p1", actionType: "edit_existing_page", targetUrl: "https://iranopedia.com/cities/" })];
    const rows = [row({ id: "r1", path: "/cities", page: "https://iranopedia.com/cities", actionType: "edit_title" })];
    const [link] = linkProofRowsToActionPacks({ proofRows: rows, actionPacks: packs });
    expect(link.confidence).toBe("strong"); // edit_existing_page family is compatible
  });
});
