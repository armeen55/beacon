/**
 * Section 6 C3 backfill — unit tests for the operator-trigger script.
 *
 * Tests are runtime-shaped: they import the script's exported pure
 * helpers + the dependency-injected `runBackfill` and exercise it
 * with mock C3Deps. No Supabase client is constructed; no env vars
 * are read; no script side effects run.
 *
 * Coverage per the C3 pre-flight §8:
 *   • CLI argv: --tenant required, --commit, --since/--until,
 *     --force, --limit, unknown-flag rejection.
 *   • Anchor resolution: clamps to NATIVE_REGIME_START, uses min
 *     observed_at when post-cutover.
 *   • Per-scope write paths: existing UPDATE narrow column,
 *     prompt-row UPSERT full row, no account row emission.
 *   • Dry-run safety: zero deps writes called.
 *   • Commit: deps writes invoked exactly per plan.
 *   • Idempotency / skip-already-done + --force bypass.
 *   • Tenant isolation: deps receive only the requested tenant.
 *   • Empty observations skip safely.
 *   • Verification SQL printed in dry-run + commit.
 *   • null/false primary_recommendation count as 0 (transitive via
 *     C2 builder — re-pinned here at the script boundary).
 *   • --limit caps tuples.
 *   • Architecture pin (C3AccountEmissionError) — runtime kill-switch
 *     if the builder ever regresses to emit account rows.
 */

import { describe, expect, it, vi } from "vitest";

import {
  type C3Args,
  type C3Deps,
  type ExistingRowUpdate,
  type PromptRowUpsert,
  type TuplePlan,
  C3AccountEmissionError,
  buildVerificationSql,
  obsPlatformLabels,
  parseArgs,
  planTuple,
  resolveAnchor,
  runBackfill,
  utcDateRange,
} from "../../scripts/backfill-section6-primary-recommendation";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

const TENANT = "tenant-ritz-founder";
const NATIVE_START = "2026-04-22";

function obs(over: Partial<PromptAnswerObservation> = {}): PromptAnswerObservation {
  return {
    id: "obs-id",
    prompt_id: "prompt-a",
    run_id: "run-fixture",
    answer_hash: null,
    position: null,
    tracked_brand_mentioned: false,
    tracked_brand_cited: false,
    citation_count: 0,
    owned_citation_count: 0,
    citation_domains: [],
    citation_categories: {},
    mentions: [],
    observed_at: "2026-04-25T11:35:00Z",
    platform: "perplexity",
    topic: "general",
    tenant_id: TENANT,
    metadata: {},
    primary_recommendation: null,
    ...over,
  };
}

function entity(over: Partial<TrackedEntity> = {}): TrackedEntity {
  return {
    id: "own-ritzbuilders-com",
    account_id: TENANT,
    tenant_id: TENANT,
    entity_type: "brand",
    name: "Ritz Builders",
    domain: "ritzbuilders.com",
    url: null,
    location_scope: null,
    service_scope: null,
    is_owned: true,
    is_active: true,
    metadata: {},
    created_at: "2026-04-22T00:00:00Z",
    updated_at: "2026-04-22T00:00:00Z",
    ...over,
  };
}

function defaultArgs(over: Partial<C3Args> = {}): C3Args {
  return {
    tenant: TENANT,
    since: "2026-04-25",
    until: "2026-04-26",
    commit: false,
    force: false,
    limit: null,
    ...over,
  };
}

/**
 * Mock deps factory. Every call site records its invocation so tests
 * assert tenant-scoping + payload correctness.
 */
function makeMockDeps(over: {
  minObserved?: string | null;
  observations?: PromptAnswerObservation[];
  entities?: TrackedEntity[];
  existingState?: {
    nonPromptByIdPrimary: Map<string, number | null>;
    existingPromptIds: Set<string>;
  };
  applyExistingError?: string | null;
  applyPromptError?: string | null;
} = {}) {
  const minObserved = over.minObserved ?? "2026-04-25T00:00:00Z";
  const observations = over.observations ?? [];
  const entities = over.entities ?? [entity()];
  const existingState =
    over.existingState ?? {
      nonPromptByIdPrimary: new Map<string, number | null>(),
      existingPromptIds: new Set<string>(),
    };

  const calls: {
    fetchTenantMinObservedAt: Array<{ tenantId: string }>;
    fetchObsForTuple: Array<{ tenantId: string; date: string; platform: string }>;
    fetchEntitiesForTenant: Array<{ tenantId: string }>;
    fetchExistingRowState: Array<{ tenantId: string; date: string; platform: string }>;
    applyExistingUpdate: ExistingRowUpdate[];
    applyPromptUpserts: Array<{ rows: PromptRowUpsert[]; tenantId: string }>;
  } = {
    fetchTenantMinObservedAt: [],
    fetchObsForTuple: [],
    fetchEntitiesForTenant: [],
    fetchExistingRowState: [],
    applyExistingUpdate: [],
    applyPromptUpserts: [],
  };

  const deps: C3Deps = {
    fetchTenantMinObservedAt: vi.fn(async (tenantId: string) => {
      calls.fetchTenantMinObservedAt.push({ tenantId });
      return minObserved;
    }),
    fetchObsForTuple: vi.fn(async (tenantId: string, date: string, platform: string) => {
      calls.fetchObsForTuple.push({ tenantId, date, platform });
      // Return observations bucketed only to the platform that
      // requested them in the fixture's intent. Tests that vary obs
      // per platform should pass a smarter `observations` set.
      return observations;
    }),
    fetchEntitiesForTenant: vi.fn(async (tenantId: string) => {
      calls.fetchEntitiesForTenant.push({ tenantId });
      return entities;
    }),
    fetchExistingRowState: vi.fn(
      async (tenantId: string, date: string, platform: string) => {
        calls.fetchExistingRowState.push({ tenantId, date, platform });
        return existingState;
      },
    ),
    applyExistingUpdate: vi.fn(async (u: ExistingRowUpdate) => {
      calls.applyExistingUpdate.push(u);
      return over.applyExistingError ?? null;
    }),
    applyPromptUpserts: vi.fn(
      async (rows: PromptRowUpsert[], tenantId: string) => {
        calls.applyPromptUpserts.push({ rows, tenantId });
        return over.applyPromptError ?? null;
      },
    ),
  };
  return { deps, calls };
}

// ─────────────────────────────────────────────────────────────────────
// 1. CLI argv parsing
// ─────────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("--tenant is required (no silent BEACON_TENANT_ID fallback)", () => {
    const r = parseArgs([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--tenant.*required/i);
  });

  it("dry-run is the default mode", () => {
    const r = parseArgs([`--tenant=${TENANT}`]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.commit).toBe(false);
  });

  it("--commit flips writes on", () => {
    const r = parseArgs([`--tenant=${TENANT}`, "--commit"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.commit).toBe(true);
  });

  it("rejects unknown flag", () => {
    const r = parseArgs([`--tenant=${TENANT}`, "--unknown-flag"]);
    expect(r.ok).toBe(false);
  });

  it("validates --limit as positive integer", () => {
    expect(parseArgs([`--tenant=${TENANT}`, "--limit=0"]).ok).toBe(false);
    expect(parseArgs([`--tenant=${TENANT}`, "--limit=-3"]).ok).toBe(false);
    expect(parseArgs([`--tenant=${TENANT}`, "--limit=abc"]).ok).toBe(false);
    const ok = parseArgs([`--tenant=${TENANT}`, "--limit=5"]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.args.limit).toBe(5);
  });

  it("validates date format", () => {
    expect(parseArgs([`--tenant=${TENANT}`, "--since=04-22"]).ok).toBe(false);
    expect(parseArgs([`--tenant=${TENANT}`, "--until=2026/05/01"]).ok).toBe(false);
  });

  it("rejects --since after --until", () => {
    const r = parseArgs([
      `--tenant=${TENANT}`,
      "--since=2026-05-10",
      "--until=2026-05-01",
    ]);
    expect(r.ok).toBe(false);
  });

  it("--force flag parses", () => {
    const r = parseArgs([`--tenant=${TENANT}`, "--force"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.force).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Anchor resolution
// ─────────────────────────────────────────────────────────────────────

describe("resolveAnchor", () => {
  it("clamps to NATIVE_REGIME_START when min observed_at is earlier", () => {
    const a = resolveAnchor(["2026-03-15T00:00:00Z"]);
    expect(a.anchor_date).toBe(NATIVE_START);
    expect(a.clamped_to_native_regime).toBe(true);
    expect(a.min_observation_date).toBe("2026-03-15");
  });

  it("uses min observed_at when post-NATIVE_REGIME_START", () => {
    const a = resolveAnchor(["2026-04-25T11:00:00Z"]);
    expect(a.anchor_date).toBe("2026-04-25");
    expect(a.clamped_to_native_regime).toBe(false);
    expect(a.min_observation_date).toBe("2026-04-25");
  });

  it("returns NATIVE_REGIME_START when no observations", () => {
    const a = resolveAnchor([]);
    expect(a.anchor_date).toBe(NATIVE_START);
    expect(a.min_observation_date).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. utcDateRange
// ─────────────────────────────────────────────────────────────────────

describe("utcDateRange", () => {
  it("inclusive since / exclusive until", () => {
    expect(utcDateRange("2026-04-22", "2026-04-25")).toEqual([
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
    ]);
  });

  it("empty when since === until", () => {
    expect(utcDateRange("2026-04-22", "2026-04-22")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. obsPlatformLabels
// ─────────────────────────────────────────────────────────────────────

describe("obsPlatformLabels", () => {
  it("Perplexity → both casings", () => {
    expect(obsPlatformLabels("Perplexity").sort()).toEqual(
      ["Perplexity", "perplexity"].sort(),
    );
  });
  it("ChatGPT → both casings", () => {
    expect(obsPlatformLabels("ChatGPT").sort()).toEqual(
      ["ChatGPT", "chatgpt"].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. planTuple — per-scope write path
// ─────────────────────────────────────────────────────────────────────

describe("planTuple — per-scope write path", () => {
  const OWNED = entity({ id: "own-ritzbuilders-com", is_owned: true });
  const COMP = entity({
    id: "comp-demattei-com",
    is_owned: false,
    name: "DeMattei",
    domain: "demattei.com",
    entity_type: "competitor",
  });

  it("owned-entity row update sets primary_recommendation_count from observations", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o2", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o3", prompt_id: "p2", primary_recommendation: false }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED, COMP],
      existingState: {
        // Owned row exists with NULL today → update to 2
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-demattei-perplexity", null],
          ["derived-2026-04-25-topic-general-perplexity", null],
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    const ownedUpdate = plan.existing_row_updates.find(
      (u) => u.id === "derived-2026-04-25-ritzbuilders-perplexity",
    );
    expect(ownedUpdate?.primary_recommendation_count).toBe(2);
  });

  it("competitor-entity row update sets primary_recommendation_count = null", () => {
    const obsList = [obs({ id: "o1", primary_recommendation: true })];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED, COMP],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-demattei-perplexity", 99], // stale wrong value
          ["derived-2026-04-25-topic-general-perplexity", null],
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    const compUpdate = plan.existing_row_updates.find(
      (u) => u.id === "derived-2026-04-25-demattei-perplexity",
    );
    expect(compUpdate?.primary_recommendation_count).toBeNull();
  });

  it("topic row update sets primary_recommendation_count = null (H8 lock)", () => {
    const obsList = [obs({ id: "o1", primary_recommendation: true })];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-topic-general-perplexity", 5], // stale value
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    const topicUpdate = plan.existing_row_updates.find((u) =>
      u.id.startsWith("derived-2026-04-25-topic-"),
    );
    expect(topicUpdate?.primary_recommendation_count).toBeNull();
  });

  it("platform row update sets run-wide primary_recommendation_count", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o2", prompt_id: "p2", primary_recommendation: false }),
      obs({ id: "o3", prompt_id: "p3", primary_recommendation: true }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    const platformUpdate = plan.existing_row_updates.find(
      (u) => u.id === "derived-2026-04-25-platform-perplexity",
    );
    expect(platformUpdate?.primary_recommendation_count).toBe(2);
  });

  it("prompt rows are emitted as full-row UPSERTs with deterministic ids and metadata stamp", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o2", prompt_id: "p2", primary_recommendation: false }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map(),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    expect(plan.prompt_row_upserts).toHaveLength(2);
    const promptIds = plan.prompt_row_upserts.map((r) => r.id).sort();
    expect(promptIds).toEqual([
      "derived-2026-04-25-prompt-p1-perplexity",
      "derived-2026-04-25-prompt-p2-perplexity",
    ]);
    const p1 = plan.prompt_row_upserts.find((r) => r.scope_id === "p1")!;
    expect(p1.tenant_id).toBe(TENANT);
    expect(p1.scope_type).toBe("prompt");
    expect(p1.primary_recommendation_count).toBe(1);
    expect((p1.metadata as Record<string, unknown>).section6_c3_backfill).toMatchObject(
      {
        anchor_date: "2026-04-25",
        observations_replayed: 2,
      },
    );
  });

  it("plan never emits scope_type='account' (architecture-pinned)", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o2", prompt_id: "p2", primary_recommendation: true }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map(),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    for (const u of plan.existing_row_updates) {
      expect(u.scope_type).not.toBe("account");
    }
    for (const u of plan.prompt_row_upserts) {
      expect(u.scope_type).not.toBe("account");
    }
  });

  it("idempotent: existing rows already at target → no UPDATE queued", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      obs({ id: "o2", prompt_id: "p2", primary_recommendation: true }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map<string, number | null>([
          ["derived-2026-04-25-ritzbuilders-perplexity", 2], // already 2
          ["derived-2026-04-25-platform-perplexity", 2], // already 2
          ["derived-2026-04-25-topic-general-perplexity", null], // topic already null
        ]),
        existingPromptIds: new Set([
          "derived-2026-04-25-prompt-p1-perplexity",
          "derived-2026-04-25-prompt-p2-perplexity",
        ]),
      },
      force: false,
    });
    expect(plan.skip_already_done).toBe(true);
    expect(plan.existing_row_updates).toEqual([]);
    expect(plan.prompt_row_upserts).toEqual([]);
  });

  it("--force bypasses skip-already-done", () => {
    const obsList = [
      obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", 1], // already at 1
        ]),
        existingPromptIds: new Set([
          "derived-2026-04-25-prompt-p1-perplexity",
        ]),
      },
      force: true,
    });
    expect(plan.skip_already_done).toBe(false);
    // With force, the owned entity row at target is STILL skipped
    // because the value matches, but prompt rows are re-emitted.
    expect(plan.prompt_row_upserts.length).toBeGreaterThan(0);
  });

  it("null and false primary_recommendation count as 0 (transitive C2 contract)", () => {
    const obsList = [
      obs({ id: "o1", primary_recommendation: null }),
      obs({ id: "o2", primary_recommendation: false }),
    ];
    const plan = planTuple({
      tenant_id: TENANT,
      date: "2026-04-25",
      platform: "Perplexity",
      observations: obsList,
      trackedEntities: [OWNED],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      force: false,
    });
    const owned = plan.existing_row_updates.find(
      (u) => u.id === "derived-2026-04-25-ritzbuilders-perplexity",
    );
    expect(owned?.primary_recommendation_count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. runBackfill — dry-run safety
// ─────────────────────────────────────────────────────────────────────

describe("runBackfill — dry-run safety", () => {
  it("dry-run mode invokes ZERO writes", async () => {
    const { deps, calls } = makeMockDeps({
      observations: [
        obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      ],
    });
    const args = defaultArgs({ commit: false });
    const result = await runBackfill(args, deps, () => {}, () => {});
    expect(result.summary.mode).toBe("DRY-RUN");
    expect(calls.applyExistingUpdate).toEqual([]);
    expect(calls.applyPromptUpserts).toEqual([]);
  });

  it("dry-run prints verification SQL via log", async () => {
    const lines: string[] = [];
    const { deps } = makeMockDeps();
    const args = defaultArgs({ commit: false });
    await runBackfill(args, deps, (m) => lines.push(m), () => {});
    expect(lines.join("\n")).toMatch(/Verification SQL/);
    expect(lines.join("\n")).toMatch(
      /WHERE tenant_id = 'tenant-ritz-founder'/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. runBackfill — commit mode
// ─────────────────────────────────────────────────────────────────────

describe("runBackfill — commit mode", () => {
  it("commit flag invokes writes", async () => {
    const { deps, calls } = makeMockDeps({
      observations: [
        obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      ],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
          ["derived-2026-04-25-platform-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
    });
    const args = defaultArgs({ commit: true });
    const result = await runBackfill(args, deps, () => {}, () => {});
    expect(result.summary.mode).toBe("COMMIT");
    // ChatGPT tuple has no observations in the simplified mock; we
    // can still expect at least the Perplexity tuple to write.
    expect(calls.applyExistingUpdate.length).toBeGreaterThan(0);
    expect(calls.applyPromptUpserts.length).toBeGreaterThan(0);
  });

  it("write error → exit_code 2 (partial)", async () => {
    const { deps } = makeMockDeps({
      observations: [
        obs({ id: "o1", prompt_id: "p1", primary_recommendation: true }),
      ],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
      applyExistingError: "supabase update failed",
    });
    const args = defaultArgs({ commit: true });
    const result = await runBackfill(args, deps, () => {}, () => {});
    expect(result.exit_code).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. Tenant isolation
// ─────────────────────────────────────────────────────────────────────

describe("runBackfill — tenant isolation", () => {
  it("every read passes the requested tenant only", async () => {
    const { deps, calls } = makeMockDeps();
    const args = defaultArgs({ tenant: "tenant-X" });
    await runBackfill(args, deps, () => {}, () => {});
    expect(calls.fetchTenantMinObservedAt.every((c) => c.tenantId === "tenant-X")).toBe(true);
    expect(calls.fetchObsForTuple.every((c) => c.tenantId === "tenant-X")).toBe(true);
    expect(calls.fetchEntitiesForTenant.every((c) => c.tenantId === "tenant-X")).toBe(true);
    expect(calls.fetchExistingRowState.every((c) => c.tenantId === "tenant-X")).toBe(true);
  });

  it("every write carries the requested tenant_id only", async () => {
    const { deps, calls } = makeMockDeps({
      observations: [
        obs({ id: "o1", prompt_id: "p1", primary_recommendation: true, tenant_id: "tenant-X" }),
      ],
      existingState: {
        nonPromptByIdPrimary: new Map([
          ["derived-2026-04-25-ritzbuilders-perplexity", null],
        ]),
        existingPromptIds: new Set(),
      },
    });
    const args = defaultArgs({ tenant: "tenant-X", commit: true });
    await runBackfill(args, deps, () => {}, () => {});
    for (const u of calls.applyExistingUpdate) {
      expect(u.tenant_id).toBe("tenant-X");
    }
    for (const call of calls.applyPromptUpserts) {
      expect(call.tenantId).toBe("tenant-X");
      for (const r of call.rows) expect(r.tenant_id).toBe("tenant-X");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. --since / --until / --limit
// ─────────────────────────────────────────────────────────────────────

describe("runBackfill — date range + limit", () => {
  it("--since/--until narrows the tuple set", async () => {
    const { deps, calls } = makeMockDeps();
    const args = defaultArgs({
      since: "2026-04-25",
      until: "2026-04-27",
    });
    await runBackfill(args, deps, () => {}, () => {});
    // 2 dates × 2 platforms = 4 tuples.
    expect(calls.fetchObsForTuple).toHaveLength(4);
  });

  it("--limit caps processed tuples", async () => {
    const { deps, calls } = makeMockDeps();
    const args = defaultArgs({
      since: "2026-04-25",
      until: "2026-04-29",
      limit: 3,
    });
    await runBackfill(args, deps, () => {}, () => {});
    expect(calls.fetchObsForTuple).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. Empty observations
// ─────────────────────────────────────────────────────────────────────

describe("runBackfill — empty observations", () => {
  it("tuple with zero observations writes nothing for that tuple", async () => {
    const { deps, calls } = makeMockDeps({ observations: [] });
    const args = defaultArgs({ commit: true });
    await runBackfill(args, deps, () => {}, () => {});
    expect(calls.applyExistingUpdate).toEqual([]);
    expect(calls.applyPromptUpserts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 11. C3AccountEmissionError kill-switch
// ─────────────────────────────────────────────────────────────────────

describe("C3AccountEmissionError", () => {
  it("constructor sets a descriptive message", () => {
    const e = new C3AccountEmissionError("derived-bogus-account-row");
    expect(e.message).toMatch(/invariant violation/i);
    expect(e.message).toMatch(/derived-bogus-account-row/);
    expect(e.name).toBe("C3AccountEmissionError");
  });
});

// ─────────────────────────────────────────────────────────────────────
// 12. Verification SQL shape
// ─────────────────────────────────────────────────────────────────────

describe("buildVerificationSql", () => {
  it("includes all 4 expected verification queries", () => {
    const sql = buildVerificationSql("tenant-X", "2026-04-22", "2026-05-15");
    expect(sql).toMatch(/scope_type = 'prompt'/);
    expect(sql).toMatch(/scope_type IN \('entity', 'platform'\)/);
    expect(sql).toMatch(/unexpected_topic_populated/);
    expect(sql).toMatch(/unexpected_account_rows/);
    expect(sql).toMatch(/tenant-X/);
  });
});
