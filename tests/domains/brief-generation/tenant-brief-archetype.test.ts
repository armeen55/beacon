import { describe, expect, it } from "vitest";
import { deriveOpportunityBriefType } from "@/domains/brief-generation/builders";
import { getTemplate } from "@/domains/brief-generation/templates";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const templateContext = {
  targetCity: "Tehran",
  targetTopic: "history of Tehran",
  patternLabel: null,
  patternSuccessRate: null,
  opportunityLabel: "History of Tehran",
  hasCaveats: false,
  caveats: [],
};

describe("tenant-aware proposed brief archetypes", () => {
  it("does not turn an editorial city subject into a local-service expansion", () => {
    expect(deriveOpportunityBriefType("Tehran", "content_publisher")).toBe(
      "new_page",
    );
    expect(deriveOpportunityBriefType("Tehran", "saas")).toBe("new_page");
    expect(deriveOpportunityBriefType("Tehran")).toBe("new_page");
  });

  it("keeps city expansion only for an explicitly local-service tenant", () => {
    expect(deriveOpportunityBriefType("Atherton", "local_service")).toBe(
      "coverage_expansion",
    );
    expect(deriveOpportunityBriefType(null, "local_service")).toBe("new_page");
  });

  it("keeps the neutral new-page template free of mandatory local-business proof", () => {
    const template = getTemplate("new_page", templateContext);
    const text = JSON.stringify(template);
    expect(text).not.toMatch(/accurate NAP|areaServed|local proof points|doorway-page/i);
    expect(text).toContain("Article");
  });

  it("threads the current tenant business type from the active Proposed Briefs page", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(shell)/briefs/proposed/page.tsx"),
      "utf8",
    );
    expect(source).toMatch(/currentTenantId\(\)/);
    expect(source).toMatch(/getBusinessConfig\(tenantId\)\.businessType/);
  });
});
