/**
 * Architecture invariant — MT-3C / MT-3C.2 pure-helper config injection
 * (2026-05-23).
 *
 * MT-3B threaded tenant-resolved config into every runtime caller of the
 * business-config pure helpers. MT-3C tightened three of the five pure
 * helpers to REQUIRE an injected `config`; MT-3C.2 then threaded the page
 * extractor's per-tenant config (`getBusinessConfig(tenantId)`) into the
 * last two, so now ALL FIVE require config (no `?? getBusinessConfig()`
 * fallback anywhere):
 *   • getLocationRegex(config: BusinessConfig)           [MT-3C.2]
 *   • getServiceRegex(config: BusinessConfig)            [MT-3C.2]
 *   • getSectionAnalyzerConfig(config: BusinessConfig)   [MT-3C]
 *   • getFaqTemplates(config: BusinessConfig)            [MT-3C]
 *   • isDirectoryDomain(domain: string, config: BusinessConfig) [MT-3C]
 *
 * This invariant pins all five require-config signatures, that ZERO
 * `?? getBusinessConfig()` fallbacks remain in business-config.ts, and
 * verifies the helpers work with injected config. (The deprecated no-arg
 * `getBusinessConfig()` overload still EXISTS for back-compat until MT-5,
 * but nothing inside business-config.ts falls back to it.)
 *
 * Protects Customer 2: a regression that re-adds a no-arg fallback to a
 * pure helper (re-introducing a process-global read) trips here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  getBusinessConfig,
  getLocationRegex,
  getServiceRegex,
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
  describe("all 5 pure helpers require config (no optional, no no-arg fallback)", () => {
    it("getLocationRegex signature requires config (MT-3C.2)", () => {
      expect(
        /export function getLocationRegex\(config:\s*BusinessConfig\)/.test(CORE),
      ).toBe(true);
      expect(CORE.includes("getLocationRegex(config?")).toBe(false);
    });

    it("getServiceRegex signature requires config (MT-3C.2)", () => {
      expect(
        /export function getServiceRegex\(config:\s*BusinessConfig\)/.test(CORE),
      ).toBe(true);
      expect(CORE.includes("getServiceRegex(config?")).toBe(false);
    });

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

  it("ZERO `?? getBusinessConfig()` fallbacks remain in business-config.ts (MT-3C.2)", () => {
    const matches = CORE.match(/\?\?\s*getBusinessConfig\(\)/g) ?? [];
    expect(matches.length).toBe(0);
  });

  it("the deprecated no-arg overload still EXISTS for back-compat (removed in MT-5, not here)", () => {
    expect(
      /export function getBusinessConfig\(\):\s*BusinessConfig;/.test(CORE),
    ).toBe(true);
  });

  describe("behavioral — the pure helpers work with injected config", () => {
    const cfg = getBusinessConfig(process.env.BEACON_TENANT_ID ?? "tenant-ritz-founder");

    it("getLocationRegex + getServiceRegex return RegExps from the injected config", () => {
      expect(getLocationRegex(cfg)).toBeInstanceOf(RegExp);
      expect(getServiceRegex(cfg)).toBeInstanceOf(RegExp);
    });

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
