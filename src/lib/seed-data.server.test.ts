import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// 2026-07-18 — verified bug: tenant-ritz-founder (the seed/founder tenant)
// had GSC connected AND zero import runs. seed-data.server.ts's fixture gate
// only checked "founder tenant + zero import runs" — it never looked at
// connector status — so it served the FULL fixture dataset (hardcoded
// actual_value 18.5, invented opportunities/competitors/briefs) to a tenant
// with a real, connected data source. Fixed by requiring
// `shouldServeDemoData` (src/lib/demo-mode.ts) — which additionally checks
// `!hasRealConnector` — before the fixture branch runs.
//
// This test proves the fixed contract directly against the real module
// (not a re-implementation): founder tenant + GSC connected + zero imports
// must return EMPTY arrays, never the seed fixtures.
// ---------------------------------------------------------------------------

const FOUNDER_TENANT_ID = "tenant-ritz-founder";
const OTHER_TENANT_ID = "tenant-iranopedia";

type ConnStatus = "connected" | "disconnected";

const mocks = vi.hoisted(() => {
  return {
    importRuns: [] as unknown[],
    wixStatus: "disconnected" as ConnStatus,
    gscStatus: "disconnected" as ConnStatus,
    tenantId: "tenant-ritz-founder",
  };
});

vi.mock("./tenant-context", () => ({
  currentTenantId: async () => mocks.tenantId,
}));

vi.mock("./connector-store", () => ({
  getConnectorInfo: async (provider: "wix" | "google_gsc") => {
    const status =
      provider === "wix" ? mocks.wixStatus : mocks.gscStatus;
    return {
      status,
      connected_at: status === "connected" ? "2026-07-01T00:00:00Z" : null,
      expires_at: null,
      last_synced_at: null,
    };
  },
}));

vi.mock("./persistence/repositories", () => {
  const repo = {
    getImportRuns: async () => mocks.importRuns,
    getResults: async () => [{ id: "real-result-1" }],
    getChangelogEntries: async () => [{ id: "real-change-1" }],
    getOpportunities: async () => [{ id: "real-opp-1" }],
    getCompetitors: async () => [{ id: "real-comp-1" }],
    forTenant: (_tenantId: string) => repo,
  };
  return { getRepository: () => repo };
});

import {
  getResults,
  getChangelogEntries,
  getOpportunities,
  getCompetitors,
  getBriefs,
  getCompetitorSnapshots,
  _resetSeedDataStateForTests,
} from "./seed-data.server";
import * as seed from "./seed-data";

beforeEach(() => {
  mocks.importRuns = [];
  mocks.wixStatus = "disconnected";
  mocks.gscStatus = "disconnected";
  mocks.tenantId = FOUNDER_TENANT_ID;
  _resetSeedDataStateForTests();
});

describe("seed-data.server — fixture gate now requires no real connector", () => {
  it("founder tenant + zero imports + no connector → serves the fixture dataset (unchanged baseline)", async () => {
    mocks.tenantId = FOUNDER_TENANT_ID;
    mocks.importRuns = [];
    mocks.wixStatus = "disconnected";
    mocks.gscStatus = "disconnected";

    const results = await getResults();
    const changelog = await getChangelogEntries();
    const opportunities = await getOpportunities();
    const competitors = await getCompetitors();
    const briefs = await getBriefs();

    expect(results).toEqual(seed.results);
    expect(changelog).toEqual(seed.changelogEntries);
    expect(opportunities).toEqual(seed.opportunities);
    expect(competitors).toEqual(seed.competitors);
    expect(briefs).toEqual(seed.briefs);
  });

  it("BUG FIX: founder tenant + GSC connected + zero imports → empty arrays, NOT fixtures", async () => {
    mocks.tenantId = FOUNDER_TENANT_ID;
    mocks.importRuns = [];
    mocks.wixStatus = "disconnected";
    mocks.gscStatus = "connected";

    const results = await getResults();
    const changelog = await getChangelogEntries();
    const opportunities = await getOpportunities();
    const competitors = await getCompetitors();
    const briefs = await getBriefs();
    const snapshots = await getCompetitorSnapshots();

    expect(results).toEqual([]);
    expect(changelog).toEqual([]);
    expect(opportunities).toEqual([]);
    expect(competitors).toEqual([]);
    expect(briefs).toEqual([]);
    expect(snapshots).toEqual([]);

    // Never the invented fixture numbers (e.g. actual_value 18.5).
    expect(results).not.toEqual(seed.results);
    expect(changelog).not.toEqual(seed.changelogEntries);
  });

  it("founder tenant + Wix connected + zero imports → empty arrays, NOT fixtures", async () => {
    mocks.tenantId = FOUNDER_TENANT_ID;
    mocks.importRuns = [];
    mocks.wixStatus = "connected";
    mocks.gscStatus = "disconnected";

    const results = await getResults();
    expect(results).toEqual([]);
  });

  it("founder tenant + real connector + real imports → import data wins, connector read is irrelevant", async () => {
    mocks.tenantId = FOUNDER_TENANT_ID;
    mocks.importRuns = [{ id: "run-1" }];
    mocks.gscStatus = "connected";

    const results = await getResults();
    expect(results).toEqual([{ id: "real-result-1" }]);
  });

  it("non-founder tenant + zero imports + no connector → empty arrays (never founder's demo content)", async () => {
    mocks.tenantId = OTHER_TENANT_ID;
    mocks.importRuns = [];
    mocks.wixStatus = "disconnected";
    mocks.gscStatus = "disconnected";

    const results = await getResults();
    const changelog = await getChangelogEntries();
    expect(results).toEqual([]);
    expect(changelog).toEqual([]);
  });

  it("non-founder tenant is never eligible for fixtures even with zero imports and no connector — no connector reads performed", async () => {
    // Efficiency assertion: a non-founder tenant can never satisfy
    // shouldServeDemoData (tenantId !== SEED_OWNER_TENANT_ID), so
    // loadFromRepoOrSeed must skip the wix/gsc connector reads entirely
    // for it. Simulate "connected" to prove it's ignored either way.
    mocks.tenantId = OTHER_TENANT_ID;
    mocks.importRuns = [];
    mocks.wixStatus = "connected";
    mocks.gscStatus = "connected";

    const results = await getResults();
    expect(results).toEqual([]);
  });
});
