/**
 * Architecture invariant — MT-3C pure-helper config injection
 * (2026-05-23).
 *
 * MT-3B threaded tenant-resolved config into every runtime caller of the
 * business-config pure helpers. MT-3C tightens THREE of the five pure
 * helpers to REQUIRE an injected `config` (dropping their
 * `?? getBusinessConfig()` no-arg fallback):
 *   • getSectionAnalyzerConfig(config: BusinessConfig)
 *   • getFaqTemplates(config: BusinessConfig)
 *   • isDirectoryDomain(domain: string, config: BusinessConfig)
 *
 * DEFERRED (still `config?` with the fallback): getLocationRegex /
 * getServiceRegex — their only runtime caller is the pure page extractor
 * (`pages/extractor.ts`), which uses a `require()` + inline-default
 * pattern and has no config/tenantId in scope. Threading config into
 * `extractPageSnapshot` ripples into the scan pipeline, so it's a
 * separate slice (MT-3C.2). Until then they keep the optional fallback.
 *
 * This invariant pins both the tightening (3 helpers require config + no
 * longer fall back) AND the deferral (2 helpers still optional), and
 * verifies the 3 work with injected config.
 *
 * Protects Customer 2: a regression that re-adds a no-arg fallback to a
 * tightened helper (re-introducing a process-global read) trips here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getBusinessConfig,
  getSectionAnalyzerConfig,
  getFaqTemplates,
  isDirectoryDomain,
} from "@/lib/business-config";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CORE = readFileSync(
  resolve(REPO_ROOT, "src", "lib", "business-config.ts"),
  "utf-8",
);

describe("business-config-pure-helpers-require-config (MT-3C)", () => {
  describe("tightened helpers require config (no optional, no no-arg fallback)", () => {
    it("getSectionAnalyzerConfig signature requires config", () => {
      expect(
        /export function getSectionAnalyzerConfig\(config:\s*BusinessConfig\)/.test(
          CORE,
        ),
      ).toBe(true);
      expect(CORE.includes("getSectionAnalyzerConfig(config?")).toBe(false);
    });

    it("getFaqTemplates signature requires config", () => {
      expect(
        /export function getFaqTemplates\(config:\s*BusinessConfig\)/.test(CORE),
      ).toBe(true);
      expect(CORE.includes("getFaqTemplates(config?")).toBe(false);
    });

    it("isDirectoryDomain signature requires config", () => {
      expect(
        /export function isDirectoryDomain\(domain:\s*string,\s*config:\s*BusinessConfig\)/.test(
          CORE,
        ),
      ).toBe(true);
      expect(CORE.includes("isDirectoryDomain(domain: string, config?")).toBe(
        false,
      );
    });
  });

  it("exactly TWO `?? getBusinessConfig()` fallbacks remain (the deferred getLocationRegex + getServiceRegex)", () => {
    const matches = CORE.match(/\?\?\s*getBusinessConfig\(\)/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("the deferred helpers keep their optional config fallback (extractor slice MT-3C.2)", () => {
    expect(CORE.includes("getLocationRegex(config?: BusinessConfig)")).toBe(
      true,
    );
    expect(CORE.includes("getServiceRegex(config?: BusinessConfig)")).toBe(
      true,
    );
  });

  describe("behavioral — the 3 tightened helpers work with injected config", () => {
    const cfg = getBusinessConfig(process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder");

    it("getSectionAnalyzerConfig returns a shape derived from the injected config", () => {
      const out = getSectionAnalyzerConfig(cfg);
      expect(out).toHaveProperty("urlPatterns");
      expect(out).toHaveProperty("stripWords");
      expect(out).toHaveProperty("industryThemes");
    });

    it("getFaqTemplates returns an array from the injected config", () => {
      expect(Array.isArray(getFaqTemplates(cfg))).toBe(true);
    });

    it("isDirectoryDomain uses the injected config's directoryDomains", () => {
      const injected = {
        ...cfg,
        directoryDomains: ["example-directory.test"],
      };
      expect(isDirectoryDomain("example-directory.test", injected)).toBe(true);
      expect(isDirectoryDomain("not-a-directory.test", injected)).toBe(false);
    });
  });
});
