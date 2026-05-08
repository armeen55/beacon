/**
 * Behavioral tests — UX.2 command-center-data (2026-05-07).
 *
 * The resolver does I/O (reads .data/_reports/ + .data/tenants/<slug>/
 * brain/manifest.json) so we can't unit-test it in isolation without
 * either (a) a temp-fs harness or (b) testing the pure helpers via
 * named exports. We took option (b) — the file's pure pieces
 * (coerceGrade, summariseSection-equivalents) live as internals;
 * external behavior is pinned by the architecture invariant tests
 * + the live integration via /today rendering.
 *
 * The tests below exercise the public API by hitting the real Ritz
 * artifacts (which exist and are checked in via .data/). If the
 * artifacts are absent (e.g., CI without .data/), the tests still
 * pass — they assert the resolver's empty-state contract.
 */

import { describe, expect, it } from "vitest";
import {
  resolveCommandCenterData,
  isOperatorMode,
} from "./command-center-data";

describe("resolveCommandCenterData — Ritz fixture", () => {
  // Ritz's brain-health reports live at .data/_reports/brain-health-*.json
  // and the manifest at .data/tenants/ritz-builders/brain/manifest.json.
  // These artifacts are committed locally; on CI they may be absent.

  it("returns a CommandCenterData object even when files are missing", () => {
    const r = resolveCommandCenterData({ tenantSlug: "tenant-that-does-not-exist" });
    expect(r).toBeDefined();
    expect(typeof r.hasAnyData).toBe("boolean");
    expect(r.brain === null || typeof r.brain === "object").toBe(true);
    expect(r.manifest === null || typeof r.manifest === "object").toBe(true);
  });

  it("hasAnyData=false when both brain + manifest are missing", () => {
    const r = resolveCommandCenterData({
      tenantSlug: "tenant-that-does-not-exist",
    });
    if (r.brain === null && r.manifest === null) {
      expect(r.hasAnyData).toBe(false);
    } else {
      // Brain comes from .data/_reports (not slug-scoped), so it may
      // exist even for a fake tenant slug. In that case hasAnyData
      // is true. Test the contract either way.
      expect(r.hasAnyData).toBe(true);
    }
  });

  it("when brain is present, grade is one of A/B/C/D/F", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.brain) {
      expect(["A", "B", "C", "D", "F"]).toContain(r.brain.grade);
    }
  });

  it("when brain is present, oneLine is non-empty + customer-safe", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.brain) {
      expect(r.brain.oneLine.length).toBeGreaterThan(0);
      // Must NOT contain methodology/SQL/operator-internal language.
      expect(r.brain.oneLine).not.toMatch(/UTC/);
      expect(r.brain.oneLine).not.toMatch(/cron/i);
      expect(r.brain.oneLine).not.toMatch(/Supabase/i);
      expect(r.brain.oneLine).not.toMatch(/GitHub/i);
      expect(r.brain.oneLine).not.toMatch(/\bSQL\b/);
    }
  });

  it("when brain is present, sections have customer-safe labels (no enum-shape)", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.brain) {
      for (const s of r.brain.sections) {
        // Labels are space-separated lowercase words, NOT snake_case
        // or "Health" suffix in title-case enum form.
        expect(s.label).not.toMatch(/_/);
        expect(s.label.length).toBeGreaterThan(0);
        // Grade is letter only.
        expect(["A", "B", "C", "D", "F"]).toContain(s.grade);
        // Summary is non-empty.
        expect(s.summary.length).toBeGreaterThan(0);
      }
    }
  });

  it("when brain has the canonical 4 sections, they appear in order", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.brain && r.brain.sections.length === 4) {
      expect(r.brain.sections[0].label).toBe("Data health");
      expect(r.brain.sections[1].label).toBe("Score health");
      expect(r.brain.sections[2].label).toBe("Recommendation health");
      expect(r.brain.sections[3].label).toBe("Attribution health");
    }
  });

  it("when manifest is present, fileCount + sourceObservationCount are numbers ≥ 0", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.manifest) {
      expect(typeof r.manifest.fileCount).toBe("number");
      expect(r.manifest.fileCount).toBeGreaterThanOrEqual(0);
      expect(typeof r.manifest.sourceObservationCount).toBe("number");
      expect(r.manifest.sourceObservationCount).toBeGreaterThanOrEqual(0);
    }
  });

  it("manifest.builtAt is ISO-shaped or empty when the file is missing the field", () => {
    const r = resolveCommandCenterData({ tenantSlug: "ritz-builders" });
    if (r.manifest) {
      // Either empty (defensive default) or a parseable ISO timestamp.
      if (r.manifest.builtAt.length > 0) {
        const d = new Date(r.manifest.builtAt);
        expect(Number.isNaN(d.getTime())).toBe(false);
      }
    }
  });
});

describe("resolveCommandCenterData — defensive parsing", () => {
  it("never throws on weird tenant slugs", () => {
    expect(() =>
      resolveCommandCenterData({ tenantSlug: "../etc/passwd" }),
    ).not.toThrow();
    expect(() => resolveCommandCenterData({ tenantSlug: "" })).not.toThrow();
    expect(() =>
      resolveCommandCenterData({ tenantSlug: "tenant with spaces" }),
    ).not.toThrow();
  });
});

describe("isOperatorMode", () => {
  it("returns boolean", () => {
    expect(typeof isOperatorMode()).toBe("boolean");
  });

  it("respects BEACON_OPERATOR_MODE env (set in test context)", () => {
    const prev = process.env.BEACON_OPERATOR_MODE;
    try {
      process.env.BEACON_OPERATOR_MODE = "true";
      expect(isOperatorMode()).toBe(true);
      process.env.BEACON_OPERATOR_MODE = "false";
      expect(isOperatorMode()).toBe(false);
      delete process.env.BEACON_OPERATOR_MODE;
      expect(isOperatorMode()).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BEACON_OPERATOR_MODE;
      else process.env.BEACON_OPERATOR_MODE = prev;
    }
  });
});
