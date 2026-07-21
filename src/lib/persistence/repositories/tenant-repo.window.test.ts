/**
 * E3 (operator audit, 2026-05-05) — runtime test for the windowed-read
 * filter at the file-backend tenant-repo layer.
 *
 * Pure compute test against `buildTenantRepo`. The Supabase backend
 * pushes the filter down to Postgres (`.gte("observed_at", since)`)
 * and we trust Postgres to honor it. The file backend filters
 * in-memory after the disk read, so we verify the JS filter logic
 * here.
 */

import { describe, expect, it } from "vitest";
import { buildTenantRepo } from "./tenant-repo";
import type { SeedDataRepository } from "./types";

const TENANT = "tenant-test";

function obs(observed_at: string, tenant_id: string = TENANT) {
  return { id: `${observed_at}_${tenant_id}`, observed_at, tenant_id };
}

function snap(date: string, tenant_id: string = TENANT) {
  // The DailyMetricSnapshot column is `date` (YYYY-MM-DD), NOT
  // `for_date` — check `src/domains/daily-metric-snapshots/types.ts`.
  return { id: `${date}_${tenant_id}`, date, tenant_id };
}

/**
 * Minimal SeedDataRepository stub — only the two methods the tests
 * exercise. Other methods throw if hit (signal we wandered out of
 * scope).
 */
function stubRepo(observations: unknown[], snapshots: unknown[]): SeedDataRepository {
  const notImpl = () => {
    throw new Error("not impl in test stub");
  };
  return {
    getImportRuns: notImpl,
    getResults: notImpl,
    getChangelogEntries: notImpl,
    getOpportunities: notImpl,
    getCompetitors: notImpl,
    getOutcomes: notImpl,
    getEventDecisions: notImpl,
    getCandidateLinks: notImpl,
    getTruthLabels: notImpl,
    getPageIssues: notImpl,
    getRolloutExecutions: notImpl,
    getPatternEvidence: notImpl,
    getRolloutWaves: notImpl,
    getFrontierOpportunities: notImpl,
    getFrontierAttackPackages: notImpl,
    getTrackedMissingPages: notImpl,
    getAssetResponses: notImpl,
    getOutcomeObservations: notImpl,
    getCompetitorPageEvidence: notImpl,
    getSourcePatternEvidence: notImpl,
    getChangeContracts: notImpl,
    getPages: notImpl,
    getPageSnapshots: notImpl,
    getPageSnapshotDiffs: notImpl,
    getCitationEvidenceIndex: notImpl,
    getSitemapReconciliation: notImpl,
    getAnswerIntelligenceIndex: notImpl,
    getRenderCheckResults: notImpl,
    getVisibilityObservationRuns: notImpl,
    getGuardrailAlerts: notImpl,
    getObservationRuns: notImpl,
    getConfiguredCompetitors: notImpl,
    getScanFindings: notImpl,
    getPendingScanFindings: notImpl,
    getRecommendationResponses: notImpl,
    getUrlChangeOutcomes: notImpl,
    getRecommendedEdits: notImpl,
    getPageElementInventory: notImpl,
    getPromptAnswerObservations: async () => observations as never,
    getDailyMetricSnapshots: async () => snapshots as never,
    getTrackedEntities: notImpl,
    getTrackedPrompts: notImpl,
    forTenant: notImpl,
  } as unknown as SeedDataRepository;
}

describe("E3 — tenant-repo getPromptAnswerObservations honors `since` window", () => {
  const observations = [
    obs("2026-03-01T00:00:00Z"),
    obs("2026-04-01T00:00:00Z"),
    obs("2026-04-15T00:00:00Z"),
    obs("2026-05-01T00:00:00Z"),
    obs("2026-05-05T12:00:00Z"),
    obs("2026-05-01T00:00:00Z", "tenant-other"), // wrong tenant
  ];

  it("returns full history when no options provided (back-compat)", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    const out = await repo.getPromptAnswerObservations();
    expect(out.length).toBe(5); // 5 right-tenant rows
  });

  it("filters at-or-after `since` ISO date when provided", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    const out = await repo.getPromptAnswerObservations({
      since: "2026-04-15T00:00:00Z",
    });
    expect(out.length).toBe(3); // Apr-15, May-1, May-5
    for (const o of out) {
      expect((o as unknown as { observed_at: string }).observed_at).toMatch(
        /^2026-(04-15|05)/,
      );
    }
  });

  it("date-only `since` (YYYY-MM-DD) compares lexicographically against ISO timestamp", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    // ISO-string compare: "2026-05-01" >= "2026-04-15" → keeps Apr-15+
    // (YYYY-MM-DD prefix ordering is lexicographic-correct)
    const out = await repo.getPromptAnswerObservations({
      since: "2026-04-15",
    });
    expect(out.length).toBe(3);
  });

  it("never returns cross-tenant rows (tenant filter is applied first)", async () => {
    const repo = buildTenantRepo(stubRepo(observations, []), TENANT);
    const out = await repo.getPromptAnswerObservations({
      since: "2020-01-01",
    });
    expect(out.length).toBe(5);
    for (const o of out) {
      expect((o as unknown as { tenant_id: string }).tenant_id).toBe(TENANT);
    }
  });
});

describe("E3 — tenant-repo getDailyMetricSnapshots honors `since` window", () => {
  const snaps = [
    snap("2026-03-01"),
    snap("2026-04-15"),
    snap("2026-05-01"),
    snap("2026-05-05"),
    snap("2026-05-01", "tenant-other"),
  ];

  it("returns full history when no options provided", async () => {
    const repo = buildTenantRepo(stubRepo([], snaps), TENANT);
    const out = await repo.getDailyMetricSnapshots();
    expect(out.length).toBe(4);
  });

  it("filters by `since` date", async () => {
    const repo = buildTenantRepo(stubRepo([], snaps), TENANT);
    const out = await repo.getDailyMetricSnapshots({ since: "2026-04-15" });
    expect(out.length).toBe(3);
    for (const s of out) {
      expect((s as unknown as { date: string }).date >= "2026-04-15").toBe(
        true,
      );
    }
  });
});
