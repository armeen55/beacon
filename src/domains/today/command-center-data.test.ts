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
  deriveBrainSummaryFromCounts,
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

// ---------------------------------------------------------------------------
// UX.6.1 (2026-05-07) — deriveBrainSummaryFromCounts behavioral tests.
// The pure helper that powers the production fallback when the disk
// `.data/_reports/brain-health-*.json` is unreachable.
// ---------------------------------------------------------------------------

describe("deriveBrainSummaryFromCounts — first-reading tenants", () => {
  it("returns null when totalObservationCount is 0 (first-reading tenant)", () => {
    const r = deriveBrainSummaryFromCounts({
      observations7dCount: 0,
      totalObservationCount: 0,
      recentSnapshotCount: 0,
      totalSnapshotCount: 0,
      ownedUrlsCitedCount: 0,
      recommendationQueueSize: 0,
      hasPlatformCoverage: false,
    });
    expect(r).toBeNull();
  });

  it("returns null when totalObservationCount is negative or NaN", () => {
    expect(
      deriveBrainSummaryFromCounts({
        observations7dCount: 0,
        totalObservationCount: -5,
        recentSnapshotCount: 0,
        totalSnapshotCount: 0,
        ownedUrlsCitedCount: 0,
        recommendationQueueSize: 0,
        hasPlatformCoverage: false,
      }),
    ).toBeNull();
    expect(
      deriveBrainSummaryFromCounts({
        observations7dCount: 0,
        totalObservationCount: Number.NaN,
        recentSnapshotCount: 0,
        totalSnapshotCount: 0,
        ownedUrlsCitedCount: 0,
        recommendationQueueSize: 0,
        hasPlatformCoverage: false,
      }),
    ).toBeNull();
  });
});

describe("deriveBrainSummaryFromCounts — mature Ritz-shape tenant", () => {
  // Counts modeled after Ritz at the time of UX.6.1 landing — ~600+
  // observations / 7d, both platforms covered, several owned URLs
  // cited recently, mature recommendation queue.
  const RITZ_LIKE = {
    observations7dCount: 700,
    totalObservationCount: 12_000,
    recentSnapshotCount: 14,
    totalSnapshotCount: 800,
    ownedUrlsCitedCount: 8,
    recommendationQueueSize: 12,
    hasPlatformCoverage: true,
  } as const;

  it("returns a non-null brain summary", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
  });

  it("grade is one of A/B/C/D/F", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
    if (r) {
      expect(["A", "B", "C", "D", "F"]).toContain(r.grade);
    }
  });

  it("Ritz-like inputs grade A across data + score + rec sections", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
    if (!r) return;
    const byLabel = new Map(r.sections.map((s) => [s.label, s.grade]));
    // Data: 700 obs/7d ≥ 600 → A.
    expect(byLabel.get("Data health")).toBe("A");
    // Score: ≥7 snaps + ≥5 owned URLs + both platforms → A.
    expect(byLabel.get("Score health")).toBe("A");
    // Rec: ≥10 → A.
    expect(byLabel.get("Recommendation health")).toBe("A");
  });

  it("renders 4 sections in the canonical order", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.sections.length).toBe(4);
    expect(r.sections[0].label).toBe("Data health");
    expect(r.sections[1].label).toBe("Score health");
    expect(r.sections[2].label).toBe("Recommendation health");
    expect(r.sections[3].label).toBe("Attribution health");
  });

  it("oneLine is non-empty and customer-safe", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.oneLine.length).toBeGreaterThan(0);
    expect(r.oneLine).not.toMatch(/UTC/);
    expect(r.oneLine).not.toMatch(/cron/i);
    expect(r.oneLine).not.toMatch(/Supabase/i);
  });

  it("generatedAt is empty string (signals 'live-derived', not disk)", () => {
    const r = deriveBrainSummaryFromCounts(RITZ_LIKE);
    expect(r).not.toBeNull();
    if (r) expect(r.generatedAt).toBe("");
  });
});

describe("deriveBrainSummaryFromCounts — soft-gap tenants", () => {
  it("100-prompt × 1-platform tenant grades data B (300+ obs / 7d)", () => {
    const r = deriveBrainSummaryFromCounts({
      observations7dCount: 350,
      totalObservationCount: 5_000,
      recentSnapshotCount: 7,
      totalSnapshotCount: 200,
      ownedUrlsCitedCount: 3,
      recommendationQueueSize: 4,
      hasPlatformCoverage: false,
    });
    expect(r).not.toBeNull();
    if (!r) return;
    const dataGrade = r.sections.find((s) => s.label === "Data health")
      ?.grade;
    expect(dataGrade).toBe("B");
  });

  it("warmup tenant (100 obs / 7d) grades data C", () => {
    const r = deriveBrainSummaryFromCounts({
      observations7dCount: 100,
      totalObservationCount: 200,
      recentSnapshotCount: 2,
      totalSnapshotCount: 30,
      ownedUrlsCitedCount: 1,
      recommendationQueueSize: 2,
      hasPlatformCoverage: false,
    });
    expect(r).not.toBeNull();
    if (!r) return;
    const dataGrade = r.sections.find((s) => s.label === "Data health")
      ?.grade;
    expect(dataGrade).toBe("C");
  });

  it("very early tenant (any obs > 0 but < 100) grades data D", () => {
    const r = deriveBrainSummaryFromCounts({
      observations7dCount: 25,
      totalObservationCount: 60,
      recentSnapshotCount: 1,
      totalSnapshotCount: 5,
      ownedUrlsCitedCount: 0,
      recommendationQueueSize: 0,
      hasPlatformCoverage: false,
    });
    expect(r).not.toBeNull();
    if (!r) return;
    const dataGrade = r.sections.find((s) => s.label === "Data health")
      ?.grade;
    expect(dataGrade).toBe("D");
  });
});

describe("deriveBrainSummaryFromCounts — overall grade is the worst section", () => {
  it("overall grade equals the worst of the four section grades", () => {
    // Force one section to D, others to A. Overall must be D.
    const r = deriveBrainSummaryFromCounts({
      observations7dCount: 700, // → A
      totalObservationCount: 12_000,
      recentSnapshotCount: 14, // ≥7 → A path
      totalSnapshotCount: 800,
      ownedUrlsCitedCount: 8, // ≥5 → A path
      recommendationQueueSize: 0, // → D
      hasPlatformCoverage: true,
    });
    expect(r).not.toBeNull();
    if (r) expect(r.grade).toBe("D");
  });
});
