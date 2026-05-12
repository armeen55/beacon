/**
 * Perf bundle 5 (2026-05-12) — behavioral test for the discrepancy gate.
 *
 * Proves that `extractEntities` + `detectDiscrepancies` are NOT invoked
 * when any of the 5 earlier `nextCandidates` pushes already produced a
 * non-null entry. The Ritz local fixture has:
 *   - `page-guardrails.json` includes 1 row with severity=warning →
 *     `warningAlerts.length > 0` → first push fires.
 *   - `page-issues.json` includes 5 rows with status="new" →
 *     `newIssues.length > 0` → third push fires.
 * So on this fixture, the gate MUST close and the discrepancy work
 * MUST be skipped. The spy proves it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Spies installed BEFORE today-data is dynamically imported so the
// gate's downstream module load resolves to our mocked exports.
const extractEntitiesSpy = vi.fn(async () => ({
  computed_at: new Date().toISOString(),
  entities: [],
  owned_brand: "Ritz Builders",
  owned_locations: [],
  owned_services: [],
}));
const detectDiscrepanciesSpy = vi.fn(async () => ({
  computed_at: new Date().toISOString(),
  total_answers_checked: 0,
  discrepancies: [],
  data_note: null,
}));

vi.mock("@/domains/entity/entity-extract", async () => {
  const actual = await vi.importActual<
    typeof import("@/domains/entity/entity-extract")
  >("@/domains/entity/entity-extract");
  return {
    ...actual,
    extractEntities: extractEntitiesSpy,
  };
});

vi.mock("@/domains/entity/discrepancy-detect", async () => {
  const actual = await vi.importActual<
    typeof import("@/domains/entity/discrepancy-detect")
  >("@/domains/entity/discrepancy-detect");
  return {
    ...actual,
    detectDiscrepancies: detectDiscrepanciesSpy,
  };
});

describe("Perf bundle 5 — discrepancy gate (behavioral)", () => {
  beforeEach(() => {
    extractEntitiesSpy.mockClear();
    detectDiscrepanciesSpy.mockClear();
    process.env.BEACON_TENANT_ID = "tenant-ritz-founder";
    process.env.BEACON_TENANT_SLUG = "ritz-builders";
  });

  it(
    "skips extractEntities + detectDiscrepancies when an earlier candidate fires (Ritz fixture)",
    async () => {
      const canonical = await import("@/storage/canonical-store");
      canonical._resetCanonicalStoreStateForTests?.();

      const todayData = await import("@/app/(shell)/today-data");
      await todayData.loadTodayPageData();

      // The Ritz fixture has 1 warning-severity guardrail and 5 new
      // page-issues; either is enough to make `nextCandidates.some(c =>
      // c != null)` true at the gate site, which must skip the
      // expensive discrepancy work.
      expect(extractEntitiesSpy).toHaveBeenCalledTimes(0);
      expect(detectDiscrepanciesSpy).toHaveBeenCalledTimes(0);
    },
    30_000,
  );

  it(
    "loadTodayPageData still returns the expected top-level keys (gate didn't break the loader)",
    async () => {
      const canonical = await import("@/storage/canonical-store");
      canonical._resetCanonicalStoreStateForTests?.();

      const todayData = await import("@/app/(shell)/today-data");
      const data = await todayData.loadTodayPageData();

      // Smoke check: full data shape still includes the v2-critical keys.
      // (Not a snapshot — we only care that the gate didn't accidentally
      // drop a top-level field.)
      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
      // Visibility chart subtree — present in both v1 and v2.
      expect("visibilityData" in data).toBe(true);
      // Today summary block (contains nextMove + verifiedFixes + crawl).
      expect("summary" in data).toBe(true);
      // Today's primary/secondary action cards.
      expect("primaryAction" in data).toBe(true);
      expect("secondaryAction" in data).toBe(true);
      // Scoreboard (Today's KPI tiles).
      expect("scoreboard" in data).toBe(true);
      // Measured wins (Today's recent wins rail).
      expect("measuredWins" in data).toBe(true);
    },
    30_000,
  );
});
