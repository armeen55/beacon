/**
 * Section 5.A (2026-05-16) — `loadRepeatCitationForEdit` loader tests.
 *
 * Verifies:
 *   • Loader reads via `getRepository().forTenant(tenantId)` —
 *     specifically `getProfoundImportRuns()` for the denominator
 *     and `getPromptAnswerObservations({since: live_at})` for the
 *     numerator + first-citation.
 *   • Loader does NOT call `repo.getObservationRuns()` (wrong type
 *     — website-crawl, not poll-runs).
 *   • Path A pre-cutover branch: cold-store helpers are consulted
 *     only when `live_at < NATIVE_REGIME_START`; native-only edits
 *     skip them cleanly.
 *   • Cache wiring: key includes `(tenantId, edit.id, live_at,
 *     windowDays)`; tag is `recommended_edits:${tenantId}`.
 *   • Tenant isolation: tenant-a's loader call only sees tenant-a
 *     rows (the repo mock applies the filter; we assert the loader
 *     passes the right tenantId through).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { ProfoundImportRun } from "@/domains/observation-runs/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

// ─────────────────────────────────────────────────────────────────────
// Cache wiring capture
// ─────────────────────────────────────────────────────────────────────

let _cacheCalls: Array<{
  key: ReadonlyArray<string>;
  opts: { revalidate?: number; tags?: ReadonlyArray<string> };
}> = [];

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => unknown,
    key: ReadonlyArray<string>,
    opts: { revalidate?: number; tags?: ReadonlyArray<string> },
  ) => {
    _cacheCalls.push({ key, opts });
    return fn;
  },
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────
// Repository mock
// ─────────────────────────────────────────────────────────────────────

type RepoFixture = {
  promptAnswerObservations: PromptAnswerObservation[];
  profoundImportRuns: ProfoundImportRun[];
};

let _repoFixture: RepoFixture = {
  promptAnswerObservations: [],
  profoundImportRuns: [],
};

let _getProfoundImportRunsCalls: string[] = [];
let _getObservationRunsCalls = 0;
let _lastTenantId: string | null = null;
let _sinceCalls: Array<{ tenantId: string; since: string | undefined }> = [];

function setRepoFixture(next: Partial<RepoFixture>): void {
  _repoFixture = { ..._repoFixture, ...next };
}

vi.mock("@/lib/persistence/repositories", () => ({
  getRepository: () => ({
    forTenant: (tenantId: string) => {
      _lastTenantId = tenantId;
      return {
        getPromptAnswerObservations: async (options?: { since?: string }) => {
          _sinceCalls.push({ tenantId, since: options?.since });
          let rows = _repoFixture.promptAnswerObservations.filter(
            (r) => r.tenant_id === tenantId,
          );
          if (options?.since) {
            const since = options.since;
            rows = rows.filter((r) => r.observed_at.slice(0, 10) >= since);
          }
          return rows;
        },
        getProfoundImportRuns: async () => {
          _getProfoundImportRunsCalls.push(tenantId);
          return _repoFixture.profoundImportRuns;
        },
        getObservationRuns: async () => {
          _getObservationRunsCalls++;
          return [];
        },
      };
    },
  }),
}));

// ─────────────────────────────────────────────────────────────────────
// Cold-store mock — capture which date shards are touched
// ─────────────────────────────────────────────────────────────────────

const _shardCalls: string[] = [];

vi.mock("@/lib/persistence/cold-store", () => ({
  getAllCitationDates: () => [],
  getCitationsForDate: (date: string) => {
    _shardCalls.push(date);
    return [];
  },
}));

import { loadRepeatCitationForEdit } from "@/domains/citation-lifecycle/load-repeat-citation";

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const TENANT_A = "tenant-ritz-founder";
const TENANT_B = "tenant-other";

function edit(over: Partial<RecommendedEditRow> = {}): RecommendedEditRow {
  // Tests only consume id / tenant_id / live_at / target_url /
  // implementation_status. Other RecommendedEditRow fields are
  // unused by the loader path under test; cast through unknown to
  // avoid backfilling every unrelated column.
  return {
    id: over.id ?? "edit-1",
    tenant_id: over.tenant_id ?? TENANT_A,
    rec_id: over.rec_id ?? "rec-1",
    action_type: over.action_type ?? "edit_title",
    target_url:
      over.target_url ?? "https://ritzbuilders.com/services/whole-home-remodel",
    target_element_key: over.target_element_key ?? null,
    implementation_status: over.implementation_status ?? "verified_live",
    // Honor explicit `null` overrides — `??` would collapse them
    // to the fallback and silently break the ineligible-edit cases.
    live_at: "live_at" in over ? over.live_at : "2026-05-01T12:00:00.000Z",
  } as unknown as RecommendedEditRow;
}

function paoRow(over: Partial<PromptAnswerObservation> = {}): PromptAnswerObservation {
  return {
    id: over.id ?? "pao-1",
    prompt_id: over.prompt_id ?? "p-1",
    run_id: over.run_id ?? "r-1",
    answer_hash: over.answer_hash ?? null,
    position: over.position ?? null,
    tracked_brand_mentioned: over.tracked_brand_mentioned ?? null,
    tracked_brand_cited: over.tracked_brand_cited ?? null,
    citation_count: over.citation_count ?? 0,
    owned_citation_count: over.owned_citation_count ?? 0,
    citation_domains: over.citation_domains ?? [],
    citation_categories: over.citation_categories ?? {},
    mentions: over.mentions ?? [],
    observed_at: over.observed_at ?? "2026-05-10T08:00:00.000Z",
    platform: over.platform ?? "chatgpt",
    topic: over.topic ?? "",
    metadata: over.metadata ?? {},
    tenant_id: over.tenant_id ?? TENANT_A,
    citation_urls: over.citation_urls,
  };
}

function pollRun(
  date: string,
  over: Partial<ProfoundImportRun> = {},
): ProfoundImportRun {
  return {
    id: over.id ?? `run-${date}`,
    account_id: over.account_id ?? "ritz-founder",
    import_run_id: over.import_run_id ?? null,
    run_date: over.run_date ?? date,
    platform: over.platform ?? "chatgpt",
    model: over.model ?? null,
    geo: over.geo ?? null,
    locale: over.locale ?? null,
    source_type: over.source_type ?? "beacon_native",
    status: over.status ?? "completed",
    prompt_count: over.prompt_count ?? 25,
    metadata: over.metadata ?? {},
    created_at: over.created_at ?? `${date}T07:00:00.000Z`,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _cacheCalls = [];
  _repoFixture = { promptAnswerObservations: [], profoundImportRuns: [] };
  _getProfoundImportRunsCalls = [];
  _getObservationRunsCalls = 0;
  _sinceCalls = [];
  _shardCalls.length = 0;
  _lastTenantId = null;
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("loadRepeatCitationForEdit — repository wiring", () => {
  it("reads via getRepository().forTenant(tenantId).getProfoundImportRuns()", async () => {
    setRepoFixture({
      profoundImportRuns: [pollRun("2026-05-02"), pollRun("2026-05-03")],
    });
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit(),
    });
    expect(_getProfoundImportRunsCalls).toEqual([TENANT_A]);
    expect(_lastTenantId).toBe(TENANT_A);
  });

  it("does NOT call repo.getObservationRuns() (wrong type — website-crawl)", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit(),
    });
    expect(_getObservationRunsCalls).toBe(0);
  });

  it("calls getPromptAnswerObservations with since=live_at_date", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: "2026-05-01T12:00:00.000Z" }),
    });
    expect(_sinceCalls).toHaveLength(1);
    expect(_sinceCalls[0].since).toBe("2026-05-01");
  });
});

describe("loadRepeatCitationForEdit — cache wiring", () => {
  it("cache key includes tenantId, edit.id, live_at, windowDays", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ id: "edit-xyz", live_at: "2026-05-01T12:00:00.000Z" }),
      windowDays: 60,
    });
    expect(_cacheCalls).toHaveLength(1);
    expect(_cacheCalls[0].key).toEqual([
      "repeat-citation:v1",
      TENANT_A,
      "edit-xyz",
      "2026-05-01T12:00:00.000Z",
      "60",
    ]);
  });

  it("cache tag is recommended_edits:${tenantId}", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit(),
    });
    expect(_cacheCalls[0].opts.tags).toEqual([`recommended_edits:${TENANT_A}`]);
  });

  it("cache TTL is 60 seconds", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit(),
    });
    // quota/waste pass 2026-06-17: idle TTL raised 60s → 1800s (operator
    // actions revalidate the layout, so this only governs idle auto-refresh).
    expect(_cacheCalls[0].opts.revalidate).toBe(1800);
  });

  it("cache key sentinel `no-live` when live_at is missing", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: null }),
    });
    expect(_cacheCalls[0].key[3]).toBe("no-live");
  });

  it("windowDays defaults to 30", async () => {
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit(),
    });
    expect(_cacheCalls[0].key[4]).toBe("30");
  });
});

describe("loadRepeatCitationForEdit — Path A regime gate", () => {
  it("native-only edit (live_at >= NATIVE_REGIME_START) does NOT touch cold-store", async () => {
    setRepoFixture({
      profoundImportRuns: [pollRun("2026-05-02")],
    });
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: "2026-05-01T12:00:00.000Z" }),
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(_shardCalls).toHaveLength(0);
  });

  it("benchmark-overlapping edit (live_at < NATIVE_REGIME_START) DOES read cold-store shards", async () => {
    // NATIVE_REGIME_START is 2026-04-22; pre-cutover live_at triggers reads.
    await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: "2026-04-15T12:00:00.000Z" }),
      now: "2026-04-25T12:00:00.000Z",
    });
    expect(_shardCalls.length).toBeGreaterThan(0);
    for (const d of _shardCalls) {
      // Every shard touched falls in [live_at, NATIVE_REGIME_START).
      expect(d >= "2026-04-15").toBe(true);
      expect(d < "2026-04-22").toBe(true);
    }
  });
});

describe("loadRepeatCitationForEdit — compute integration", () => {
  it("threads ProfoundImportRun[] into compute → polling_days reflected", async () => {
    // 10 distinct polling days + 5 citation days = stable.
    const start = new Date("2026-05-01T00:00:00.000Z").getTime();
    const runs: ProfoundImportRun[] = [];
    const paos: PromptAnswerObservation[] = [];
    for (let i = 0; i < 10; i++) {
      const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
      runs.push(pollRun(date));
      if (i < 5) {
        paos.push(
          paoRow({
            id: `pao-${i}`,
            observed_at: new Date(start + i * 86_400_000).toISOString(),
            citation_urls: ["https://ritzbuilders.com/services/whole-home-remodel"],
          }),
        );
      }
    }
    setRepoFixture({ promptAnswerObservations: paos, profoundImportRuns: runs });
    const out = await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: "2026-05-01T00:00:00.000Z" }),
      now: "2026-05-15T00:00:00.000Z",
    });
    expect(out.polling_days).toBe(10);
    expect(out.distinct_citation_days).toBe(5);
    expect(out.citation_rate).toBeCloseTo(0.5);
    expect(out.band).toBe("stable");
  });
});

describe("loadRepeatCitationForEdit — tenant isolation through repo mock", () => {
  it("forTenant('tenant-a') sees only tenant-a's rows; tenant-b is invisible", async () => {
    const start = new Date("2026-05-01T00:00:00.000Z").getTime();
    const targetUrl = "https://ritzbuilders.com/services/whole-home-remodel";
    setRepoFixture({
      promptAnswerObservations: [
        ...Array.from({ length: 5 }, (_, i) =>
          paoRow({
            id: `pao-a-${i}`,
            tenant_id: TENANT_A,
            observed_at: new Date(start + i * 86_400_000).toISOString(),
            citation_urls: [targetUrl],
          }),
        ),
        ...Array.from({ length: 5 }, (_, i) =>
          paoRow({
            id: `pao-b-${i}`,
            tenant_id: TENANT_B,
            observed_at: new Date(start + i * 86_400_000).toISOString(),
            citation_urls: [targetUrl],
          }),
        ),
      ],
      profoundImportRuns: Array.from({ length: 10 }, (_, i) =>
        pollRun(new Date(start + i * 86_400_000).toISOString().slice(0, 10)),
      ),
    });
    const out = await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({
        live_at: "2026-05-01T00:00:00.000Z",
        tenant_id: TENANT_A,
      }),
      now: "2026-05-15T00:00:00.000Z",
    });
    // Tenant-a sees its 5 citation days, NOT 10 (would be 10 if
    // tenant-b leaked through). 5/10 = 0.50 = stable.
    expect(out.distinct_citation_days).toBe(5);
    expect(out.band).toBe("stable");
  });
});

describe("loadRepeatCitationForEdit — ineligible-edit passthrough", () => {
  it("returns a valid result for an edit with no live_at (band null)", async () => {
    const out = await loadRepeatCitationForEdit({
      tenantId: TENANT_A,
      recommendedEdit: edit({ live_at: null }),
    });
    expect(out.eligible).toBe(false);
    expect(out.band).toBeNull();
    expect(out.eligibility_reason).toBe("missing_live_at");
  });
});
