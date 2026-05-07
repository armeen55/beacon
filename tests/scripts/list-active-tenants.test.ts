/**
 * Behavioral tests — Gap A (2026-05-07).
 *
 * Tests the pure helpers exported by `scripts/list-active-tenants.ts`:
 *   - isValidEntry: row-validation rules
 *   - parseJsonFallback: JSON-fallback path (filters disabled, drops invalid)
 *   - mapDbRowToMatrixEntry: Supabase column mapping (id→tenantId, etc.)
 *
 * No filesystem I/O; no Supabase. Hermetic + fast.
 */

import { describe, expect, it } from "vitest";
import {
  isValidEntry,
  mapDbRowToMatrixEntry,
  parseJsonFallback,
  type MatrixTenant,
} from "../../scripts/list-active-tenants";

const RITZ: MatrixTenant = {
  tenantId: "tenant-ritz-founder",
  slug: "ritz-builders",
  siteDomain: "ritzbuilders.com",
  enabled: true,
};

describe("isValidEntry", () => {
  it("accepts a valid Ritz-shaped entry", () => {
    expect(isValidEntry(RITZ)).toBe(true);
  });

  it("rejects null / undefined / non-object", () => {
    expect(isValidEntry(null)).toBe(false);
    expect(isValidEntry(undefined)).toBe(false);
    expect(isValidEntry("not-an-object")).toBe(false);
    expect(isValidEntry(42)).toBe(false);
  });

  it("rejects entry with empty tenantId", () => {
    expect(isValidEntry({ ...RITZ, tenantId: "" })).toBe(false);
  });

  it("rejects entry with empty slug", () => {
    expect(isValidEntry({ ...RITZ, slug: "" })).toBe(false);
  });

  it("rejects entry with empty siteDomain", () => {
    expect(isValidEntry({ ...RITZ, siteDomain: "" })).toBe(false);
  });

  it("rejects entry with non-string fields", () => {
    expect(isValidEntry({ ...RITZ, tenantId: 123 })).toBe(false);
    expect(isValidEntry({ ...RITZ, slug: null })).toBe(false);
    expect(isValidEntry({ ...RITZ, siteDomain: undefined })).toBe(false);
  });
});

describe("parseJsonFallback", () => {
  it("returns Ritz from a single-row enabled fixture", () => {
    const out = parseJsonFallback([
      { tenantId: "tenant-ritz-founder", slug: "ritz-builders", siteDomain: "ritzbuilders.com", enabled: true },
    ]);
    expect(out).toEqual([RITZ]);
  });

  it("filters out disabled rows", () => {
    const out = parseJsonFallback([
      { tenantId: "tenant-disabled", slug: "disabled-builders", siteDomain: "disabled.com", enabled: false },
      { tenantId: "tenant-ritz-founder", slug: "ritz-builders", siteDomain: "ritzbuilders.com", enabled: true },
    ]);
    expect(out).toEqual([RITZ]);
  });

  it("filters out rows with no enabled field (treated as disabled)", () => {
    const out = parseJsonFallback([
      { tenantId: "tenant-ritz-founder", slug: "ritz-builders", siteDomain: "ritzbuilders.com" }, // no enabled
      { tenantId: "tenant-also-active", slug: "also", siteDomain: "also.com", enabled: true },
    ]);
    expect(out.map((t) => t.tenantId)).toEqual(["tenant-also-active"]);
  });

  it("treats enabled='true' (string) as DISABLED (must be exact boolean true)", () => {
    const out = parseJsonFallback([
      { tenantId: "tenant-ritz-founder", slug: "ritz-builders", siteDomain: "ritzbuilders.com", enabled: "true" },
    ]);
    expect(out).toEqual([]);
  });

  it("drops enabled rows missing required fields (logs WARN)", () => {
    const warnings: string[] = [];
    const out = parseJsonFallback(
      [
        { tenantId: "", slug: "missing-id", siteDomain: "missing-id.com", enabled: true },
        { tenantId: "tenant-ritz-founder", slug: "ritz-builders", siteDomain: "ritzbuilders.com", enabled: true },
        { tenantId: "tenant-no-domain", slug: "no-domain", siteDomain: "", enabled: true },
      ],
      (msg) => warnings.push(msg),
    );
    expect(out).toEqual([RITZ]); // only the valid row survives
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toMatch(/dropped/);
  });

  it("returns empty array for an empty input", () => {
    expect(parseJsonFallback([])).toEqual([]);
  });

  it("throws on non-array input", () => {
    expect(() => parseJsonFallback({ not: "an array" })).toThrow(/JSON array/);
    expect(() => parseJsonFallback(null)).toThrow(/JSON array/);
    expect(() => parseJsonFallback("string")).toThrow(/JSON array/);
  });
});

describe("mapDbRowToMatrixEntry — Supabase column mapping", () => {
  it("maps Ritz's DB row to the matrix shape", () => {
    const out = mapDbRowToMatrixEntry({
      id: "tenant-ritz-founder",
      slug: "ritz-builders",
      domain: "ritzbuilders.com",
    });
    expect(out).toEqual(RITZ);
  });

  it("renames DB columns: id→tenantId, slug→slug, domain→siteDomain", () => {
    const out = mapDbRowToMatrixEntry({
      id: "tenant-x",
      slug: "x-co",
      domain: "x.com",
    });
    expect(out?.tenantId).toBe("tenant-x");
    expect(out?.slug).toBe("x-co");
    expect(out?.siteDomain).toBe("x.com");
  });

  it("always sets enabled=true (DB query already filtered status='active')", () => {
    const out = mapDbRowToMatrixEntry({
      id: "tenant-x",
      slug: "x-co",
      domain: "x.com",
    });
    expect(out?.enabled).toBe(true);
  });

  it("returns null on row with null id", () => {
    expect(mapDbRowToMatrixEntry({ id: null, slug: "x", domain: "x.com" })).toBeNull();
  });

  it("returns null on row with empty slug", () => {
    expect(mapDbRowToMatrixEntry({ id: "tenant-x", slug: "", domain: "x.com" })).toBeNull();
  });

  it("returns null on row with null domain", () => {
    expect(mapDbRowToMatrixEntry({ id: "tenant-x", slug: "x", domain: null })).toBeNull();
  });
});
