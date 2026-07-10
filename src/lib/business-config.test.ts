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
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  getBusinessConfig,
  getBusinessConfigForCurrentTenant,
  saveBusinessConfig,
  isPlaceholderConfig,
  __resetBusinessConfigCacheForTests,
  type BusinessConfig,
} from "./business-config";
import { log } from "@/lib/logger";
import { evaluateDraftQuality } from "@/domains/drafts/draft-quality";
import { classifySourceAuthority } from "@/domains/drafts/source-authority";

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
  // North-star onboarding (2026-06-11): saveBusinessConfig now persists a
  // per-tenant file for EVERY tenant — remove the fixture tenants this
  // suite saves so test residue never accumulates in .data/tenants/.
  for (const fixtureTenant of ["tenant-save-test"]) {
    rmSync(join(REPO_ROOT, ".data", "tenants", fixtureTenant), {
      recursive: true,
      force: true,
    });
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

// ---------------------------------------------------------------------------
// MT-1 (2026-05-22) — tenant-keyed business-config core.
//
// Pins the multi-tenant prerequisite: getBusinessConfig is tenant-keyed,
// resolves per-tenant from BEACON_BUSINESS_CONFIG_JSON_BY_TENANT, preserves
// Ritz byte-identical via the env-named-tenant back-compat chain, and
// caches by tenantId with no cross-tenant bleed. The vitest env sets
// BEACON_TENANT_ID="tenant-ritz-founder" globally (vitest.config.ts), so
// the deprecated no-arg path resolves to Ritz across the whole suite.
// ---------------------------------------------------------------------------

const BY_TENANT_ENV = "BEACON_BUSINESS_CONFIG_JSON_BY_TENANT";

describe("MT-1 — tenant-keyed resolution + cache isolation", () => {
  let savedByTenant: string | undefined;

  beforeEach(() => {
    savedByTenant = process.env[BY_TENANT_ENV];
    delete process.env[BY_TENANT_ENV];
    // The outer beforeEach already cleared BEACON_BUSINESS_CONFIG_JSON +
    // reset the cache; clear any on-disk files so back-compat (b) for the
    // env tenant can't accidentally shadow a per-tenant assertion.
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    __resetBusinessConfigCacheForTests();
  });

  afterEach(() => {
    if (typeof savedByTenant === "string") {
      process.env[BY_TENANT_ENV] = savedByTenant;
    } else {
      delete process.env[BY_TENANT_ENV];
    }
    __resetBusinessConfigCacheForTests();
  });

  it("loads distinct configs per tenant from BEACON_BUSINESS_CONFIG_JSON_BY_TENANT", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a": { name: "Alpha Co", domain: "alpha.test", industry: "saas" },
      "tenant-b": { name: "Beta Co", domain: "beta.test", industry: "legal" },
    });
    __resetBusinessConfigCacheForTests();

    const a = getBusinessConfig("tenant-a");
    const b = getBusinessConfig("tenant-b");
    expect(a.name).toBe("Alpha Co");
    expect(a.domain).toBe("alpha.test");
    expect(b.name).toBe("Beta Co");
    expect(b.domain).toBe("beta.test");
    expect(isPlaceholderConfig(a)).toBe(false);
    expect(isPlaceholderConfig(b)).toBe(false);
  });

  it("mutating one tenant's loaded config does not affect another tenant", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a": { name: "Alpha Co", services: ["one"] },
      "tenant-b": { name: "Beta Co", services: ["two"] },
    });
    __resetBusinessConfigCacheForTests();

    const a = getBusinessConfig("tenant-a");
    const b = getBusinessConfig("tenant-b");
    // Distinct object identities — no shared reference across tenants.
    expect(a).not.toBe(b);
    (a.services as string[]).push("mutated");
    a.name = "Mutated Co";
    expect(b.name).toBe("Beta Co");
    expect(b.services).toEqual(["two"]);
  });

  it("cross-tenant bleed guard: unknown tenant returns the placeholder, not another tenant's config", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a": { name: "Alpha Co", domain: "alpha.test" },
    });
    __resetBusinessConfigCacheForTests();

    const unknown = getBusinessConfig("tenant-zzz-unknown");
    expect(isPlaceholderConfig(unknown)).toBe(true);
    expect(unknown.name).toBe("");
    expect(unknown.name).not.toBe("Alpha Co");
  });

  it("cache key is tenantId, not slug: looking up the slug misses the tenantId entry", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-acme": { name: "Acme Co", domain: "acme.test" },
    });
    __resetBusinessConfigCacheForTests();

    // Canonical tenantId hits.
    expect(getBusinessConfig("tenant-acme").name).toBe("Acme Co");
    // The bare slug (no "tenant-" prefix) is NOT a key → placeholder.
    expect(isPlaceholderConfig(getBusinessConfig("acme"))).toBe(true);
  });

  it("Ritz back-compat: getBusinessConfig(BEACON_TENANT_ID) with legacy BEACON_BUSINESS_CONFIG_JSON resolves identically to the no-arg path", () => {
    const envTenant = process.env.BEACON_TENANT_ID!;
    expect(typeof envTenant).toBe("string");
    process.env.BEACON_BUSINESS_CONFIG_JSON = JSON.stringify({
      name: "Acme Co",
      domain: "acme.com",
      industry: "saas",
    });
    __resetBusinessConfigCacheForTests();

    const explicit = getBusinessConfig(envTenant);
    const noArg = getBusinessConfig();
    expect(explicit.name).toBe("Acme Co");
    expect(noArg.name).toBe("Acme Co");
    expect(explicit.domain).toBe(noArg.domain);
    expect(isPlaceholderConfig(explicit)).toBe(false);

    delete process.env.BEACON_BUSINESS_CONFIG_JSON;
  });

  it("getBusinessConfigForCurrentTenant resolves via currentTenantId (env tenant) and returns that tenant's config", async () => {
    const envTenant = process.env.BEACON_TENANT_ID!;
    process.env[BY_TENANT_ENV] = JSON.stringify({
      [envTenant]: { name: "Wrapper Co", domain: "wrapper.test" },
    });
    __resetBusinessConfigCacheForTests();

    const viaWrapper = await getBusinessConfigForCurrentTenant();
    expect(viaWrapper.name).toBe("Wrapper Co");
    expect(viaWrapper.name).toBe(getBusinessConfig(envTenant).name);
  });

  it("cache reset clears ALL tenant entries", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a": { name: "Alpha Co" },
    });
    __resetBusinessConfigCacheForTests();
    const a1 = getBusinessConfig("tenant-a");
    // Same object on repeat (cached).
    expect(getBusinessConfig("tenant-a")).toBe(a1);
    __resetBusinessConfigCacheForTests();
    // After reset, a fresh resolution produces a new object identity.
    const a2 = getBusinessConfig("tenant-a");
    expect(a2).not.toBe(a1);
    expect(a2.name).toBe("Alpha Co");
  });
});

describe("W5 (2026-07-09, J-69/J-70): authoritativeSourceDomains + firstMention tenant isolation", () => {
  let savedByTenant: string | undefined;

  beforeEach(() => {
    savedByTenant = process.env[BY_TENANT_ENV];
    delete process.env[BY_TENANT_ENV];
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    __resetBusinessConfigCacheForTests();
  });

  afterEach(() => {
    if (typeof savedByTenant === "string") {
      process.env[BY_TENANT_ENV] = savedByTenant;
    } else {
      delete process.env[BY_TENANT_ENV];
    }
    __resetBusinessConfigCacheForTests();
  });

  const FACTUAL_DRAFT =
    "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history, according to the museum's own published records. Curators rotate roughly a fifth of the collection into public view each year, pairing objects with short written histories drawn from acquisition records and donor correspondence. Visiting researchers may request access to unpublished archival material by written appointment. The museum also maintains a smaller traveling exhibit that tours partner institutions on a rotating multi-year schedule, giving audiences outside the home city a chance to see a curated slice of the same collection.";

  it("tenant A's allowlist + firstMention are set, tenant B carries neither", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a-w5": {
        name: "Tenant A",
        authoritativeSourceDomains: ["sample-museum.org"],
        firstMention: { native: "؀-ۿ", transliteration: true, englishContext: true },
      },
      "tenant-b-w5": { name: "Tenant B" },
    });
    __resetBusinessConfigCacheForTests();

    const a = getBusinessConfig("tenant-a-w5");
    const b = getBusinessConfig("tenant-b-w5");
    expect(a.authoritativeSourceDomains).toEqual(["sample-museum.org"]);
    expect(a.firstMention).toEqual({ native: "؀-ۿ", transliteration: true, englishContext: true });
    expect(b.authoritativeSourceDomains).toBeUndefined();
    expect(b.firstMention).toBeUndefined();
  });

  it("tenant B's evaluation is byte-identical to a call with no tenant config at all", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a-w5": { name: "Tenant A", authoritativeSourceDomains: ["sample-museum.org"] },
      "tenant-b-w5": { name: "Tenant B" },
    });
    __resetBusinessConfigCacheForTests();
    const b = getBusinessConfig("tenant-b-w5");

    const sources = [{ domain: "sample-museum.org", claim: "the collection catalog lists over 3000 artifacts" }];
    const withB = evaluateDraftQuality({
      answer: FACTUAL_DRAFT,
      sources,
      authoritativeSourceDomains: b.authoritativeSourceDomains,
      firstMentionConfig: b.firstMention,
    });
    const withNoConfig = evaluateDraftQuality({ answer: FACTUAL_DRAFT, sources });
    expect(withB).toEqual(withNoConfig);
  });

  it("tenant A's allowlist never raises authority for tenant B (same domain, B stays weak)", () => {
    process.env[BY_TENANT_ENV] = JSON.stringify({
      "tenant-a-w5": { name: "Tenant A", authoritativeSourceDomains: ["sample-museum.org"] },
      "tenant-b-w5": { name: "Tenant B" },
    });
    __resetBusinessConfigCacheForTests();
    const a = getBusinessConfig("tenant-a-w5");
    const b = getBusinessConfig("tenant-b-w5");

    // W5 P0-1: a factual draft is only "ready" with a generation-time VERIFIED
    // authoritative source, so the fixture carries verified:true; the test's
    // point is that A's allowlist raises authority (-> ready) while B's does not
    // (-> missing_source), independent of verification.
    // Task #230 (2026-07-10): the source gate now requires the source's own
    // supportingExcerpt to COVER every protected sentence of FACTUAL_DRAFT
    // (the number + "The Sample Museum's", "Curators", and "Visiting"
    // sentences), the same per-sentence check verifyStampedSources populates
    // at generation time - a bare `claim` string no longer suffices. This
    // excerpt is what the museum's own published records/catalog/visitor
    // policy would state to confirm each of those sentences.
    const source = {
      domain: "sample-museum.org",
      claim: "the collection catalog lists over 3000 artifacts",
      verified: true,
      supportingExcerpt:
        "The Sample Museum's collection catalog lists over 3000 artifacts spanning several centuries of regional history, confirmed in the museum's own published catalog. Curators rotate roughly a fifth of the collection into public view each year, pairing objects with short written histories drawn from acquisition records and donor correspondence, according to the museum's own published records. Visiting researchers may request access to unpublished archival material by written appointment, as described in the museum's own published visitor policy.",
    };
    expect(classifySourceAuthority(source, a.authoritativeSourceDomains)).toBe("authoritative");
    expect(classifySourceAuthority(source, b.authoritativeSourceDomains)).toBe("weak");

    // The SAME draft: ready under A's allowlist, held for a source under B's.
    const contextTokens = ["sample museum"];
    const underA = evaluateDraftQuality({ answer: FACTUAL_DRAFT, sources: [source], authoritativeSourceDomains: a.authoritativeSourceDomains, contextTokens });
    const underB = evaluateDraftQuality({ answer: FACTUAL_DRAFT, sources: [source], authoritativeSourceDomains: b.authoritativeSourceDomains, contextTokens });
    expect(underA.status).toBe("ready");
    expect(underB.status).toBe("missing_source");
  });
});

describe("MT-1 — deprecated no-arg path (back-compat for existing consumers)", () => {
  it("no-arg getBusinessConfig() still works when BEACON_TENANT_ID is set (vitest env)", () => {
    // The outer beforeEach cleared BEACON_BUSINESS_CONFIG_JSON; with no
    // file + no env, this resolves to the placeholder for the env tenant
    // WITHOUT throwing. The point: the no-arg overload remains callable.
    if (existsSync(TOP_LEVEL_PATH)) unlinkSync(TOP_LEVEL_PATH);
    if (existsSync(GLOBAL_PATH)) unlinkSync(GLOBAL_PATH);
    __resetBusinessConfigCacheForTests();
    const cfg = getBusinessConfig();
    expect(typeof cfg.name).toBe("string");
  });

  it("no-arg getBusinessConfig() throws fail-loud when BEACON_TENANT_ID is unset", () => {
    const saved = process.env.BEACON_TENANT_ID;
    try {
      delete process.env.BEACON_TENANT_ID;
      __resetBusinessConfigCacheForTests();
      expect(() => getBusinessConfig()).toThrow(/BEACON_TENANT_ID/);
    } finally {
      if (typeof saved === "string") process.env.BEACON_TENANT_ID = saved;
      __resetBusinessConfigCacheForTests();
    }
  });

  it("saveBusinessConfig(tenantId, patch) updates the tenant-keyed cache for a NON-env tenant without touching the shared file (MT-1 behavior)", () => {
    // A non-env tenant's save is cache-only in MT-1 — it must NOT write
    // the shared top-level file (which belongs to the env tenant).
    const before = existsSync(TOP_LEVEL_PATH)
      ? readFileSync(TOP_LEVEL_PATH, "utf-8")
      : null;
    const saved = saveBusinessConfig("tenant-save-test", { name: "Saved Co" });
    expect(saved.name).toBe("Saved Co");
    expect(isPlaceholderConfig(saved)).toBe(false);
    // Subsequent read for the same tenant reflects the saved config.
    expect(getBusinessConfig("tenant-save-test").name).toBe("Saved Co");
    // Shared top-level file is untouched by the non-env tenant save.
    const after = existsSync(TOP_LEVEL_PATH)
      ? readFileSync(TOP_LEVEL_PATH, "utf-8")
      : null;
    expect(after).toBe(before);
    __resetBusinessConfigCacheForTests();
  });
});
