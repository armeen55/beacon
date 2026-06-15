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
 * the bug. This invariant catches it: it asserts every registry key
 * matches the canonical `BeaconTenant.id` format (`tenant-<slug>`, see
 * `src/domains/tenants/types.ts`) — which a bare slug can never satisfy —
 * AND that the slug-shaped form of each id is NOT itself a key.
 *
 * (2026-06-15) De-cron de-bloat: the canonical active-tenant list moved to
 * Supabase (`src/domains/tenants/store.ts::listTenants`, async) and the
 * static `ops/active-tenants.json` fleet file — only ever read by the
 * deleted cron matrix — was removed. This pin is now structural + needs no
 * external data file, so it keeps protecting Customer 2 (a tenant
 * registered under a slug instead of its id trips the format check before
 * it can silently return `[]` in production).
 */

import { describe, it, expect } from "vitest";

import {
  __brandRegistryKeys,
  getBrandAssertions,
  getBrandNameStyle,
} from "@/domains/recommendations/brand-assertions";

// Canonical BeaconTenant.id format (src/domains/tenants/types.ts: `id: "tenant-<slug>"`).
// A bare slug ("ritz-builders") can never match this — that is the bug guard.
const TENANT_ID_FORMAT = /^tenant-[a-z0-9-]+$/;

const ALL_REGISTRY_KEYS = [
  ...__brandRegistryKeys.assertions,
  ...__brandRegistryKeys.nameStyles,
];

describe("brand-assertions-tenant-key-contract", () => {
  it("registries are non-empty (at least one tenant is curated)", () => {
    expect(__brandRegistryKeys.assertions.length).toBeGreaterThan(0);
    expect(__brandRegistryKeys.nameStyles.length).toBeGreaterThan(0);
  });

  it("every TENANT_ASSERTIONS key is a canonical BeaconTenant.id (tenant-<slug>), never a bare slug", () => {
    for (const key of __brandRegistryKeys.assertions) {
      expect(
        TENANT_ID_FORMAT.test(key),
        `TENANT_ASSERTIONS key "${key}" is not a tenantId (expected /^tenant-/). Registries MUST be keyed by BeaconTenant.id, not a slug.`,
      ).toBe(true);
    }
  });

  it("every TENANT_NAME_STYLES key is a canonical BeaconTenant.id (tenant-<slug>), never a bare slug", () => {
    for (const key of __brandRegistryKeys.nameStyles) {
      expect(
        TENANT_ID_FORMAT.test(key),
        `TENANT_NAME_STYLES key "${key}" is not a tenantId (expected /^tenant-/). Registries MUST be keyed by BeaconTenant.id, not a slug.`,
      ).toBe(true);
    }
  });

  // Behavioral regression: the exact production path that was broken.
  // For every registered tenant id, lookup by the id returns a non-empty
  // result, and lookup by the slug-shaped form (id minus the `tenant-`
  // prefix) returns the empty default — proving the registry is keyed by
  // the full id, not a slug.
  describe("behavioral — tenantId lookup works, slug-shaped lookup is empty (no alias)", () => {
    for (const key of __brandRegistryKeys.assertions) {
      const slugShaped = key.replace(/^tenant-/, "");
      it(`${key}: getBrandAssertions(id) is non-empty; getBrandAssertions(slug-form) is empty`, () => {
        expect(getBrandAssertions(key).length).toBeGreaterThan(0);
        expect(getBrandAssertions(slugShaped)).toEqual([]);
      });
    }

    for (const key of __brandRegistryKeys.nameStyles) {
      const slugShaped = key.replace(/^tenant-/, "");
      it(`${key}: getBrandNameStyle(id) is non-null; getBrandNameStyle(slug-form) is null`, () => {
        expect(getBrandNameStyle(key)).not.toBeNull();
        expect(getBrandNameStyle(slugShaped)).toBeNull();
      });
    }
  });
});
