/**
 * Phase A.1 — `loadLifecycleForEdit` Path A enforcement tests.
 *
 * The loader is responsible for honoring the Section 2.4 Path A
 * decision: both citation regimes contribute to first-citation
 * detection. Specifically:
 *
 *   • Native regime (`live_at >= NATIVE_REGIME_START`): citations
 *     read via tenant-scoped `prompt_answer_observations.citation_urls`.
 *     Cold-store shards MUST NOT be consulted (cheap no-op).
 *   • Benchmark regime (`live_at < NATIVE_REGIME_START`): per-day
 *     `CitationObservation` shards in `.data/citations-by-date/` are
 *     read, and the compute layer's `promptAnswerById` filter drops
 *     any row referencing a `prompt_answer_id` outside the caller's
 *     tenant-scoped set (the only thing keeping multi-tenant citation
 *     reads tenant-safe — `CitationObservation` has no `tenant_id`).
 *
 * These tests pin both branches end-to-end and the cross-tenant
 * safety contract. They use mocked repository + cold-store
 * dependencies; the compute module under test is the real one.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  // Pass-through so `unstable_cache(fn, key, opts)` calls evaluate
  // `fn()` directly; we test the loader's behavior, not Next's
  // caching layer.
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// Stateful stub for the repository — tests set the data via
// `setRepoFixture(...)` before invoking the loader.
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

// Cold-store shard fixture — set by tests via `setShardFixture(...)`.
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

// Imports under test go AFTER the mocks so vitest hoists the mocks
// before the module evaluates.
import { loadLifecycleForEdit } from "@/domains/citation-lifecycle/load-lifecycle";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const TENANT = "tenant-test";

function makeEdit(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: TENANT,
    rec_id: "rec-1",
    action_type: "add_h2_section",
    target_url: "https://example.com/services/whole-home-remodel",
    target_element_key: "h2[new]:test",
    display_label: "Test edit",
    current_text: null,
    proposed_text: "test copy",
    why: "test",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "high",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    implementation_status: "verified_live",
    live_at: "2026-05-01T00:00:00.000Z",
    live_match_kind: "exact",
    live_match_confidence: "high",
    live_snapshot_id: null,
    live_element_key: "h2[new]:test",
    ...overrides,
  } as RecommendedEditRow;
}

beforeEach(() => {
  _shardCalls = [];
  _shardFixture = {};
  setRepoFixture({
    promptAnswerObservations: [],
    recommendedEdits: [],
  });
});

// ────────────────────────────────────────────────────────────────────
// Sanity check on the cutover constant — pins the assumption these
// tests are written against.
// ────────────────────────────────────────────────────────────────────

describe("NATIVE_REGIME_START anchor", () => {
  it("is 2026-04-22", () => {
    expect(NATIVE_REGIME_START).toBe("2026-04-22");
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 1 — post-cutover edit: cold-store reader is never called.
// ────────────────────────────────────────────────────────────────────

describe("loadLifecycleForEdit — post-cutover edit (Path A native branch)", () => {
  it("does NOT read benchmark shards when live_at >= NATIVE_REGIME_START", async () => {
    setRepoFixture({
      promptAnswerObservations: [
        {
          id: "pa-1",
          prompt_id: "p-1",
          run_id: "r-1",
          answer_hash: null,
          position: 1,
          tracked_brand_mentioned: true,
          tracked_brand_cited: true,
          citation_count: 1,
          owned_citation_count: 1,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-05-04T00:00:00.000Z",
          platform: "chatgpt",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: ["https://example.com/services/whole-home-remodel"],
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({ live_at: "2026-05-01T00:00:00.000Z" }),
      now: "2026-05-08T00:00:00.000Z",
    });

    expect(_shardCalls).toEqual([]);
    expect(result.available).toBe(true);
    expect(result.result.first_citation_date_iso).toBe("2026-05-04");
    expect(result.result.per_platform_first_citation.chatgpt).toBe("2026-05-04");
    expect(result.stage).toBe("cited_fast");
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 2 — pre-cutover edit: benchmark shards consulted, and a real
// `CitationObservation` row produces a first-citation date.
// ────────────────────────────────────────────────────────────────────

describe("loadLifecycleForEdit — pre-cutover edit (Path A benchmark branch)", () => {
  it("reads benchmark shards and surfaces a first citation from CitationObservation", async () => {
    setRepoFixture({
      promptAnswerObservations: [
        {
          // The benchmark CitationObservation references this pa id;
          // because the row IS in the tenant scope, the compute
          // layer will accept the citation.
          id: "pa-bench-1",
          prompt_id: "p-1",
          run_id: "r-bench-1",
          answer_hash: null,
          position: 1,
          tracked_brand_mentioned: true,
          tracked_brand_cited: true,
          citation_count: 1,
          owned_citation_count: 1,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-03-05T00:00:00.000Z",
          platform: "perplexity",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: null, // pre-Commit-7 native field
        },
      ],
    });
    setShardFixture({
      "2026-03-05": [
        {
          id: "cit-bench-1",
          prompt_answer_id: "pa-bench-1",
          domain: "example.com",
          url: "https://example.com/services/whole-home-remodel",
          title: null,
          citation_order: 1,
          source_category: "owned",
          is_owned: true,
          tracked_entity_id: null,
          observed_at: "2026-03-05T00:00:00.000Z",
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({ live_at: "2026-03-01T00:00:00.000Z" }),
      // `now` is before the cutover so the entire window is benchmark.
      now: "2026-03-12T00:00:00.000Z",
    });

    // Shard reader was consulted for at least the date that holds
    // the seeded citation.
    expect(_shardCalls).toContain("2026-03-05");
    // Cutover-day shard MUST NOT be consulted — the upper bound is
    // strictly `< NATIVE_REGIME_START`.
    expect(_shardCalls).not.toContain(NATIVE_REGIME_START);

    expect(result.available).toBe(true);
    expect(result.result.first_citation_date_iso).toBe("2026-03-05");
    expect(result.result.per_platform_first_citation.perplexity).toBe(
      "2026-03-05",
    );
    expect(result.stage).toBe("cited_fast");
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 3 — pre-cutover edit with no benchmark match: stays uncited.
// ────────────────────────────────────────────────────────────────────

describe("loadLifecycleForEdit — pre-cutover edit, no benchmark match", () => {
  it("returns no first-citation date and the no-citation lifecycle stage", async () => {
    setRepoFixture({
      // Tenant has observations BUT no citation_urls and no
      // benchmark match — the URL never appears in any shard.
      promptAnswerObservations: [
        {
          id: "pa-untouched",
          prompt_id: "p-1",
          run_id: "r-untouched",
          answer_hash: null,
          position: null,
          tracked_brand_mentioned: false,
          tracked_brand_cited: false,
          citation_count: 0,
          owned_citation_count: 0,
          citation_domains: [],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-03-10T00:00:00.000Z",
          platform: "chatgpt",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: null,
        },
      ],
    });
    setShardFixture({
      // A shard exists but the citation row points at a different
      // URL than the edit's target_url.
      "2026-03-10": [
        {
          id: "cit-other",
          prompt_answer_id: "pa-untouched",
          domain: "other.com",
          url: "https://other.com/some-page",
          title: null,
          citation_order: 1,
          source_category: "other",
          is_owned: false,
          tracked_entity_id: null,
          observed_at: "2026-03-10T00:00:00.000Z",
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({ live_at: "2026-03-01T00:00:00.000Z" }),
      now: "2026-04-15T00:00:00.000Z",
    });

    expect(_shardCalls.length).toBeGreaterThan(0);
    expect(result.available).toBe(true);
    expect(result.result.first_citation_date_iso).toBeNull();
    // 45 days since live, no citation → past 37-day late_days → stuck.
    expect(result.stage).toBe("stuck");
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 4 — cross-tenant benchmark citation must be dropped.
// ────────────────────────────────────────────────────────────────────

describe("loadLifecycleForEdit — cross-tenant safety (Section 2.4 contract)", () => {
  it("drops benchmark citations whose prompt_answer_id is outside the tenant scope", async () => {
    // Tenant scope: ONLY pa-mine. The shard contains a citation that
    // matches the edit's URL — but its prompt_answer_id points at a
    // DIFFERENT tenant's prompt-answer (pa-not-mine). The repo stub
    // does NOT return pa-not-mine for this tenant, so the compute
    // layer's `promptAnswerById` filter MUST drop the citation.
    setRepoFixture({
      promptAnswerObservations: [
        {
          id: "pa-mine",
          prompt_id: "p-1",
          run_id: "r-mine",
          answer_hash: null,
          position: null,
          tracked_brand_mentioned: false,
          tracked_brand_cited: false,
          citation_count: 0,
          owned_citation_count: 0,
          citation_domains: [],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-03-05T00:00:00.000Z",
          platform: "chatgpt",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: null,
        },
      ],
    });
    setShardFixture({
      "2026-03-05": [
        {
          id: "cit-cross-tenant",
          prompt_answer_id: "pa-not-mine",
          domain: "example.com",
          url: "https://example.com/services/whole-home-remodel",
          title: null,
          citation_order: 1,
          source_category: "owned",
          is_owned: true,
          tracked_entity_id: null,
          observed_at: "2026-03-05T00:00:00.000Z",
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({ live_at: "2026-03-01T00:00:00.000Z" }),
      now: "2026-03-12T00:00:00.000Z",
    });

    // Shard reader WAS called — we read the shard.
    expect(_shardCalls).toContain("2026-03-05");
    // But the citation MUST be dropped (different tenant's pa id),
    // so the first-citation date stays null.
    expect(result.result.first_citation_date_iso).toBeNull();
    expect(result.result.per_platform_first_citation.chatgpt).toBeNull();
    expect(result.result.per_platform_first_citation.perplexity).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────
// Case 5 — loader actually passes benchmark citations into compute.
// ────────────────────────────────────────────────────────────────────

describe("loadLifecycleForEdit — benchmark citations flow into compute", () => {
  it("a benchmark-side citation drives stage = cited_fast for a pre-cutover edit", async () => {
    setRepoFixture({
      promptAnswerObservations: [
        {
          id: "pa-bench-2",
          prompt_id: "p-1",
          run_id: "r-bench-2",
          answer_hash: null,
          position: 1,
          tracked_brand_mentioned: true,
          tracked_brand_cited: true,
          citation_count: 1,
          owned_citation_count: 1,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: "2026-03-03T00:00:00.000Z",
          platform: "chatgpt",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: null,
        },
      ],
    });
    setShardFixture({
      "2026-03-03": [
        {
          id: "cit-fast",
          prompt_answer_id: "pa-bench-2",
          domain: "example.com",
          url: "https://example.com/services/whole-home-remodel",
          title: null,
          citation_order: 1,
          source_category: "owned",
          is_owned: true,
          tracked_entity_id: null,
          observed_at: "2026-03-03T00:00:00.000Z",
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({ live_at: "2026-03-01T00:00:00.000Z" }),
      now: "2026-03-08T00:00:00.000Z",
    });

    expect(result.available).toBe(true);
    expect(result.result.days_to_first_citation).toBe(2);
    expect(result.stage).toBe("cited_fast");
    // Per-platform breakdown attributes the citation to chatgpt
    // (taken from the joined PromptAnswerObservation.platform).
    expect(result.result.per_platform_first_citation.chatgpt).toBe("2026-03-03");
  });
});

// ────────────────────────────────────────────────────────────────────
// Helper sanity — the exclusive enumerator must not include the
// cutover date itself, since the benchmark regime is strictly
// `< NATIVE_REGIME_START`.
// ────────────────────────────────────────────────────────────────────

import { __testing as loaderInternals } from "@/domains/citation-lifecycle/load-lifecycle";

describe("loadLifecycleForEdit — readBenchmarkCitationsInWindow short-circuit", () => {
  it("returns [] when sinceIso >= NATIVE_REGIME_START without calling getCitationsForDate", () => {
    const rows = loaderInternals.readBenchmarkCitationsInWindow(
      NATIVE_REGIME_START,
      "2026-05-01",
    );
    expect(rows).toEqual([]);
    expect(_shardCalls).toEqual([]);
  });

  it("returns [] when sinceIso is null", () => {
    const rows = loaderInternals.readBenchmarkCitationsInWindow(
      null,
      "2026-05-01",
    );
    expect(rows).toEqual([]);
    expect(_shardCalls).toEqual([]);
  });

  it("clamps the upper bound exclusively at NATIVE_REGIME_START", () => {
    // A window that straddles the cutover should NOT include the
    // cutover-day shard.
    setShardFixture({
      "2026-04-21": [],
      "2026-04-22": [],
    });
    loaderInternals.readBenchmarkCitationsInWindow(
      "2026-04-20",
      "2026-04-30",
    );
    expect(_shardCalls).toContain("2026-04-21");
    expect(_shardCalls).not.toContain("2026-04-22");
  });
});
