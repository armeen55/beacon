/**
 * D1 (operator audit, 2026-05-05) — business-config Ritz-fallback fix.
 *
 * Pre-D1: `business-config.ts` exported `DEFAULT_CONFIG` whose top-level
 * fields were Ritz-Builders-flavored ("Ritz Builders" name, "ritzbuilders.com"
 * domain, Bay Area cities, builder services, design-build themes). When a
 * tenant landed without an operator-curated config file, it silently rendered
 * Ritz brand in /today, /recommendations, and /settings/connectors.
 *
 * Post-D1: `getBusinessConfig()` resolves in priority order:
 *   1. `BEACON_BUSINESS_CONFIG_JSON` env var (Vercel-friendly).
 *   2. `.data/business-config.json` (top-level — legacy save target).
 *   3. `.data/global/business-config.json` (canonical store-classification path).
 *   4. `PLACEHOLDER_CONFIG` — neutral, brand-empty, `__placeholder: true`.
 *
 * These tests pin the contract:
 *   • Ritz still loads its full operator-curated config when source 2 or 3
 *     is present (no regression).
 *   • Customer-2-style env (no env var, no file) returns the placeholder
 *     with NO Ritz strings anywhere.
 *   • `isPlaceholderConfig()` correctly detects the placeholder state.
 *   • The env var override works for Vercel-style deployments.
 *   • The placeholder is structurally complete (all required fields present)
 *     so downstream consumers don't crash.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  getBusinessConfig,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
  type BusinessConfig,
} from "./business-config";
import { log } from "@/lib/logger";

const REPO_ROOT = process.cwd();
const TOP_LEVEL_PATH = join(REPO_ROOT, ".data", "business-config.json");
const GLOBAL_PATH = join(REPO_ROOT, ".data", "global", "business-config.json");

// Save + restore the on-disk state so tests don't clobber the operator's
// real Ritz config when run locally.
let savedTopLevel: string | null = null;
let savedGlobal: string | null = null;
let savedEnv: string | undefined = undefined;

beforeEach(() => {
  savedTopLevel = existsSync(TOP_LEVEL_PATH)
    ? readFileSync(TOP_LEVEL_PATH, "utf-8")
    : null;
  savedGlobal = existsSync(GLOBAL_PATH) ? readFileSync(GLOBAL_PATH, "utf-8") : null;
  savedEnv = process.env.BEACON_BUSINESS_CONFIG_JSON;
  delete process.env.BEACON_BUSINESS_CONFIG_JSON;
  __resetBusinessConfigCacheForTests();
});

afterEach(() => {
  // Restore disk state.
  if (savedTopLevel === null) {
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
  } else {
    writeFileSync(TOP_LEVEL_PATH, savedTopLevel);
  }
  if (savedGlobal === null) {
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
  } else {
    mkdirSync(join(REPO_ROOT, ".data", "global"), { recursive: true });
    writeFileSync(GLOBAL_PATH, savedGlobal);
  }
  // Restore env.
  if (typeof savedEnv === "string") {
    process.env.BEACON_BUSINESS_CONFIG_JSON = savedEnv;
  } else {
    delete process.env.BEACON_BUSINESS_CONFIG_JSON;
  }
  __resetBusinessConfigCacheForTests();
});

// ---------------------------------------------------------------------------
// 1. Ritz still loads when its config file exists
// ---------------------------------------------------------------------------

describe("D1 — Ritz tenant config loads when on-disk file exists", () => {
  it("loads Ritz config from .data/global/business-config.json when present", () => {
    // Use the operator-curated Ritz file already on disk (preserved by
    // beforeEach). Just clear the top-level path to force the global
    // path to win.
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    // Also clear cache after the file mutation.
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.name).toBe("Ritz Builders");
    expect(cfg.domain).toBe("ritzbuilders.com");
    expect(cfg.locations).toContain("Palo Alto");
    expect(cfg.services.some((s) => /custom home/i.test(s))).toBe(true);
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });

  it("loads Ritz config from .data/business-config.json (top-level) when present", () => {
    const ritzPayload: Partial<BusinessConfig> = {
      name: "Ritz Builders",
      domain: "ritzbuilders.com",
      industry: "home-builder",
      locations: ["Palo Alto", "Menlo Park"],
      services: ["custom home"],
    };
    writeFileSync(TOP_LEVEL_PATH, JSON.stringify(ritzPayload));
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.name).toBe("Ritz Builders");
    expect(cfg.domain).toBe("ritzbuilders.com");
    expect(cfg.locations).toEqual(["Palo Alto", "Menlo Park"]);
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });

  it("preserves Ritz domain knowledge (stripWords, urlPatterns, faqTemplates) from the global file", () => {
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.stripWords).toBeDefined();
    expect(cfg.stripWords).toEqual(
      expect.arrayContaining(["atherton", "ritz", "builders"]),
    );
    expect(cfg.urlPatterns).toBeDefined();
    expect(cfg.urlPatterns?.city).toBe("/locations/");
    expect(cfg.faqTemplates).toBeDefined();
    expect(cfg.faqTemplates!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Customer-2 / unknown tenant → neutral placeholder, NO Ritz strings
// ---------------------------------------------------------------------------

describe("D1 — placeholder config when no source provides values", () => {
  beforeEach(() => {
    // Force a clean "no config anywhere" state.
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
    delete process.env.BEACON_BUSINESS_CONFIG_JSON;
    __resetBusinessConfigCacheForTests();
  });

  it("returns the placeholder when no env var, no top-level file, no global file", () => {
    const cfg = getBusinessConfig();
    expect(isPlaceholderConfig(cfg)).toBe(true);
  });

  it("placeholder has empty brand fields — no Ritz / ritzbuilders / Bay Area / design-build leakage", () => {
    const cfg = getBusinessConfig();
    expect(cfg.name).toBe("");
    expect(cfg.domain).toBe("");
    expect(cfg.industry).toBe("");
    expect(cfg.locations).toEqual([]);
    expect(cfg.services).toEqual([]);
    expect(cfg.primaryCompetitors).toEqual([]);
    expect(cfg.keyPages).toEqual([]);
  });

  it("placeholder serialized form contains no Ritz-specific literal strings", () => {
    const cfg = getBusinessConfig();
    const serialized = JSON.stringify(cfg).toLowerCase();
    const forbidden = [
      "ritz",
      "ritzbuilders",
      "atherton",
      "palo alto",
      "menlo park",
      "los altos",
      "cupertino",
      "saratoga",
      "design-build",
      "bay area",
      "silicon valley",
      "de mattei",
      "supple homes",
      "kasten",
      "crc builders",
    ];
    for (const f of forbidden) {
      expect(
        serialized.includes(f),
        `Placeholder config must NOT include "${f}" — it leaks Ritz brand into customer-2 fallback (D1)`,
      ).toBe(false);
    }
  });

  it("placeholder scanSettings.enabled is FALSE — no auto-scan on a customer-2 domain without operator opt-in", () => {
    const cfg = getBusinessConfig();
    expect(cfg.scanSettings.enabled).toBe(false);
  });

  it("placeholder structure is complete (all required fields present so downstream consumers don't crash)", () => {
    const cfg = getBusinessConfig();
    // Every required field on the type must be defined.
    expect(typeof cfg.name).toBe("string");
    expect(typeof cfg.domain).toBe("string");
    expect(typeof cfg.industry).toBe("string");
    expect(typeof cfg.phone).toBe("string");
    expect(typeof cfg.address).toBe("string");
    expect(typeof cfg.yelpBusinessId).toBe("string");
    expect(Array.isArray(cfg.locations)).toBe(true);
    expect(Array.isArray(cfg.services)).toBe(true);
    expect(Array.isArray(cfg.primaryCompetitors)).toBe(true);
    expect(Array.isArray(cfg.keyPages)).toBe(true);
    expect(Array.isArray(cfg.locationTerms)).toBe(true);
    expect(Array.isArray(cfg.serviceTerms)).toBe(true);
    expect(Array.isArray(cfg.directoryDomains)).toBe(true);
    expect(typeof cfg.scanSettings).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// 5. One-time log.warn when placeholder kicks in (operator audit follow-up)
// ---------------------------------------------------------------------------

describe("D1 + diagnostic — placeholder fallback emits a structured log.warn (once per process)", () => {
  beforeEach(() => {
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
    delete process.env.BEACON_BUSINESS_CONFIG_JSON;
    __resetBusinessConfigCacheForTests();
  });

  it("placeholder fallback fires log.warn with the operator-locked message + structured fields", () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const cfg = getBusinessConfig();
    expect(isPlaceholderConfig(cfg)).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg, payload] = warnSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(msg).toContain("[business-config]");
    expect(msg).toContain("placeholder");
    expect(msg).toContain("BEACON_BUSINESS_CONFIG_JSON");
    // Structured fields the operator needs to debug the state.
    expect(payload.envVarSet).toBe(false);
    expect(payload.topLevelFileExists).toBe(false);
    expect(payload.globalFileExists).toBe(false);
    expect(payload.runningOn).toBe(typeof process.env.VERCEL === "string" && process.env.VERCEL === "1" ? "vercel" : "local");
    warnSpy.mockRestore();
  });

  it("placeholder fallback does NOT fire log.warn a second time within the same process", () => {
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    getBusinessConfig(); // 1st call — fires the warning
    getBusinessConfig(); // 2nd call (cached) — no re-fire
    getBusinessConfig(); // 3rd call (cached) — no re-fire
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("real-config path does NOT fire the placeholder log.warn", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify({
      name: "Acme Co",
      domain: "acme.com",
    });
    __resetBusinessConfigCacheForTests();
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const cfg = getBusinessConfig();
    expect(isPlaceholderConfig(cfg)).toBe(false);
    // No placeholder-related warning when env var is set.
    const placeholderCalls = warnSpy.mock.calls.filter(
      ([m]) => typeof m === "string" && m.includes("[business-config]"),
    );
    expect(placeholderCalls.length).toBe(0);
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3. Env var override (Vercel-friendly path)
// ---------------------------------------------------------------------------

describe("D1 — BEACON_BUSINESS_CONFIG_JSON env var override", () => {
  beforeEach(() => {
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
    __resetBusinessConfigCacheForTests();
  });

  it("env var takes precedence over file paths and placeholder", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify({
      name: "Acme Co",
      domain: "acme.com",
      industry: "saas",
      locations: ["Remote"],
      services: ["analytics"],
    });
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.name).toBe("Acme Co");
    expect(cfg.domain).toBe("acme.com");
    expect(cfg.industry).toBe("saas");
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });

  it("malformed env var falls through to placeholder cleanly", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON = "{invalid json:";
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(isPlaceholderConfig(cfg)).toBe(true);
    expect(cfg.name).toBe("");
  });

  it("empty env var falls through to placeholder", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON = "";
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(isPlaceholderConfig(cfg)).toBe(true);
  });

  it("env var with persisted __placeholder flag has the flag stripped (real config wins)", () => {
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify({
      name: "Acme Co",
      domain: "acme.com",
      __placeholder: true, // attacker / bug — must not leak through
    });
    __resetBusinessConfigCacheForTests();

    const cfg = getBusinessConfig();
    expect(cfg.name).toBe("Acme Co");
    expect(isPlaceholderConfig(cfg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Source-level invariant: business-config.ts source has no Ritz strings
// ---------------------------------------------------------------------------

describe("D1 — source-level guard: business-config.ts contains no Ritz fallback strings", () => {
  it("business-config.ts source has no Ritz brand or domain literals in the placeholder path", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src", "lib", "business-config.ts"),
      "utf-8",
    );
    // The forbidden literals in source code (case-sensitive — these are
    // exact spellings of the Ritz brand). Comments/JSDoc are allowed to
    // mention them historically; we strip comments before checking.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    const forbidden = [
      "Ritz Builders",
      "ritzbuilders.com",
      "Bay Area",
      "Atherton",
      "Palo Alto",
      "Menlo Park",
      "design-build",
    ];
    const violations: string[] = [];
    for (const f of forbidden) {
      if (stripped.includes(f)) violations.push(f);
    }
    expect(
      violations,
      `business-config.ts source must not contain Ritz-specific literals in non-comment code (D1). Found: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});
