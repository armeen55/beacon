import { describe, it, expect } from "vitest";
import { buildWinnersPanel, collectedDateLabel, type WinnerAudit } from "./winners-panel";

const RICH_FACTS: WinnerAudit["facts"] = {
  hasAnswerBlock: true,
  hasFaq: true,
  faqQuestionCount: 4,
  schemaTypes: ["FAQPage"],
  hasToolOrCalculator: false,
  wordCount: 1800,
  sectionCount: 6,
  hasReviewSchema: false,
};

describe("collectedDateLabel", () => {
  it("formats a real ISO timestamp as 'read <Mon D>'", () => {
    expect(collectedDateLabel("2026-07-10T12:00:00Z")).toBe("read Jul 10");
  });
  it("never fabricates a date for missing/unparseable input", () => {
    expect(collectedDateLabel(null)).toBeNull();
    expect(collectedDateLabel(undefined)).toBeNull();
    expect(collectedDateLabel("not-a-date")).toBeNull();
  });
});

describe("buildWinnersPanel", () => {
  it("ranks overlap first with the Google+AI badge data, plain-word signals, and the cached collected date", () => {
    const out = buildWinnersPanel({
      competitorUrls: ["https://theknot.com/persian-wedding", "https://aionly.com/x"],
      serpTopDomains: ["theknot.com", "googleonly.com"],
      ownDomain: "iranopedia.com",
      getAudit: (url) =>
        url.includes("theknot.com") ? { facts: RICH_FACTS, auditedAt: "2026-07-10T09:00:00Z" } : undefined,
    });

    expect(out[0].domain).toBe("theknot.com");
    expect(out[0].overlap).toBe(true);
    expect(out[0].sources).toEqual(["ai", "google"]);
    expect(out[0].whyPlain).toBe("a direct answer at the top, an FAQ section (4 questions), structured data (schema)");
    expect(out[0].collectedLabel).toBe("read Jul 10");

    const aiOnly = out.find((w) => w.domain === "aionly.com")!;
    expect(aiOnly.overlap).toBe(false);
    expect(aiOnly.sources).toEqual(["ai"]);
    // Never audited -> never fabricate a "why" or a collected date.
    expect(aiOnly.whyPlain).toBeNull();
    expect(aiOnly.collectedLabel).toBeNull();

    const googleOnly = out.find((w) => w.domain === "googleonly.com")!;
    expect(googleOnly.overlap).toBe(false);
    expect(googleOnly.sources).toEqual(["google"]);
    expect(googleOnly.whyPlain).toBeNull();
  });

  it("caps at 5 winners even with many candidates", () => {
    const competitorUrls = Array.from({ length: 8 }, (_, i) => `https://rival${i}.com/page`);
    const out = buildWinnersPanel({
      competitorUrls,
      serpTopDomains: [],
      ownDomain: "me.com",
      getAudit: () => undefined,
    });
    expect(out.length).toBe(5);
  });

  it("returns [] with no competitor URLs and no Google domains (caller renders nothing, never an empty panel)", () => {
    const out = buildWinnersPanel({
      competitorUrls: [],
      serpTopDomains: [],
      ownDomain: "me.com",
      getAudit: () => undefined,
    });
    expect(out).toEqual([]);
  });

  it("folds two AI-cited URLs on the same root domain into ONE winner line", () => {
    const out = buildWinnersPanel({
      competitorUrls: ["https://rival.com/a", "https://rival.com/b"],
      serpTopDomains: [],
      ownDomain: "me.com",
      getAudit: () => undefined,
    });
    expect(out.length).toBe(1);
    expect(out[0].domain).toBe("rival.com");
  });

  it("excludes the tenant's own domain from the winner list", () => {
    const out = buildWinnersPanel({
      competitorUrls: ["https://me.com/self"],
      serpTopDomains: ["me.com", "rival.com"],
      ownDomain: "me.com",
      getAudit: () => undefined,
    });
    expect(out.find((w) => w.domain === "me.com")).toBeUndefined();
    expect(out.find((w) => w.domain === "rival.com")).toBeDefined();
  });

  it("two tenants in the same process never leak evidence into each other's panel", () => {
    const tenantA = buildWinnersPanel({
      competitorUrls: ["https://a-rival.com/x"],
      serpTopDomains: ["a-rival.com"],
      ownDomain: "tenant-a.com",
      getAudit: (url) => (url.includes("a-rival.com") ? { facts: RICH_FACTS, auditedAt: "2026-07-01T00:00:00Z" } : undefined),
    });
    const tenantB = buildWinnersPanel({
      competitorUrls: ["https://b-rival.com/y"],
      serpTopDomains: [],
      ownDomain: "tenant-b.com",
      getAudit: () => undefined,
    });

    expect(tenantA.map((w) => w.domain)).toEqual(["a-rival.com"]);
    expect(tenantA[0].whyPlain).not.toBeNull();
    expect(tenantB.map((w) => w.domain)).toEqual(["b-rival.com"]);
    expect(tenantB[0].whyPlain).toBeNull();
    // Neither tenant's own domain leaked into the other's result.
    expect(tenantA.find((w) => w.domain === "tenant-b.com")).toBeUndefined();
    expect(tenantB.find((w) => w.domain === "tenant-a.com")).toBeUndefined();
  });
});
