/**
 * Customer-2 isolation — behavioral tenant-isolation test (file backend).
 *
 * Background (operator audit, 2026-05-06): Sibling to
 * `tests/architecture/canonical-store-tenant-isolation.test.ts`. The
 * architecture invariant proves the SOURCE shape (no raw
 * `repo.getTrackedPrompts/Entities` outside a `tenantRepo.` chain).
 * This test proves the RUNTIME shape: when a base repository holds
 * mixed-tenant rows for `tracked_prompts` and `tracked_entities`, the
 * `tenantRepo` facade returns only the calling tenant's rows. With
 * customer-2 onboarding imminent, this is the empirical guarantee
 * that Ritz's prompts + competitors will not bleed into customer-2's
 * /today leaderboard via `loadFreshCanonicalData()`.
 *
 * SCOPE — what's checked here:
 *   • A populated tenant gets back exactly its own rows.
 *   • An empty tenant gets back [] (no leak from the populated tenant).
 *   • Cross-checked: no row from tenant A ever appears in tenant B's
 *     output.
 *   • Same guarantee covers both `getTrackedPrompts` and
 *     `getTrackedEntities`.
 *
 * The test wraps a fake `SeedDataRepository` so it runs at unit speed
 * with no I/O. The Supabase pushdown layer is exercised separately by
 * `tests/persistence/tenant-repository-pushdown.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { buildTenantRepo } from "@/lib/persistence/repositories/tenant-repo";
import type {
  SeedDataRepository,
  TenantRepository,
} from "@/lib/persistence/repositories/types";
import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";

const TENANT_A = "tenant-a-populated";
const TENANT_A_SLUG = "tenant-a";
const TENANT_B = "tenant-b-empty";
const TENANT_B_SLUG = "tenant-b";
const TENANT_C = "tenant-c-also-populated";
const TENANT_C_SLUG = "tenant-c";

function makePrompt(
  id: string,
  tenantId: string,
  accountSlug: string,
  text: string,
): TrackedPrompt & { tenant_id: string } {
  return {
    id,
    account_id: accountSlug,
    tenant_id: tenantId,
    text,
    topic_id: null,
    location_scope: null,
    service_scope: null,
    intent_type: "informational",
    platforms: ["chatgpt"],
    tags: [],
    is_active: true,
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
  };
}

function makeEntity(
  id: string,
  tenantId: string,
  accountSlug: string,
  name: string,
): TrackedEntity & { tenant_id: string } {
  return {
    id,
    account_id: accountSlug,
    tenant_id: tenantId,
    entity_type: "competitor",
    name,
    aliases: [],
    domain: null,
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: false,
    is_active: true,
    metadata: {},
    created_at: "2026-05-06T00:00:00.000Z",
    updated_at: "2026-05-06T00:00:00.000Z",
  };
}

const PROMPTS_A: TrackedPrompt[] = [
  makePrompt(
    "p-a-1",
    TENANT_A,
    TENANT_A_SLUG,
    "best builder in city A",
  ),
  makePrompt(
    "p-a-2",
    TENANT_A,
    TENANT_A_SLUG,
    "tenant A second prompt",
  ),
];
const PROMPTS_C: TrackedPrompt[] = [
  makePrompt(
    "p-c-1",
    TENANT_C,
    TENANT_C_SLUG,
    "tenant C only prompt",
  ),
];
const ENTITIES_A: TrackedEntity[] = [
  makeEntity("e-a-1", TENANT_A, TENANT_A_SLUG, "Tenant A Competitor 1"),
  makeEntity("e-a-2", TENANT_A, TENANT_A_SLUG, "Tenant A Competitor 2"),
];
const ENTITIES_C: TrackedEntity[] = [
  makeEntity("e-c-1", TENANT_C, TENANT_C_SLUG, "Tenant C Competitor"),
];

const ALL_PROMPTS = [...PROMPTS_A, ...PROMPTS_C];
const ALL_ENTITIES = [...ENTITIES_A, ...ENTITIES_C];

/**
 * Fake `SeedDataRepository` that returns the unscoped union of rows
 * across all tenants, mirroring the file-backend behavior of
 * `repo.getTrackedPrompts()` / `repo.getTrackedEntities()` (which
 * read every row off `.data/global/tracked-*.json`).
 *
 * Only the two methods under test are wired; the rest throw to make
 * accidental coupling loud.
 */
function buildFakeBase(): SeedDataRepository {
  const notImplemented = (name: string) => () => {
    throw new Error(`fake base does not implement ${name}`);
  };
  const fake = {
    getTrackedPrompts: async () => ALL_PROMPTS,
    getTrackedEntities: async () => ALL_ENTITIES,
    // Other SeedDataRepository methods aren't exercised by these tests;
    // surface a loud error if a future path quietly starts depending
    // on them.
    getImportRuns: notImplemented("getImportRuns"),
    getResults: notImplemented("getResults"),
    getChangelogEntries: notImplemented("getChangelogEntries"),
    getOpportunities: notImplemented("getOpportunities"),
    getCompetitors: notImplemented("getCompetitors"),
    getEventDecisions: notImplemented("getEventDecisions"),
    getCandidateLinks: notImplemented("getCandidateLinks"),
    getPageIssues: notImplemented("getPageIssues"),
    getChangeContracts: notImplemented("getChangeContracts"),
    getPages: notImplemented("getPages"),
    getPageSnapshots: notImplemented("getPageSnapshots"),
    getGuardrailAlerts: notImplemented("getGuardrailAlerts"),
    getCitationEvidenceIndex: notImplemented("getCitationEvidenceIndex"),
    getScanFindings: notImplemented("getScanFindings"),
    getPendingScanFindings: notImplemented("getPendingScanFindings"),
    getAnswerIntelligenceIndex: notImplemented("getAnswerIntelligenceIndex"),
    getObservationRuns: notImplemented("getObservationRuns"),
    getCompetitorConfigEntries: notImplemented("getCompetitorConfigEntries"),
    getPageSnapshotDiffs: notImplemented("getPageSnapshotDiffs"),
    getRenderChecks: notImplemented("getRenderChecks"),
    getSitemapReconciliation: notImplemented("getSitemapReconciliation"),
    getVisibilityObservationRunsExplicit: notImplemented(
      "getVisibilityObservationRunsExplicit",
    ),
    getRolloutExecutions: notImplemented("getRolloutExecutions"),
    getPatternEvidence: notImplemented("getPatternEvidence"),
    getRolloutWaves: notImplemented("getRolloutWaves"),
    getFrontierOpportunities: notImplemented("getFrontierOpportunities"),
    getFrontierAttackPackages: notImplemented("getFrontierAttackPackages"),
    getTrackedMissingPages: notImplemented("getTrackedMissingPages"),
    getAssetResponses: notImplemented("getAssetResponses"),
    getOutcomeObservations: notImplemented("getOutcomeObservations"),
    getCompetitorPageEvidence: notImplemented("getCompetitorPageEvidence"),
    getSourcePatternEvidence: notImplemented("getSourcePatternEvidence"),
    getActionStates: notImplemented("getActionStates"),
    getBriefStates: notImplemented("getBriefStates"),
    getTruthLabels: notImplemented("getTruthLabels"),
    getRecommendationResponses: notImplemented("getRecommendationResponses"),
    getUrlChangeOutcomes: notImplemented("getUrlChangeOutcomes"),
    getRecommendedEdits: notImplemented("getRecommendedEdits"),
    getPageElementInventory: notImplemented("getPageElementInventory"),
    getPromptAnswerObservations: notImplemented("getPromptAnswerObservations"),
    getDailyMetricSnapshots: notImplemented("getDailyMetricSnapshots"),
    forTenant: (tenantId: string): TenantRepository =>
      buildTenantRepo(fake as SeedDataRepository, tenantId),
  } as unknown as SeedDataRepository;
  return fake;
}

describe("Customer-2 isolation — buildTenantRepo behavioral", () => {
  it("populated tenant A gets ONLY its own tracked_prompts (no rows from C, no leak)", async () => {
    const repoA = buildTenantRepo(buildFakeBase(), TENANT_A);
    const prompts = await repoA.getTrackedPrompts();
    expect(prompts).toHaveLength(PROMPTS_A.length);
    for (const p of prompts) {
      expect((p as unknown as { tenant_id: string }).tenant_id).toBe(TENANT_A);
    }
    // Cross-check: no tenant-C row leaked.
    const ids = new Set(prompts.map((p) => p.id));
    for (const c of PROMPTS_C) {
      expect(ids.has(c.id)).toBe(false);
    }
  });

  it("populated tenant A gets ONLY its own tracked_entities (no rows from C, no leak)", async () => {
    const repoA = buildTenantRepo(buildFakeBase(), TENANT_A);
    const entities = await repoA.getTrackedEntities();
    expect(entities).toHaveLength(ENTITIES_A.length);
    for (const e of entities) {
      expect((e as unknown as { tenant_id: string }).tenant_id).toBe(TENANT_A);
    }
    const ids = new Set(entities.map((e) => e.id));
    for (const c of ENTITIES_C) {
      expect(ids.has(c.id)).toBe(false);
    }
  });

  it("empty tenant B gets NO tracked_prompts even though base has tenant A + C rows", async () => {
    const repoB = buildTenantRepo(buildFakeBase(), TENANT_B);
    const prompts = await repoB.getTrackedPrompts();
    expect(prompts).toEqual([]);
  });

  it("empty tenant B gets NO tracked_entities even though base has tenant A + C rows", async () => {
    const repoB = buildTenantRepo(buildFakeBase(), TENANT_B);
    const entities = await repoB.getTrackedEntities();
    expect(entities).toEqual([]);
  });

  it("two populated tenants are mutually isolated — A never sees C, C never sees A", async () => {
    const base = buildFakeBase();
    const repoA = buildTenantRepo(base, TENANT_A);
    const repoC = buildTenantRepo(base, TENANT_C);

    const [promptsA, promptsC, entitiesA, entitiesC] = await Promise.all([
      repoA.getTrackedPrompts(),
      repoC.getTrackedPrompts(),
      repoA.getTrackedEntities(),
      repoC.getTrackedEntities(),
    ]);

    // Volumes match the per-tenant fixture.
    expect(promptsA).toHaveLength(PROMPTS_A.length);
    expect(promptsC).toHaveLength(PROMPTS_C.length);
    expect(entitiesA).toHaveLength(ENTITIES_A.length);
    expect(entitiesC).toHaveLength(ENTITIES_C.length);

    // Cross-tenant id sets are disjoint.
    const aPromptIds = new Set(promptsA.map((p) => p.id));
    const cPromptIds = new Set(promptsC.map((p) => p.id));
    for (const id of aPromptIds) expect(cPromptIds.has(id)).toBe(false);
    for (const id of cPromptIds) expect(aPromptIds.has(id)).toBe(false);

    const aEntityIds = new Set(entitiesA.map((e) => e.id));
    const cEntityIds = new Set(entitiesC.map((e) => e.id));
    for (const id of aEntityIds) expect(cEntityIds.has(id)).toBe(false);
    for (const id of cEntityIds) expect(aEntityIds.has(id)).toBe(false);
  });

  it("Ritz regression — a real-shaped tenantId with rows on disk gets back its rows (no false-empty)", async () => {
    // Mirrors the on-disk row shape:
    //   { id, account_id: 'ritz-builders', tenant_id: 'tenant-ritz-founder', ... }
    // The customer-2 fix must not regress Ritz: the tenant whose data
    // lives at `tenant_id === 'tenant-ritz-founder'` MUST still load
    // when the facade is called with that exact tenantId.
    const ritzId = "tenant-ritz-founder";
    const ritzSlug = "ritz-builders";
    const ritzPrompts: TrackedPrompt[] = [
      makePrompt("p-ritz-1", ritzId, ritzSlug, "best builder in atherton"),
      makePrompt("p-ritz-2", ritzId, ritzSlug, "luxury home builder bay area"),
    ];
    const ritzEntities: TrackedEntity[] = [
      makeEntity("e-ritz-1", ritzId, ritzSlug, "De Mattei Construction"),
      makeEntity("e-ritz-2", ritzId, ritzSlug, "Supple Homes"),
    ];
    const otherTenantPrompts: TrackedPrompt[] = [
      makePrompt(
        "p-other-1",
        "tenant-other",
        "other-tenant-slug",
        "competitor noise",
      ),
    ];
    const otherTenantEntities: TrackedEntity[] = [
      makeEntity("e-other-1", "tenant-other", "other-tenant-slug", "Houzz"),
    ];

    const allPrompts = [...ritzPrompts, ...otherTenantPrompts];
    const allEntities = [...ritzEntities, ...otherTenantEntities];

    const fake = {
      getTrackedPrompts: async () => allPrompts,
      getTrackedEntities: async () => allEntities,
      forTenant: (tenantId: string): TenantRepository =>
        buildTenantRepo(fake as SeedDataRepository, tenantId),
    } as unknown as SeedDataRepository;

    const ritzRepo = buildTenantRepo(fake, ritzId);
    const [prompts, entities] = await Promise.all([
      ritzRepo.getTrackedPrompts(),
      ritzRepo.getTrackedEntities(),
    ]);

    // Ritz prompts present, in full.
    expect(prompts).toHaveLength(ritzPrompts.length);
    expect(prompts.map((p) => p.id).sort()).toEqual(
      ritzPrompts.map((p) => p.id).sort(),
    );
    // Ritz entities present, in full.
    expect(entities).toHaveLength(ritzEntities.length);
    expect(entities.map((e) => e.id).sort()).toEqual(
      ritzEntities.map((e) => e.id).sort(),
    );
    // No other-tenant row leaked into Ritz's view.
    expect(prompts.map((p) => p.id)).not.toContain("p-other-1");
    expect(entities.map((e) => e.id)).not.toContain("e-other-1");
  });
});
