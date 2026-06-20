import { describe, expect, it } from "vitest";
import {
  actionLabel,
  estClicksLabel,
  estimateConfidence,
  resolvePagePrimary,
  REVIEW_HREF,
} from "./page-primary";
import type { PageSurgeonSummary } from "@/domains/recommendation-intelligence/page-surgeon/change-pack";

const pack: PageSurgeonSummary = {
  hasPack: true,
  pageUrl: "https://www.iranopedia.com/cities",
  path: "/cities",
  qaPass: true,
  factCheckRequired: false,
  headlineAction: "title",
  reviewVerdict: null,
  reviewNote: null,
};

describe("resolvePagePrimary — precedence", () => {
  it("Change Pack wins: pack primary + 'Review Change Pack'", () => {
    const p = resolvePagePrimary({ summary: pack });
    expect(p.source).toBe("change_pack");
    expect(p.hasPack).toBe(true);
    expect(p.headline).toBe("Rewrite the title");
    expect(p.cta.label).toBe("Review Change Pack");
    expect(p.cta.href).toBe(REVIEW_HREF);
  });

  it("no pack ⇒ diagnosis: lever headline + 'Run Deep Audit'", () => {
    const p = resolvePagePrimary({
      opportunity: { expectedLever: "Rewrite the title + meta to match intent.", why: "Under-clicked." },
    });
    expect(p.source).toBe("diagnosis");
    expect(p.hasPack).toBe(false);
    expect(p.headline).toContain("Rewrite the title");
    expect(p.cta.label).toBe("Run Deep Audit");
  });

  it("no pack + no diagnosis ⇒ legacy headline (Basic/quarantine)", () => {
    const p = resolvePagePrimary({ legacy: { headline: "Old saved rec" } });
    expect(p.source).toBe("legacy");
    expect(p.headline).toBe("Old saved rec");
    expect(p.cta.label).toBe("Open");
  });

  it("nothing ⇒ 'Run Deep Audit' to draft a pack (never dead-ends)", () => {
    const p = resolvePagePrimary({});
    expect(p.source).toBe("none");
    expect(p.cta.label).toBe("Run Deep Audit");
  });

  it("NEVER routes to a Workbench that doesn't exist yet", () => {
    for (const p of [
      resolvePagePrimary({ summary: pack }),
      resolvePagePrimary({ opportunity: { expectedLever: "x", why: "y" } }),
      resolvePagePrimary({ legacy: { headline: "z" } }),
      resolvePagePrimary({}),
    ]) {
      expect(p.cta.href).toBe(REVIEW_HREF);
      expect(p.cta.label.toLowerCase()).not.toContain("workbench");
    }
  });
});

describe("actionLabel", () => {
  it("maps known atomic actions to imperative copy", () => {
    expect(actionLabel("title")).toBe("Rewrite the title");
    expect(actionLabel("intro_answer_block")).toBe("Add a direct answer block");
    expect(actionLabel("schema")).toBe("Add structured data (JSON-LD)");
    expect(actionLabel("keep_current")).toBe("Healthy, monitor");
  });

  it("falls back gracefully on unknown/empty", () => {
    expect(actionLabel(null)).toBe("Review the page");
    expect(actionLabel("nonsense")).toBe("Review the page");
  });
});

describe("estimateConfidence", () => {
  it("is data-volume driven", () => {
    expect(estimateConfidence(3000)).toBe("high");
    expect(estimateConfidence(800)).toBe("medium");
    expect(estimateConfidence(799)).toBe("low");
  });
});

describe("estClicksLabel", () => {
  it("always carries window + confidence + SERP status", () => {
    const label = estClicksLabel({
      estClicksAtStake: 734,
      window: "90d",
      confidence: "medium",
      serpStatusChip: "SERP unknown",
    });
    expect(label).toBe("~734 est. clicks at stake over 90d · medium confidence · SERP unknown");
  });

  it("hides the estimate when there's nothing meaningful to show", () => {
    expect(
      estClicksLabel({ estClicksAtStake: 0, window: "90d", confidence: "low", serpStatusChip: "SERP unknown" }),
    ).toBeNull();
  });
});
