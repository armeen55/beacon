/**
 * Architecture invariant — Brand Assertion Key Alignment (2026-05-22):
 * the brand-assertion registries MUST be keyed by `BeaconTenant.id`
 * (the value `currentTenantId()` returns + every caller passes), NEVER
 * by a tenant slug.
 *
 * Root cause this pins: `TENANT_ASSERTIONS` + `TENANT_NAME_STYLES` were
 * keyed by the slug (`"ritz-builders"`) while every production caller
 * passed the tenant id (`"tenant-ritz-founder"`), so `getBrandAssertions`
 * / `getBrandNameStyle` silently returned `[]` / `null` in production —
 * disabling the LLM brand-assertion guidance + the validator
 * brand-name-style gate. The slug-based unit test stayed green, masking
 * the bug. This invariant would have caught it: it asserts every
 * registry key is an `ops/active-tenants.json` tenantId AND no key is a
 * slug.
 *
 * Protects Customer 2: a future tenant registered under a slug (instead
 * of their tenantId) trips this invariant before it can silently
 * return `[]` in production.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __brandRegistryKeys,
  getBrandAssertions,
  getBrandNameStyle,
} from "@/domains/recommendations/brand-assertions";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ACTIVE_TENANTS_FILE = resolve(REPO_ROOT, "ops", "active-tenants.json");

type ActiveTenant = { tenantId: string; slug: string };

const activeTenants: ActiveTenant[] = JSON.parse(
  readFileSync(ACTIVE_TENANTS_FILE, "utf-8"),
);
const ACTIVE_TENANT_IDS = new Set(activeTenants.map((t) => t.tenantId));
const ACTIVE_SLUGS = new Set(activeTenants.map((t) => t.slug));

const ALL_REGISTRY_KEYS = [
  ...__brandRegistryKeys.assertions,
  ...__brandRegistryKeys.nameStyles,
];

describe("brand-assertions-tenant-key-contract", () => {
  it("ops/active-tenants.json has at least one tenant with distinct id + slug (otherwise this pin is vacuous)", () => {
    expect(activeTenants.length).toBeGreaterThan(0);
    // Ritz specifically has a non-equal id vs slug — the exact shape
    // that caused the bug. Pin it so the regression context stays clear.
    const ritz = activeTenants.find((t) => t.tenantId === "tenant-ritz-founder");
    expect(ritz, "expected tenant-ritz-founder in active-tenants.json").toBeDefined();
    expect(ritz!.slug).not.toBe(ritz!.tenantId);
  });

  it("registries are non-empty (at least one tenant is curated)", () => {
    expect(__brandRegistryKeys.assertions.length).toBeGreaterThan(0);
    expect(__brandRegistryKeys.nameStyles.length).toBeGreaterThan(0);
  });

  it("every TENANT_ASSERTIONS key is an active-tenants tenantId", () => {
    for (const key of __brandRegistryKeys.assertions) {
      expect(
        ACTIVE_TENANT_IDS.has(key),
        `TENANT_ASSERTIONS key "${key}" is not an ops/active-tenants.json tenantId`,
      ).toBe(true);
    }
  });

  it("every TENANT_NAME_STYLES key is an active-tenants tenantId", () => {
    for (const key of __brandRegistryKeys.nameStyles) {
      expect(
        ACTIVE_TENANT_IDS.has(key),
        `TENANT_NAME_STYLES key "${key}" is not an ops/active-tenants.json tenantId`,
      ).toBe(true);
    }
  });

  it("NO registry key equals an active-tenants slug (the slug-vs-id bug guard)", () => {
    for (const key of ALL_REGISTRY_KEYS) {
      expect(
        ACTIVE_SLUGS.has(key),
        `registry key "${key}" equals a slug — registries MUST be keyed by tenantId, not slug`,
      ).toBe(false);
    }
  });

  // Behavioral regression: the exact production path that was broken.
  // For every registered tenant, looking up by tenantId returns a
  // non-empty result, and looking up by its slug returns the empty
  // default (no alias).
  describe("behavioral — tenantId lookup works, slug lookup is empty (no alias)", () => {
    for (const t of activeTenants) {
      const isAssertionRegistered = __brandRegistryKeys.assertions.includes(
        t.tenantId,
      );
      if (!isAssertionRegistered) continue;
      it(`${t.tenantId}: getBrandAssertions(tenantId) is non-empty; getBrandAssertions(slug) is empty`, () => {
        expect(getBrandAssertions(t.tenantId).length).toBeGreaterThan(0);
        expect(getBrandAssertions(t.slug)).toEqual([]);
      });
    }

    for (const t of activeTenants) {
      const isStyleRegistered = __brandRegistryKeys.nameStyles.includes(
        t.tenantId,
      );
      if (!isStyleRegistered) continue;
      it(`${t.tenantId}: getBrandNameStyle(tenantId) is non-null; getBrandNameStyle(slug) is null`, () => {
        expect(getBrandNameStyle(t.tenantId)).not.toBeNull();
        expect(getBrandNameStyle(t.slug)).toBeNull();
      });
    }
  });
});
