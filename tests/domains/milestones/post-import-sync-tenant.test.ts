import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  join(process.cwd(), "src/domains/milestones/post-import-sync.ts"),
  "utf8",
);

describe("post-import milestone tenant identity", () => {
  it("uses the current tenant business config for owned-domain attribution", () => {
    expect(SOURCE).toContain("getBusinessConfigForCurrentTenant()");
    expect(SOURCE).toContain("const siteDomain = businessConfig.domain");
    expect(SOURCE).not.toContain("getSiteConfig");
  });

  it("loads independent import evidence without a sequential waterfall", () => {
    expect(SOURCE).toMatch(
      /Promise\.all\(\[[\s\S]*getBusinessConfigForCurrentTenant\(\)[\s\S]*getCitationEvidenceIndex\(\)[\s\S]*getResults\(\)/,
    );
  });
});
