/**
 * 2026-06-10 — per-tenant engine toggles (multi-property activation).
 * Pins: segment defaults, explicit overrides win, founder fallback on
 * registry miss, safe-off for unknown tenants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let _tenant: unknown = null;
let _storeThrows = false;
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async () => {
    if (_storeThrows) throw new Error("registry down");
    return _tenant;
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-ritz-founder",
}));

import {
  resolveTenantFeatures,
  getTenantFeatures,
} from "@/domains/tenants/tenant-features";

beforeEach(() => {
  _tenant = null;
  _storeThrows = false;
});

describe("resolveTenantFeatures — segment defaults", () => {
  it("local_residential_builder → everything on", () => {
    expect(
      resolveTenantFeatures({ segment: "local_residential_builder" }),
    ).toEqual({ local_service: true, call_tracking: true, geo_pages: true });
  });

  it("content_publisher / product_app → local-service stack off", () => {
    for (const segment of ["content_publisher", "product_app"] as const) {
      expect(resolveTenantFeatures({ segment })).toEqual({
        local_service: false,
        call_tracking: false,
        geo_pages: false,
      });
    }
  });

  it("explicit overrides win over segment defaults", () => {
    expect(
      resolveTenantFeatures({
        segment: "content_publisher",
        features: { geo_pages: true },
      }),
    ).toEqual({ local_service: false, call_tracking: false, geo_pages: true });
    expect(
      resolveTenantFeatures({
        segment: "local_residential_builder",
        features: { call_tracking: false },
      }).call_tracking,
    ).toBe(false);
  });

  it("null tenant → safe-off", () => {
    expect(resolveTenantFeatures(null).local_service).toBe(false);
  });
});

describe("getTenantFeatures — registry resolution", () => {
  it("reads the tenant row when present", async () => {
    _tenant = { segment: "content_publisher" };
    expect((await getTenantFeatures("tenant-iranopedia")).local_service).toBe(false);
  });

  it("founder tenant keeps builder defaults on registry miss AND on throw", async () => {
    expect((await getTenantFeatures("tenant-ritz-founder")).local_service).toBe(true);
    _storeThrows = true;
    expect((await getTenantFeatures("tenant-ritz-founder")).call_tracking).toBe(true);
  });

  it("unknown tenant on registry miss → safe-off", async () => {
    expect((await getTenantFeatures("tenant-mystery")).local_service).toBe(false);
  });
});
