import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const activeIdentityModules = [
  "src/domains/attribution/compute.ts",
  "src/domains/attribution/candidates.ts",
  "src/domains/pages/evidence-tier.ts",
  "src/domains/pages/classify.ts",
  "src/domains/pages/citation-index.ts",
];

describe("attribution and ownership use explicit site identity", () => {
  it("cannot import the process-global site config", () => {
    for (const path of activeIdentityModules) {
      const source = readFileSync(resolve(root, path), "utf8");
      expect(source, path).not.toMatch(/getSiteConfig|@\/lib\/site-config/);
    }
  });
});
