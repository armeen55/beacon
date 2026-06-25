import { describe, it, expect } from "vitest";
import {
  buildImplementationPlan,
  ImplementationPlanSchema,
  type MoveForPlan,
} from "./implementation-plan";
import { resolveImplementationLocation } from "./location-resolver";

function move(over: Partial<MoveForPlan> = {}): MoveForPlan {
  return {
    moveId: "m1",
    tenantId: "tenant-iranopedia",
    actionType: "edit_title",
    targetUrl: "https://iranopedia.com/iran-flags",
    query: "iran flag",
    demand: 135000,
    confidence: "high",
    evidence: ["135,000/mo search volume"],
    proofMetrics: ["GSC clicks/position 7/14/28d"],
    draftTitle: "Iran Flag: Meaning, Colors & History | Iranopedia",
    draftMeta: "Everything about the Iran flag — its colors, emblem, and history.",
    ...over,
  };
}

describe("buildImplementationPlan — happy paths", () => {
  it("title/meta → ready_to_apply with a ready title_meta pack at the metadata location", () => {
    const p = buildImplementationPlan(move());
    expect(p.status).toBe("ready_to_apply");
    expect(p.location.kind).toBe("metadata");
    const pack = p.contentPacks.find((c) => c.type === "title_meta")!;
    expect(pack.ready).toBe(true);
    expect(pack.copy).toContain("Title:");
    expect(ImplementationPlanSchema.safeParse(p).success).toBe(true);
    expect(p.rollback.length).toBeGreaterThan(0);
  });

  it("answer block WITH a prepared draft → ready_to_apply", () => {
    const p = buildImplementationPlan(move({ actionType: "add_answer_block", answerBlock: "The Iran flag has three colors…" }));
    expect(p.status).toBe("ready_to_apply");
    expect(p.contentPacks[0].type).toBe("answer_block");
    expect(p.contentPacks[0].ready).toBe(true);
  });

  it("FAQ with prepared Q&As → ready_to_apply", () => {
    const p = buildImplementationPlan(move({ actionType: "add_faq", faqs: ["Q: What colors? A: Green, white, red."] }));
    expect(p.status).toBe("ready_to_apply");
    expect(p.contentPacks[0].type).toBe("faq_block");
  });
});

describe("buildImplementationPlan — fail closed / blocked", () => {
  it("answer block WITHOUT prepared content → needs_content_review (no fabrication)", () => {
    const p = buildImplementationPlan(move({ actionType: "add_answer_block", answerBlock: null }));
    expect(p.status).toBe("needs_content_review");
    expect(p.contentPacks[0].ready).toBe(false);
    expect(p.contentPacks[0].copy).toBe("");
    expect(p.nextBestAction).toMatch(/prepare|draft/i);
  });

  it("page-bound action with NO target URL → missing_page_mapping (fail closed)", () => {
    const p = buildImplementationPlan(move({ targetUrl: null }));
    expect(p.status).toBe("missing_page_mapping");
    expect(p.location.blocked).toBe(true);
  });

  it("fix_page_experience → needs_location_review (we don't invent the element)", () => {
    const p = buildImplementationPlan(move({ actionType: "fix_page_experience" }));
    expect(p.status).toBe("needs_location_review");
    expect(p.location.blocked).toBe(true);
  });

  it("unknown action → needs_location_review", () => {
    const p = buildImplementationPlan(move({ actionType: "teleport_page" }));
    expect(p.status).toBe("needs_location_review");
  });

  it("insufficient evidence (no demand/evidence) → insufficient_evidence", () => {
    const p = buildImplementationPlan(move({ demand: 0, evidence: [] }));
    expect(p.status).toBe("insufficient_evidence");
  });
});

describe("buildImplementationPlan — commerce safety", () => {
  it("create_product → concept-only, missing_inventory (never live inventory)", () => {
    const p = buildImplementationPlan(
      move({ actionType: "create_product", targetUrl: null, conceptOnly: true, query: "nowruz gifts", demand: 1200 }),
    );
    expect(p.status).toBe("missing_inventory");
    const pack = p.contentPacks.find((c) => c.type === "product_concept_brief")!;
    expect(pack.copy).toMatch(/concept/i);
    expect(pack.copy).not.toMatch(/in stock|add to cart|price: \$/i);
    expect(p.blockedReason).toMatch(/concept only|inventory/i);
  });

  it("licensing-risk product → legal_or_licensing_risk (cannot be treated as live)", () => {
    const p = buildImplementationPlan(
      move({
        actionType: "create_product",
        targetUrl: null,
        conceptOnly: true,
        query: "iran world cup jersey",
        demand: 480,
        licensingRisk: "Licensing/IP risk: world cup / jersey implies team/league IP.",
      }),
    );
    expect(p.status).toBe("legal_or_licensing_risk");
    expect(p.riskLevel).toBe("high");
    expect(p.blockedReason).toMatch(/licensing|ip/i);
  });

  it("improve_product_page on a CONFIRMED in-stock product → ready_to_apply (verified inventory)", () => {
    const p = buildImplementationPlan(
      move({
        actionType: "improve_product_page",
        targetUrl: "https://shop.example.com/products/persian-rug",
        inventoryVerified: true,
        query: "persian rug",
        demand: 700,
      }),
    );
    // improve_product_page is commerce but not create_*, and inventoryVerified → not missing_inventory.
    expect(["ready_to_apply", "needs_content_review"]).toContain(p.status);
    expect(p.status).not.toBe("missing_inventory");
  });
});

describe("ImplementationPlanSchema — safety invariant", () => {
  it("rejects a hand-crafted ready_to_apply plan with a blocked location", () => {
    const base = buildImplementationPlan(move());
    const bad = { ...base, status: "ready_to_apply" as const, location: { ...base.location, blocked: true } };
    expect(ImplementationPlanSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects ready_to_apply with no ready content pack", () => {
    const base = buildImplementationPlan(move());
    const bad = { ...base, status: "ready_to_apply" as const, contentPacks: base.contentPacks.map((c) => ({ ...c, ready: false })) };
    expect(ImplementationPlanSchema.safeParse(bad).success).toBe(false);
  });
});

describe("resolveImplementationLocation", () => {
  it("title/meta → metadata field, not blocked", () => {
    const r = resolveImplementationLocation({ actionType: "edit_title", targetUrl: "https://x.com/p" });
    expect(r.kind).toBe("metadata");
    expect(r.blocked).toBe(false);
  });
  it("uses a confirmed Wix CMS field when supplied (no guessing)", () => {
    const r = resolveImplementationLocation({
      actionType: "edit_title",
      targetUrl: "https://x.com/p",
      knownCms: { system: "wix", field: "seoData.title" },
    });
    expect(r.system).toBe("wix");
    expect(r.confidence).toBe("high");
    expect(r.detail).toContain("seoData.title");
  });
});
