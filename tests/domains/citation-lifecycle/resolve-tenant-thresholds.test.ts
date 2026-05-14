/**
 * Phase A.2 Step 3b — `resolveTenantThresholdsCached` behavior tests.
 *
 * The helper is the single source of truth for the tenant's
 * threshold decision. Both lifecycle loaders consume it (Changes
 * detail directly; Today tile via the summary loader's inline
 * compute on the same records). These tests pin:
 *
 *   • Empty tenant returns `profound_default` with sample_size 0.
 *   • Sub-gate tenant (< 20 cited records) returns `profound_default`.
 *   • At-gate tenant (>= 20 cited records) returns `per_tenant` with
 *     expected thresholds.
 *   • Determinism — same fixture called twice returns the same
 *     decision shape.
 *   • Tenant isolation — foreign-tenant data is dropped.
 *   • Path A pre-cutover support — benchmark/cold-store citations
 *     contribute correctly when `live_at < NATIVE_REGIME_START`.
 *
 * Reuses the mock pattern from load-lifecycle.test.ts (next/cache
 * pass-through; stub repository; cold-store fixture).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

type RepoFixture = {
  promptAnswerObservations: ReadonlyArray<{
    id: string;
    prompt_id: string;
    run_id: string;
    answer_hash: string | null;
    position: number | null;
    tracked_brand_mentioned: boolean | null;
    tracked_brand_cited: boolean | null;
    citation_count: number;
    owned_citation_count: number;
    citation_domains: string[];
    citation_categories: Partial<Record<string, number>>;
    mentions: string[];
    observed_at: string;
    platform: string;
    topic: string;
    metadata: Record<string, unknown>;
    tenant_id: string;
    citation_urls?: string[] | null;
  }>;
  recommendedEdits: ReadonlyArray<{
    id: string;
    tenant_id: string;
    rec_id: string;
    action_type: string;
    target_url: string;
    target_element_key: string | null;
    implementation_status:
      | "verified_live"
      | "verified_live_modified"
      | "partially_implemented"
      | "recommended"
      | "dismissed";
    live_at: string | null;
  }>;
};

let _repoFixture: RepoFixture = {
  promptAnswerObservations: [],
  recommendedEdits: [],
};

function setRepoFixture(next: Partial<RepoFixture>): void {
  _repoFixture = { ..._repoFixture, ...next };
}

vi.mock("@/lib/persistence/repositories", () => {
  return {
    getRepository: () => ({
      forTenant: (tenantId: string) => ({
        getPromptAnswerObservations: async (options?: { since?: string }) => {
          let rows = _repoFixture.promptAnswerObservations.filter(
            (r) => r.tenant_id === tenantId,
          );
          if (options?.since) {
            const since = options.since;
            rows = rows.filter((r) => r.observed_at.slice(0, 10) >= since);
          }
          return rows;
        },
        getRecommendedEdits: async () =>
          _repoFixture.recommendedEdits.filter((r) => r.tenant_id === tenantId),
      }),
    }),
  };
});

let _shardCalls: string[] = [];
let _shardFixture: Record<
  string,
  Array<{
    id: string;
    prompt_answer_id: string;
    domain: string;
    url: string | null;
    title: string | null;
    citation_order: number | null;
    source_category: string;
    is_owned: boolean;
    tracked_entity_id: string | null;
    observed_at: string;
  }>
> = {};

function setShardFixture(next: Record<string, Array<unknown>>): void {
  _shardFixture = next as typeof _shardFixture;
}

vi.mock("@/lib/persistence/cold-store", () => ({
  getCitationsForDate: (date: string) => {
    _shardCalls.push(date);
    return _shardFixture[date] ?? [];
  },
}));

import { resolveTenantThresholdsCached } from "@/domains/citation-lifecycle/load-lifecycle";

const TENANT = "tenant-test-thresholds";
const FOREIGN_TENANT = "tenant-other";

const NOW = "2026-05-30T00:00:00.000Z";

beforeEach(() => {
  _shardCalls = [];
  _shardFixture = {};
  setRepoFixture({
    promptAnswerObservations: [],
    recommendedEdits: [],
  });
});

afterEach(() => {
  // No persistent state to restore beyond the per-test fixture
  // reset above.
});

/**
 * Helper — build N cited records in the post-cutover regime with
 * `days_to_first_citation` = 8 (cited_typical under Profound) so
 * the threshold compute has a deterministic input.
 */
function citedFixture(count: number, tenantId: string = TENANT) {
  // Mutable arrays during construction; the public RepoFixture type
  // narrows them back to ReadonlyArray when the fixture is assigned.
  const recommendedEdits: Array<RepoFixture["recommendedEdits"][number]> = [];
  const promptAnswerObservations: Array<
    RepoFixture["promptAnswerObservations"][number]
  > = [];
  for (let i = 0; i < count; i++) {
    const url = `https://example.com/services/page-${i}`;
    const editId = `edit-${tenantId}-${i}`;
    const paId = `pa-${tenantId}-${i}`;
    const liveDate = new Date("2026-05-01T00:00:00.000Z");
    const citationDate = new Date(liveDate.getTime() + 8 * 86_400_000);
    recommendedEdits.push({
      id: editId,
      tenant_id: tenantId,
      rec_id: `rec-${tenantId}-${i}`,
      action_type: "add_h2_section",
      target_url: url,
      target_element_key: `h2[new]:${i}`,
      implementation_status: "verified_live",
      live_at: liveDate.toISOString(),
    });
    promptAnswerObservations.push({
      id: paId,
      prompt_id: `p-${i}`,
      run_id: `r-${i}`,
      answer_hash: null,
      position: 1,
      tracked_brand_mentioned: true,
      tracked_brand_cited: true,
      citation_count: 1,
      owned_citation_count: 1,
      citation_domains: ["example.com"],
      citation_categories: {},
      mentions: [],
      observed_at: citationDate.toISOString(),
      platform: "chatgpt",
      topic: "remodel",
      metadata: {},
      tenant_id: tenantId,
      citation_urls: [url],
    });
  }
  return { recommendedEdits, promptAnswerObservations };
}

// ────────────────────────────────────────────────────────────────────
// Case 1: empty tenant → profound_default
// ────────────────────────────────────────────────────────────────────

describe("resolveTenantThresholdsCached — empty + sub-gate", () => {
  it("empty tenant returns profound_default with sample_size 0", async () => {
    const decision = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    expect(decision.source).toBe("profound_default");
    expect(decision.sample_size).toBe(0);
    expect(decision.excluded_count).toBe(0);
    expect(decision.thresholds).toEqual({
      fast_days: 6,
      median_days: 18,
      late_days: 37,
    });
  });

  it("sub-gate tenant (5 cited records) returns profound_default", async () => {
    setRepoFixture(citedFixture(5));
    const decision = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    expect(decision.source).toBe("profound_default");
    expect(decision.sample_size).toBe(5);
    expect(decision.thresholds).toEqual({
      fast_days: 6,
      median_days: 18,
      late_days: 37,
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 2: at-gate tenant → per_tenant
// ────────────────────────────────────────────────────────────────────

describe("resolveTenantThresholdsCached — at-gate + above-gate", () => {
  it("exactly 20 cited records (all same 8-day timing) returns per_tenant with collapsed thresholds = 8", async () => {
    setRepoFixture(citedFixture(20));
    const decision = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    expect(decision.source).toBe("per_tenant");
    expect(decision.sample_size).toBe(20);
    // All 20 records have days_to_first_citation = 8 → percentiles
    // p50/p75/p90 all = 8.
    expect(decision.thresholds).toEqual({
      fast_days: 8,
      median_days: 8,
      late_days: 8,
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 3: determinism (same fixture twice → same decision shape)
// ────────────────────────────────────────────────────────────────────

describe("resolveTenantThresholdsCached — determinism", () => {
  it("called twice with the same fixture returns deep-equal decisions", async () => {
    setRepoFixture(citedFixture(22));
    const a = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    const b = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    // Same shape — not the same object reference (cache pass-
    // through in tests doesn't memoize the result).
    expect(a).toEqual(b);
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 4: tenant scope — foreign-tenant data dropped
// ────────────────────────────────────────────────────────────────────

describe("resolveTenantThresholdsCached — tenant isolation (Section 2.4)", () => {
  it("foreign-tenant edits + observations do NOT contribute to the decision", async () => {
    const own = citedFixture(5, TENANT);
    const foreign = citedFixture(25, FOREIGN_TENANT);
    setRepoFixture({
      recommendedEdits: [
        ...own.recommendedEdits,
        ...foreign.recommendedEdits,
      ],
      promptAnswerObservations: [
        ...own.promptAnswerObservations,
        ...foreign.promptAnswerObservations,
      ],
    });
    const decision = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });
    expect(decision.source).toBe("profound_default");
    expect(decision.sample_size).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 5: Path A pre-cutover support — benchmark shards contribute
// ────────────────────────────────────────────────────────────────────

describe("resolveTenantThresholdsCached — Path A pre-cutover support", () => {
  it("benchmark/cold-store citations on pre-NATIVE_REGIME_START edits contribute to the decision", async () => {
    // The default 90-day window relative to NOW = 2026-05-30 starts
    // at 2026-03-01 — overlaps the pre-cutover regime. Seed a single
    // pre-cutover edit + a pre-cutover prompt-answer + a benchmark
    // shard citation that matches the target URL. Then bulk-seed 19
    // more cited post-cutover records so the gate fires with a
    // mixed-regime sample.
    const preCutoverDate = "2026-04-01T00:00:00.000Z"; // < NATIVE_REGIME_START
    const preCutoverPaId = "pa-pre-cutover";
    const preCutoverEditId = "edit-pre-cutover";
    const preCutoverUrl = "https://example.com/services/legacy-page";

    const bulk = citedFixture(19, TENANT);

    setRepoFixture({
      recommendedEdits: [
        ...bulk.recommendedEdits,
        {
          id: preCutoverEditId,
          tenant_id: TENANT,
          rec_id: "rec-pre-cutover",
          action_type: "add_h2_section",
          target_url: preCutoverUrl,
          target_element_key: "h2[new]:pre-cutover",
          implementation_status: "verified_live",
          live_at: preCutoverDate,
        },
      ],
      promptAnswerObservations: [
        ...bulk.promptAnswerObservations,
        {
          id: preCutoverPaId,
          prompt_id: "p-pre",
          run_id: "r-pre",
          answer_hash: null,
          position: 1,
          tracked_brand_mentioned: true,
          tracked_brand_cited: true,
          citation_count: 1,
          owned_citation_count: 1,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-04-05T00:00:00.000Z",
          platform: "perplexity",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: null, // pre-Commit-7 — native field empty
        },
      ],
    });
    setShardFixture({
      "2026-04-05": [
        {
          id: "cit-pre",
          prompt_answer_id: preCutoverPaId,
          domain: "example.com",
          url: preCutoverUrl,
          title: null,
          citation_order: 1,
          source_category: "owned",
          is_owned: true,
          tracked_entity_id: null,
          observed_at: "2026-04-05T00:00:00.000Z",
        },
      ],
    });

    const decision = await resolveTenantThresholdsCached({
      tenantId: TENANT,
      now: NOW,
    });

    // 19 post-cutover cited records + 1 pre-cutover cited record
    // (citation via benchmark shard) = 20 total cited → gate fires.
    expect(decision.source).toBe("per_tenant");
    expect(decision.sample_size).toBe(20);
    // Shard reader was consulted for the pre-cutover date.
    expect(_shardCalls).toContain("2026-04-05");
  });
});
