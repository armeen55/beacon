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

// Phase A.3 Step 4 — mock the indexability loader at the module
// boundary. Tests configure the result via `setIndexabilityResult`
// or force a throw via `setIndexabilityThrow`. The call counter
// (`_indexabilityCalls`) backs the gating invariant: indexability
// must NEVER fire for non-stuck rows.
type IndexabilityCall = { tenantId: string; url: string };
let _indexabilityCalls: IndexabilityCall[] = [];
let _indexabilityResult: import("@/domains/indexability/types").OwnedUrlIndexability | null = null;
let _indexabilityThrow: Error | null = null;
function setIndexabilityResult(
  r: import("@/domains/indexability/types").OwnedUrlIndexability | null,
): void {
  _indexabilityResult = r;
  _indexabilityThrow = null;
}
function setIndexabilityThrow(e: Error): void {
  _indexabilityThrow = e;
  _indexabilityResult = null;
}

vi.mock("@/domains/indexability/load-indexability", () => ({
  loadIndexabilityForUrl: async (opts: { tenantId: string; url: string }) => {
    _indexabilityCalls.push({ tenantId: opts.tenantId, url: opts.url });
    if (_indexabilityThrow) throw _indexabilityThrow;
    if (_indexabilityResult == null) {
      throw new Error(
        "test fixture: indexability result not set — call setIndexabilityResult() first",
      );
    }
    return _indexabilityResult;
  },
}));

// Section 5.B Slice 2 (2026-05-21) — mock the per-edit repeat-citation
// loader at the module boundary. Tests control per-edit bands via
// `setRepeatCitationBandByEditId({...})`. Edits not in the map fall
// back to an ineligible result (band = null). Per-edit errors are
// forced via `setRepeatCitationThrowByEditId({...})`.
type RepeatCitationFixtureResult = {
  band:
    | "stable"
    | "intermittent"
    | "one_off"
    | "not_repeated"
    | "still_learning"
    | null;
};
let _repeatCitationCalls: Array<{
  tenantId: string;
  editId: string;
  windowDays: number;
}> = [];
let _repeatCitationByEditId: Record<string, RepeatCitationFixtureResult> = {};
let _repeatCitationThrowByEditId: Record<string, Error> = {};

function setRepeatCitationBandByEditId(
  next: Record<string, RepeatCitationFixtureResult>,
): void {
  _repeatCitationByEditId = next;
  _repeatCitationThrowByEditId = {};
}

function setRepeatCitationThrowByEditId(next: Record<string, Error>): void {
  _repeatCitationThrowByEditId = next;
}

function clearRepeatCitationCalls(): void {
  _repeatCitationCalls = [];
}

vi.mock("@/domains/citation-lifecycle/load-repeat-citation", () => ({
  loadRepeatCitationForEdit: async (opts: {
    tenantId: string;
    recommendedEdit: { id: string };
    windowDays?: number;
  }) => {
    _repeatCitationCalls.push({
      tenantId: opts.tenantId,
      editId: opts.recommendedEdit.id,
      windowDays: opts.windowDays ?? 30,
    });
    const perEditThrow = _repeatCitationThrowByEditId[opts.recommendedEdit.id];
    if (perEditThrow) throw perEditThrow;
    const fix = _repeatCitationByEditId[opts.recommendedEdit.id];
    return {
      eligible: fix != null && fix.band != null,
      eligibility_reason: "eligible",
      window_days: opts.windowDays ?? 30,
      polling_days: fix && fix.band != null ? 10 : 0,
      distinct_citation_days: 0,
      citation_rate: null,
      band: fix?.band ?? null,
      per_platform: {
        chatgpt: { polling_days: 0, distinct_citation_days: 0 },
        perplexity: { polling_days: 0, distinct_citation_days: 0 },
        google_ai_overviews: null,
      },
      first_citation_date_iso: null,
    };
  },
}));

// Imports under test go AFTER the mocks so vitest hoists the mocks
// before the module evaluates.
import {
  loadLifecycleForEdit,
  loadLifecycleSummaryForTenant,
} from "@/domains/citation-lifecycle/load-lifecycle";
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
  _indexabilityCalls = [];
  _indexabilityResult = null;
  _indexabilityThrow = null;
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

// ────────────────────────────────────────────────────────────────────
// Phase A.2 Step 3b — threshold_decision threading through loaders
// ────────────────────────────────────────────────────────────────────

/**
 * Build a fixture with N cited records whose `days_to_first_citation`
 * falls inside Profound's `cited_typical` band (= 7–18 days). Each
 * record drives an edit with its own URL + a paired pa-row + a
 * native-regime `citation_urls` match. Useful for exercising the
 * tenant-thresholds gate (which counts cited records).
 *
 * `now` is fixed at 2026-05-30 in these tests so all `live_at` of
 * 2026-05-01 fall inside the 90-day window and post-cutover.
 */
type FixtureEdits = NonNullable<
  Parameters<typeof setRepoFixture>[0]["recommendedEdits"]
>;
type FixtureObs = NonNullable<
  Parameters<typeof setRepoFixture>[0]["promptAnswerObservations"]
>;

// Mutable element-array shapes used by fixture helpers that build
// rows iteratively. Assignments to `setRepoFixture(...)` accept the
// readonly counterparts via structural compatibility.
type MutableEdits = Array<FixtureEdits[number]>;
type MutableObs = Array<FixtureObs[number]>;

function seedCitedTenantFixture(count: number): {
  recommendedEdits: MutableEdits;
  promptAnswerObservations: MutableObs;
} {
  const recommendedEdits: MutableEdits = [];
  const promptAnswerObservations: MutableObs = [];
  for (let i = 0; i < count; i++) {
    const editId = `edit-bulk-${i}`;
    const paId = `pa-bulk-${i}`;
    const url = `https://example.com/services/page-${i}`;
    // Days to first citation cycles through 8, 10, 12 (all
    // cited_typical under Profound 7..18). live_at 2026-05-01; first
    // citation 2026-05-09/11/13.
    const daysToCitation = 8 + (i % 3) * 2;
    const liveDate = new Date("2026-05-01T00:00:00.000Z");
    const citationDate = new Date(
      liveDate.getTime() + daysToCitation * 86_400_000,
    );
    recommendedEdits.push({
      id: editId,
      tenant_id: TENANT,
      rec_id: `rec-bulk-${i}`,
      action_type: "add_h2_section",
      target_url: url,
      target_element_key: `h2[new]:bulk-${i}`,
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
      tenant_id: TENANT,
      citation_urls: [url],
    });
  }
  return { recommendedEdits, promptAnswerObservations };
}

const STEP_3B_NOW = "2026-05-30T00:00:00.000Z";

describe("loadLifecycleForEdit — threshold_decision field (Phase A.2 §3.7)", () => {
  it("returns threshold_decision with source 'profound_default' for a tenant with no cited edits", async () => {
    setRepoFixture({
      promptAnswerObservations: [
        {
          id: "pa-target",
          prompt_id: "p-target",
          run_id: "r-target",
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
      recommendedEdits: [
        {
          id: "edit-target",
          tenant_id: TENANT,
          rec_id: "rec-target",
          action_type: "add_h2_section",
          target_url: "https://example.com/services/whole-home-remodel",
          target_element_key: "h2[new]:target",
          implementation_status: "verified_live",
          live_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    });

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({
        id: "edit-target",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      now: STEP_3B_NOW,
    });

    expect(result.threshold_decision.source).toBe("profound_default");
    expect(result.threshold_decision.sample_size).toBe(1);
    expect(result.threshold_decision.thresholds).toEqual({
      fast_days: 6,
      median_days: 18,
      late_days: 37,
    });
  });

  it("returns threshold_decision with source 'per_tenant' when tenant has >= 20 cited records", async () => {
    const fx = seedCitedTenantFixture(22);
    // Add the target edit + its own observation.
    fx.recommendedEdits.push({
      id: "edit-target",
      tenant_id: TENANT,
      rec_id: "rec-target",
      action_type: "add_h2_section",
      target_url: "https://example.com/services/whole-home-remodel",
      target_element_key: "h2[new]:target",
      implementation_status: "verified_live",
      live_at: "2026-05-01T00:00:00.000Z",
    });
    fx.promptAnswerObservations.push({
      id: "pa-target",
      prompt_id: "p-target",
      run_id: "r-target",
      answer_hash: null,
      position: 1,
      tracked_brand_mentioned: true,
      tracked_brand_cited: true,
      citation_count: 1,
      owned_citation_count: 1,
      citation_domains: ["example.com"],
      citation_categories: {},
      mentions: [],
      observed_at: "2026-05-08T00:00:00.000Z",
      platform: "chatgpt",
      topic: "remodel",
      metadata: {},
      tenant_id: TENANT,
      citation_urls: ["https://example.com/services/whole-home-remodel"],
    });
    setRepoFixture(fx);

    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({
        id: "edit-target",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      now: STEP_3B_NOW,
    });

    expect(result.threshold_decision.source).toBe("per_tenant");
    expect(result.threshold_decision.sample_size).toBeGreaterThanOrEqual(20);
  });

  it("LifecycleForEdit.copy DIFFERS between profound_default and per_tenant sources (Phase A.2 §3c per-source copy wiring)", async () => {
    // Two scenarios with the SAME target edit + observation. The
    // only difference is the surrounding tenant's cited-record
    // count (which flips the gate). In A.2.3c the target's `copy`
    // MUST differ because the renderer now receives the resolved
    // threshold_decision and selects per-source variants.
    const targetEditRow = {
      id: "edit-target",
      tenant_id: TENANT,
      rec_id: "rec-target",
      action_type: "add_h2_section",
      target_url: "https://example.com/services/whole-home-remodel",
      target_element_key: "h2[new]:target",
      implementation_status: "verified_live" as const,
      live_at: "2026-05-01T00:00:00.000Z",
    };
    const targetObs = {
      id: "pa-target",
      prompt_id: "p-target",
      run_id: "r-target",
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
    };

    // Scenario A: sub-gate (5 cited records → profound_default).
    setRepoFixture({
      ...seedCitedTenantFixture(5),
      recommendedEdits: [
        ...seedCitedTenantFixture(5).recommendedEdits,
        targetEditRow,
      ],
      promptAnswerObservations: [
        ...seedCitedTenantFixture(5).promptAnswerObservations,
        targetObs,
      ],
    });
    const subGate = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({
        id: "edit-target",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      now: STEP_3B_NOW,
    });

    // Scenario B: above-gate (25 cited records → per_tenant).
    setRepoFixture({
      ...seedCitedTenantFixture(25),
      recommendedEdits: [
        ...seedCitedTenantFixture(25).recommendedEdits,
        targetEditRow,
      ],
      promptAnswerObservations: [
        ...seedCitedTenantFixture(25).promptAnswerObservations,
        targetObs,
      ],
    });
    const aboveGate = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: makeEdit({
        id: "edit-target",
        live_at: "2026-05-01T00:00:00.000Z",
      }),
      now: STEP_3B_NOW,
    });

    // Sources differ (proves the threshold compute ran).
    expect(subGate.threshold_decision.source).toBe("profound_default");
    expect(aboveGate.threshold_decision.source).toBe("per_tenant");

    // Copy MUST differ — per-tenant variants carry the "for this
    // site" honesty suffix on cited stages. The sub-gate copy uses
    // the Profound phrasing without the suffix.
    expect(subGate.copy).not.toBeNull();
    expect(aboveGate.copy).not.toBeNull();
    expect(subGate.copy!.primary).not.toContain("for this site");
    expect(aboveGate.copy!.primary).toContain("for this site");
    expect(aboveGate.copy).not.toEqual(subGate.copy);
  });
});

describe("loadLifecycleSummaryForTenant — threshold_decision field (Phase A.2 §3.7)", () => {
  it("returns threshold_decision with source 'profound_default' for a tenant with no cited edits", async () => {
    setRepoFixture({
      promptAnswerObservations: [],
      recommendedEdits: [],
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.threshold_decision.source).toBe("profound_default");
    expect(summary.threshold_decision.sample_size).toBe(0);
    expect(summary.total).toBe(0);
  });

  it("returns threshold_decision with source 'per_tenant' when tenant has >= 20 cited records", async () => {
    setRepoFixture(seedCitedTenantFixture(20));
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.threshold_decision.source).toBe("per_tenant");
    expect(summary.threshold_decision.sample_size).toBeGreaterThanOrEqual(20);
  });

  it("LifecycleSummary.per_stage RE-BUCKETS against per-tenant thresholds when source flips (Phase A.2 §3c)", async () => {
    // The 20-record fixture cycles days_to_first_citation through
    // {8, 10, 12} (i%3 mapping). All three values fall in
    // Profound's cited_typical band (>6 and ≤18) → sub-gate
    // per_stage = {cited_typical: 5}.
    //
    // Crossing the gate at n=20: nearest-rank percentiles compute
    // sorted-ascending days = [8×7, 10×7, 12×6]. Indices:
    //   p=0.50 → idx 9  → day 10 → fast_days   = 10
    //   p=0.75 → idx 14 → day 12 → median_days = 12
    //   p=0.90 → idx 17 → day 12 → late_days   = 12
    // Per-tenant bucketing with {10,12,12}:
    //   day 8  → 8 ≤ 10 → cited_fast      → 7 records
    //   day 10 → 10 ≤ 10 → cited_fast     → 7 records
    //   day 12 → 12 > 10, 12 ≤ 12 → cited_typical → 6 records
    //
    // If the summary loader failed to re-bucket against the
    // per_tenant thresholds, the 20-record above-gate scenario
    // would still report cited_typical: 20. The assertions below
    // pin the re-bucketed expectation.
    const fx20 = seedCitedTenantFixture(20);
    setRepoFixture(fx20);
    const aboveGate = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(aboveGate.threshold_decision.source).toBe("per_tenant");
    expect(aboveGate.threshold_decision.thresholds).toEqual({
      fast_days: 10,
      median_days: 12,
      late_days: 12,
    });
    expect(aboveGate.per_stage.cited_fast).toBe(14);
    expect(aboveGate.per_stage.cited_typical).toBe(6);
    expect(aboveGate.per_stage.cited_late).toBe(0);

    // 5-record sub-gate fixture stays on Profound 6/18/37 and all
    // 5 records remain cited_typical.
    const fx5 = seedCitedTenantFixture(5);
    setRepoFixture(fx5);
    const subGate = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(subGate.threshold_decision.source).toBe("profound_default");
    expect(subGate.per_stage.cited_typical).toBe(5);
    expect(subGate.per_stage.cited_fast).toBe(0);
  });

  it("LifecycleSummary.tile_strings carries Profound labels at sub-gate (Phase A.2 §3c)", async () => {
    setRepoFixture(seedCitedTenantFixture(5));
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.threshold_decision.source).toBe("profound_default");
    expect(summary.tile_strings.stage_labels.cited_fast).toBe(
      "cited fast (within 6 days)",
    );
    expect(summary.tile_strings.stage_labels.cited_typical).toBe(
      "cited typical (within 18 days)",
    );
    expect(summary.tile_strings.stage_labels.cited_late).toBe(
      "cited late (within 37 days)",
    );
    expect(summary.tile_strings.stage_labels.stuck).toBe(
      "stuck (past 37 days)",
    );
    expect(summary.tile_strings.tooltip_body).toContain("starter benchmarks");
    expect(summary.tile_strings.empty_state_body).toContain("{windowDays}");
  });

  it("LifecycleSummary.tile_strings carries per-tenant labels when gate crossed (Phase A.2 §3c)", async () => {
    setRepoFixture(seedCitedTenantFixture(20));
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.threshold_decision.source).toBe("per_tenant");
    expect(summary.tile_strings.stage_labels.cited_fast).toBe(
      "cited fast (within 10 days)",
    );
    expect(summary.tile_strings.stage_labels.cited_typical).toBe(
      "cited typical (within 12 days)",
    );
    expect(summary.tile_strings.stage_labels.cited_late).toBe(
      "cited late (within 12 days)",
    );
    expect(summary.tile_strings.stage_labels.stuck).toBe(
      "stuck (past 12 days)",
    );
    expect(summary.tile_strings.tooltip_body).toContain(
      "cited shipped edits on this site",
    );
  });
});

describe("threshold resolution — cross-tenant safety (Section 2.4 contract)", () => {
  it("foreign-tenant edits + observations do NOT contribute to threshold sample_size", async () => {
    // Tenant T1 has 5 cited records (sub-gate). Tenant T2 has 25
    // cited records (would cross the gate IF its data leaked into
    // T1's threshold compute). Loader called for T1 — must see
    // source = profound_default, sample_size = 5.
    const t1Records = seedCitedTenantFixture(5);
    const t2Records = seedCitedTenantFixture(25);
    // Re-tag T2's records with a different tenant_id.
    const FOREIGN_TENANT = "tenant-other";
    const t2Edits = t2Records.recommendedEdits.map((e) => ({
      ...e,
      tenant_id: FOREIGN_TENANT,
      id: `${e.id}-foreign`,
    }));
    const t2Obs = t2Records.promptAnswerObservations.map((o) => ({
      ...o,
      tenant_id: FOREIGN_TENANT,
      id: `${o.id}-foreign`,
    }));
    setRepoFixture({
      recommendedEdits: [...t1Records.recommendedEdits, ...t2Edits],
      promptAnswerObservations: [
        ...t1Records.promptAnswerObservations,
        ...t2Obs,
      ],
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.threshold_decision.source).toBe("profound_default");
    expect(summary.threshold_decision.sample_size).toBe(5);
    expect(summary.total).toBe(5);
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase A.3 Step 4 — stuck-row indexability diagnostic wiring
// ────────────────────────────────────────────────────────────────────

/**
 * Synthesize an `OwnedUrlIndexability` result for tests. Defaults to
 * `composite_verdict: "not_in_sitemap"` so the resulting diagnostic
 * is unambiguous in assertions. Override `composite_verdict` +
 * `signals` to exercise specific verdict paths.
 */
function indexabilityResult(
  overrides: Partial<
    import("@/domains/indexability/types").OwnedUrlIndexability
  > = {},
): import("@/domains/indexability/types").OwnedUrlIndexability {
  return {
    url: "https://example.com/services/whole-home-remodel",
    composite_verdict: "not_in_sitemap",
    signals: {
      sitemap_membership: {
        in_sitemap: false,
        sitemap_url: null,
      },
      robots_txt: {
        googlebot_allowed: true,
        gptbot_allowed: true,
        perplexitybot_allowed: true,
        claudebot_allowed: true,
        google_extended_allowed: true,
      },
      page_snapshot: {
        http_status: 200,
        canonical_url: "https://example.com/services/whole-home-remodel",
        has_canonical_mismatch: false,
        robots_meta: "index, follow",
        noindex_detected: false,
        fetched_at: "2026-05-20T00:00:00.000Z",
        extraction_certainty: "confirmed",
      },
      gsc: null,
    },
    last_computed_at: "2026-05-30T00:00:00.000Z",
    evidence_freshness_days: 10,
    ...overrides,
  };
}

// `STEP_3B_NOW = 2026-05-30` — for a stuck verdict, `live_at` must be
// far enough back to clear Profound's 37-day late threshold.
const STUCK_LIVE_AT = "2026-04-01T00:00:00.000Z";

/**
 * Seed a single verified-live edit at `STUCK_LIVE_AT` with NO
 * matching observations (so the lifecycle stage resolves to
 * `stuck`). Returns the makeEdit shape for the single-edit loader.
 */
function seedStuckScenario(targetUrl: string = "https://example.com/services/whole-home-remodel"): RecommendedEditRow {
  setRepoFixture({
    promptAnswerObservations: [],
    recommendedEdits: [
      {
        id: "edit-stuck-1",
        tenant_id: TENANT,
        rec_id: "rec-stuck-1",
        action_type: "add_h2_section",
        target_url: targetUrl,
        target_element_key: "h2[new]:stuck",
        implementation_status: "verified_live",
        live_at: STUCK_LIVE_AT,
      },
    ],
  });
  return makeEdit({
    id: "edit-stuck-1",
    target_url: targetUrl,
    live_at: STUCK_LIVE_AT,
  });
}

describe("loadLifecycleForEdit — stuck-row indexability diagnostic (Phase A.3 §4)", () => {
  it("stuck row calls the indexability loader and renders the per-verdict diagnostic", async () => {
    const edit = seedStuckScenario();
    setIndexabilityResult(
      indexabilityResult({ composite_verdict: "not_in_sitemap" }),
    );
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.stage).toBe("stuck");
    expect(result.copy?.diagnostic).toBe(
      "Beacon did not find this page in your sitemap.xml.",
    );
    // Indexability loader called exactly once with the tenant-scoped URL.
    expect(_indexabilityCalls.length).toBe(1);
    expect(_indexabilityCalls[0].tenantId).toBe(TENANT);
  });

  it("stuck row + bad_status_code verdict surfaces the HTTP status in the diagnostic", async () => {
    const edit = seedStuckScenario();
    setIndexabilityResult(
      indexabilityResult({
        composite_verdict: "bad_status_code",
        signals: {
          sitemap_membership: { in_sitemap: true, sitemap_url: null },
          robots_txt: {
            googlebot_allowed: true,
            gptbot_allowed: true,
            perplexitybot_allowed: true,
            claudebot_allowed: true,
            google_extended_allowed: true,
          },
          page_snapshot: {
            http_status: 404,
            canonical_url: null,
            has_canonical_mismatch: null,
            robots_meta: null,
            noindex_detected: false,
            fetched_at: "2026-05-20T00:00:00.000Z",
            extraction_certainty: "confirmed",
          },
          gsc: null,
        },
      }),
    );
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.copy?.diagnostic).toBe(
      "This page returns HTTP 404 — it may no longer serve content.",
    );
  });

  it("stuck row + blocked_by_robots_for_ai maps the *_allowed=false flags into blocked_ai_bots context", async () => {
    const edit = seedStuckScenario();
    setIndexabilityResult(
      indexabilityResult({
        composite_verdict: "blocked_by_robots_for_ai",
        signals: {
          sitemap_membership: { in_sitemap: true, sitemap_url: null },
          robots_txt: {
            googlebot_allowed: true,
            gptbot_allowed: false,
            perplexitybot_allowed: false,
            claudebot_allowed: true,
            google_extended_allowed: true,
          },
          page_snapshot: {
            http_status: 200,
            canonical_url: "https://example.com/services/whole-home-remodel",
            has_canonical_mismatch: false,
            robots_meta: "index, follow",
            noindex_detected: false,
            fetched_at: "2026-05-20T00:00:00.000Z",
            extraction_certainty: "confirmed",
          },
          gsc: null,
        },
      }),
    );
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.copy?.diagnostic).toBe(
      "Your robots.txt appears to block GPTBot, PerplexityBot from this page.",
    );
  });

  it("stuck row + loader throws falls back to bridge phrase (graceful degradation)", async () => {
    const edit = seedStuckScenario();
    setIndexabilityThrow(new Error("synthetic test failure"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.stage).toBe("stuck");
    expect(result.copy?.diagnostic).toBeNull();
    expect(result.copy?.bridge).toContain(
      "next bundle will add automated sitemap + robots checks",
    );
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("non-stuck row (live_not_yet_cited) does NOT call the indexability loader", async () => {
    // Seed a row that's been live ONE day with no observations →
    // live_not_yet_cited under Profound thresholds.
    const liveAt = new Date(
      new Date(STEP_3B_NOW).getTime() - 1 * 86_400_000,
    ).toISOString();
    setRepoFixture({
      promptAnswerObservations: [],
      recommendedEdits: [
        {
          id: "edit-live-1",
          tenant_id: TENANT,
          rec_id: "rec-live-1",
          action_type: "add_h2_section",
          target_url: "https://example.com/services/page-x",
          target_element_key: "h2[new]:live",
          implementation_status: "verified_live",
          live_at: liveAt,
        },
      ],
    });
    const edit = makeEdit({
      id: "edit-live-1",
      target_url: "https://example.com/services/page-x",
      live_at: liveAt,
    });
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.stage).toBe("live_not_yet_cited");
    expect(_indexabilityCalls.length).toBe(0);
    expect(result.copy?.diagnostic).toBeNull();
  });

  it("cited row does NOT call the indexability loader", async () => {
    // Seed a cited-typical row: live 2026-04-22, cited 2026-04-30 (8d).
    const liveAt = "2026-04-22T00:00:00.000Z";
    const obsAt = "2026-04-30T00:00:00.000Z";
    const url = "https://example.com/services/page-y";
    setRepoFixture({
      recommendedEdits: [
        {
          id: "edit-cited-1",
          tenant_id: TENANT,
          rec_id: "rec-cited-1",
          action_type: "add_h2_section",
          target_url: url,
          target_element_key: "h2[new]:cited",
          implementation_status: "verified_live",
          live_at: liveAt,
        },
      ],
      promptAnswerObservations: [
        {
          id: "pa-cited",
          prompt_id: "p-cited",
          run_id: "r-cited",
          answer_hash: null,
          position: 1,
          tracked_brand_mentioned: true,
          tracked_brand_cited: true,
          citation_count: 1,
          owned_citation_count: 1,
          citation_domains: ["example.com"],
          citation_categories: {},
          mentions: [],
          observed_at: obsAt,
          platform: "chatgpt",
          topic: "remodel",
          metadata: {},
          tenant_id: TENANT,
          citation_urls: [url],
        },
      ],
    });
    const edit = makeEdit({
      id: "edit-cited-1",
      target_url: url,
      live_at: liveAt,
    });
    const result = await loadLifecycleForEdit({
      tenantId: TENANT,
      recommendedEdit: edit,
      now: STEP_3B_NOW,
    });
    expect(result.stage).toBe("cited_typical");
    expect(_indexabilityCalls.length).toBe(0);
    expect(result.copy?.diagnostic).toBeNull();
    // Cited rows have no bridge sub-line either.
    expect(result.copy?.bridge).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section 5.B Slice 2 (2026-05-21) — repeat-citation 30d band aggregation
// ---------------------------------------------------------------------------

const SECTION_5_B_2_NOW = "2026-05-20T12:00:00Z";
const SECTION_5_B_2_LIVE_AT = "2026-05-10T00:00:00Z";

/**
 * Build N edits inside the lifecycle window. Each edit gets unique
 * id + URL + element key based on its index. All edits target the
 * same tenant + window so they pass `isWithinWindow` in the loader.
 */
function makeEditsFor(ids: ReadonlyArray<string>) {
  return ids.map((id, idx) => ({
    id,
    tenant_id: TENANT,
    rec_id: `rec-${idx}`,
    action_type: "add_h2_section",
    target_url: `https://example.com/services/p-${idx}`,
    target_element_key: `h2[new]:${idx}`,
    implementation_status: "verified_live" as const,
    live_at: SECTION_5_B_2_LIVE_AT,
  }));
}

/**
 * One-call helper that builds edits keyed by id, applies the repo
 * fixture (with no prompt-answer observations), and sets the per-
 * edit band map in one shot. Eliminates the repeated 3-block setup
 * across all aggregation cases.
 */
function setupBandFixture(
  bandMap: Record<string, RepeatCitationFixtureResult>,
): { editIds: string[] } {
  const editIds = Object.keys(bandMap);
  setRepoFixture({
    promptAnswerObservations: [],
    recommendedEdits: makeEditsFor(editIds),
  });
  setRepeatCitationBandByEditId(bandMap);
  return { editIds };
}

const EMPTY_PER_BAND_EXPECTED = {
  stable: 0,
  intermittent: 0,
  one_off: 0,
  not_repeated: 0,
  still_learning: 0,
};

describe("loadLifecycleSummaryForTenant — repeat_citation_30d aggregation (Section 5.B.2)", () => {
  beforeEach(() => {
    clearRepeatCitationCalls();
    setRepeatCitationBandByEditId({});
  });

  it("returns repeat_citation_30d with empty per_band when no candidates", async () => {
    setRepoFixture({ promptAnswerObservations: [], recommendedEdits: [] });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    expect(summary.repeat_citation_30d).toBeDefined();
    expect(summary.repeat_citation_30d.total).toBe(0);
    expect(summary.repeat_citation_30d.total_with_band).toBe(0);
    expect(summary.repeat_citation_30d.per_band).toEqual(EMPTY_PER_BAND_EXPECTED);
  });

  it("aggregates per-edit bands into repeat_citation_30d.per_band", async () => {
    setupBandFixture({
      "e-stable-1": { band: "stable" },
      "e-stable-2": { band: "stable" },
      "e-intermittent-1": { band: "intermittent" },
      "e-one_off-1": { band: "one_off" },
      "e-not_repeated-1": { band: "not_repeated" },
      "e-still_learning-1": { band: "still_learning" },
      "e-ineligible-1": { band: null },
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    expect(summary.repeat_citation_30d.per_band).toEqual({
      stable: 2,
      intermittent: 1,
      one_off: 1,
      not_repeated: 1,
      still_learning: 1,
    });
    expect(summary.repeat_citation_30d.total).toBe(7);
    expect(summary.repeat_citation_30d.total_with_band).toBe(6);
  });

  it("invokes the per-edit loader once per candidate with windowDays=30", async () => {
    setupBandFixture({
      "e-a": { band: "stable" },
      "e-b": { band: "intermittent" },
      "e-c": { band: "one_off" },
    });
    await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    expect(_repeatCitationCalls.length).toBe(3);
    expect(_repeatCitationCalls.map((c) => c.editId).sort()).toEqual([
      "e-a",
      "e-b",
      "e-c",
    ]);
    for (const call of _repeatCitationCalls) {
      expect(call.tenantId).toBe(TENANT);
      expect(call.windowDays).toBe(30);
    }
  });

  it("soft-fails per-edit errors — that edit is omitted from per_band but other edits still count", async () => {
    setupBandFixture({
      "e-ok": { band: "stable" },
      "e-throws": { band: null }, // placeholder; throw overrides via setter below
      "e-ok-2": { band: "intermittent" },
    });
    setRepeatCitationThrowByEditId({
      "e-throws": new Error("simulated per-edit failure"),
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    expect(summary.repeat_citation_30d.total).toBe(3); // all candidates iterated
    expect(summary.repeat_citation_30d.total_with_band).toBe(2); // two succeeded
    expect(summary.repeat_citation_30d.per_band).toEqual({
      stable: 1,
      intermittent: 1,
      one_off: 0,
      not_repeated: 0,
      still_learning: 0,
    });
  });

  it("excludes ineligible edits (band === null) from per_band even when total_with_band counts them out", async () => {
    setupBandFixture({
      "e-stable": { band: "stable" },
      "e-ineligible": { band: null },
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    expect(summary.repeat_citation_30d.total).toBe(2);
    expect(summary.repeat_citation_30d.total_with_band).toBe(1);
    expect(summary.repeat_citation_30d.per_band.stable).toBe(1);
    expect(summary.repeat_citation_30d.per_band.not_repeated).toBe(0);
    expect(summary.repeat_citation_30d.per_band.still_learning).toBe(0);
  });

  it("returns repeat_citation_30d alongside (does not affect) the existing per_stage rollup", async () => {
    // Use the seedCitedTenantFixture which provides 5 cited rows
    // plus their observations. Apply a band per seeded edit so the
    // aggregation populates and verify both surfaces coexist.
    const fx = seedCitedTenantFixture(5);
    setRepoFixture(fx);
    const bandMap: Record<string, RepeatCitationFixtureResult> = {};
    for (const e of fx.recommendedEdits) bandMap[e.id] = { band: "stable" };
    setRepeatCitationBandByEditId(bandMap);
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: STEP_3B_NOW,
    });
    expect(summary.total).toBeGreaterThan(0); // Section 2 per_stage still populates
    expect(summary.repeat_citation_30d.total).toBe(fx.recommendedEdits.length);
    expect(summary.repeat_citation_30d.per_band.stable).toBe(
      fx.recommendedEdits.length,
    );
  });

  it("sum of per_band equals total_with_band (band-count invariant)", async () => {
    setupBandFixture({
      e1: { band: "stable" },
      e2: { band: "stable" },
      e3: { band: "intermittent" },
      e4: { band: "one_off" },
      e5: { band: null },
    });
    const summary = await loadLifecycleSummaryForTenant({
      tenantId: TENANT,
      now: SECTION_5_B_2_NOW,
    });
    const sumOfPerBand = Object.values(
      summary.repeat_citation_30d.per_band,
    ).reduce((a, b) => a + b, 0);
    expect(sumOfPerBand).toBe(summary.repeat_citation_30d.total_with_band);
  });
});
