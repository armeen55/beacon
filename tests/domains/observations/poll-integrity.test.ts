import { describe, it, expect, vi } from "vitest";

import {
  reconcilePolledRun,
  markRunPersistenceFailed,
  checkPersistenceGate,
} from "@/domains/observations/poll-integrity";

// ──────────────────────────────────────────────────────────────────────
// Poll Integrity Hardening (2026-05-04, post May 2-4 incident).
// Tests the read-only reconciliation logic + the read-only gate logic.
// We mock `getSupabaseAdmin` to control the rows the helpers see.
// ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => mockSupabase,
}));

// Hand-rolled supabase-client shim. Each helper returns a chain so we
// can simulate (a) a successful empty-row read, (b) a populated read,
// or (c) a query error.
type MockSelectResult =
  | { data: Array<unknown>; error: null; count?: number | null }
  | { data: null; error: { message: string } };

let mockSelectQueue: MockSelectResult[] = [];
let mockUpdateError: { message: string } | null = null;
const updateCalls: Array<Record<string, unknown>> = [];

const mockSupabase = {
  from(_table: string) {
    return {
      select(_col: string, _opts?: { count?: string; head?: boolean }) {
        return this;
      },
      eq(_col: string, _val: unknown) {
        return this;
      },
      order(_col: string, _opts: { ascending: boolean }) {
        return this;
      },
      limit(_n: number) {
        return this;
      },
      maybeSingle() {
        const next = mockSelectQueue.shift();
        if (!next)
          return Promise.resolve({ data: null, error: null });
        if ("error" in next && next.error) {
          return Promise.resolve({ data: null, error: next.error });
        }
        const dataArr = (next as { data: Array<unknown> }).data;
        return Promise.resolve({
          data: dataArr[0] ?? null,
          error: null,
        });
      },
      // Direct (no-await on chain): the count:exact / head:true path
      then(resolve: (v: unknown) => void) {
        const next = mockSelectQueue.shift();
        if (!next) return resolve({ data: [], error: null, count: 0 });
        return resolve(next);
      },
      update(payload: Record<string, unknown>) {
        updateCalls.push(payload);
        return {
          eq() {
            return this;
          },
          then(resolve: (v: unknown) => void) {
            return resolve({
              data: null,
              error: mockUpdateError,
            });
          },
        };
      },
    };
  },
};

function setSelect(results: MockSelectResult[]): void {
  mockSelectQueue = results;
}

function resetMocks(): void {
  mockSelectQueue = [];
  mockUpdateError = null;
  updateCalls.length = 0;
}

describe("reconcilePolledRun (Operator R1 + R2)", () => {
  it("ok=true when persisted == expected and no guard triggers", async () => {
    resetMocks();
    setSelect([{ data: [], error: null, count: 25 }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 25,
      costUsd: 0.6,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.persistedObsCount).toBe(25);
    expect(verdict.reasons).toEqual([]);
  });

  it("ok=false when cost>0 and persisted=0 (May 2-4 silent-failure pattern)", async () => {
    resetMocks();
    setSelect([{ data: [], error: null, count: 0 }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 25,
      costUsd: 0.6,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(verdict.reasons[0]).toMatch(/silent-write-failure pattern/);
    expect(verdict.reasons[0]).toMatch(/May 2-4 incident/);
  });

  it("ok=false when expectedObsCount>0 and persisted=0 (regardless of cost)", async () => {
    resetMocks();
    setSelect([{ data: [], error: null, count: 0 }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 25,
      costUsd: 0,
    });
    expect(verdict.ok).toBe(false);
    expect(
      verdict.reasons.some((r) =>
        /Reported 25 prompts polled but ZERO observations persisted/.test(r),
      ),
    ).toBe(true);
  });

  it("ok=false on partial persistence (completed chunks but missing rows)", async () => {
    resetMocks();
    setSelect([{ data: [], error: null, count: 12 }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 25,
      costUsd: 0.6,
    });
    expect(verdict.ok).toBe(false);
    expect(
      verdict.reasons.some((r) =>
        /Run reported 25 prompts but only 12 observations persisted/.test(r),
      ),
    ).toBe(true);
  });

  it("treats query error as reconciliation failure (fail-safe)", async () => {
    resetMocks();
    setSelect([{ data: null, error: { message: "supabase down" } }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 25,
      costUsd: 0.6,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.persistedObsCount).toBe(0);
    expect(verdict.reasons[0]).toMatch(/Reconciliation read FAILED/);
  });

  it("ok=true when no expectations (zero prompts, zero cost) and zero persisted", async () => {
    resetMocks();
    setSelect([{ data: [], error: null, count: 0 }]);
    const verdict = await reconcilePolledRun({
      tenantId: "t1",
      runId: "r1",
      expectedObsCount: 0,
      costUsd: 0,
    });
    expect(verdict.ok).toBe(true);
  });
});

describe("markRunPersistenceFailed", () => {
  it("appends a 'PERSISTENCE FAILED' marker to scope_label and updates status to failed", async () => {
    resetMocks();
    // First select → existing scope_label read
    setSelect([
      {
        data: [{ scope_label: "Native chatgpt poll · 25/25 prompts · cost=$0.5" }],
        error: null,
      },
    ]);
    await markRunPersistenceFailed({
      tenantId: "t1",
      runId: "r1",
      reasons: ["Paid call cost $0.5 but ZERO observations persisted"],
      persistedObsCount: 0,
      expectedObsCount: 25,
      costUsd: 0.5,
    });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].status).toBe("failed");
    expect(String(updateCalls[0].scope_label)).toMatch(/PERSISTENCE FAILED/);
    expect(String(updateCalls[0].scope_label)).toMatch(
      /ZERO observations persisted/,
    );
    // Original scope_label preserved (not replaced).
    expect(String(updateCalls[0].scope_label)).toMatch(/cost=\$0\.5/);
  });

  it("is idempotent — already-stamped runs do not double-append", async () => {
    resetMocks();
    setSelect([
      {
        data: [
          {
            scope_label:
              "Native chatgpt poll · 25/25 · PERSISTENCE FAILED: previous reason",
          },
        ],
        error: null,
      },
    ]);
    await markRunPersistenceFailed({
      tenantId: "t1",
      runId: "r1",
      reasons: ["new reason"],
      persistedObsCount: 0,
      expectedObsCount: 25,
      costUsd: 0.5,
    });
    expect(updateCalls.length).toBe(1);
    // Should NOT contain "new reason" — already-stamped exits early.
    expect(String(updateCalls[0].scope_label)).not.toMatch(/new reason/);
  });
});

describe("checkPersistenceGate (Operator R6)", () => {
  it("allows when no prior runs exist on this source", async () => {
    resetMocks();
    setSelect([{ data: [], error: null }]);
    const verdict = await checkPersistenceGate({
      tenantId: "t1",
      source: "openai-native-poll",
    });
    expect(verdict.allow).toBe(true);
    expect(verdict.blockedByRunId).toBe(null);
  });

  it("allows when latest run was status=completed (the normal case)", async () => {
    resetMocks();
    setSelect([
      {
        data: [
          {
            run_id: "r1",
            status: "completed",
            scope_label: "ok",
            started_at: "2026-05-04T10:00:00Z",
          },
        ],
        error: null,
      },
    ]);
    const verdict = await checkPersistenceGate({
      tenantId: "t1",
      source: "openai-native-poll",
    });
    expect(verdict.allow).toBe(true);
  });

  it("BLOCKS when latest run was status=failed AND scope_label carries PERSISTENCE FAILED", async () => {
    resetMocks();
    setSelect([
      {
        data: [
          {
            run_id: "r-bad-1",
            status: "failed",
            scope_label:
              "Native chatgpt poll · PERSISTENCE FAILED: column drift",
            started_at: "2026-05-04T10:00:00Z",
          },
        ],
        error: null,
      },
    ]);
    const verdict = await checkPersistenceGate({
      tenantId: "t1",
      source: "openai-native-poll",
    });
    expect(verdict.allow).toBe(false);
    expect(verdict.blockedByRunId).toBe("r-bad-1");
    expect(verdict.reason).toMatch(
      /Last openai-native-poll run \(r-bad-1\) failed persistence/,
    );
  });

  it("ALLOWS when latest run was status=failed but NOT a persistence failure (API/network)", async () => {
    resetMocks();
    setSelect([
      {
        data: [
          {
            run_id: "r-net-1",
            status: "failed",
            scope_label: "Native chatgpt poll · network timeout",
            started_at: "2026-05-04T10:00:00Z",
          },
        ],
        error: null,
      },
    ]);
    const verdict = await checkPersistenceGate({
      tenantId: "t1",
      source: "openai-native-poll",
    });
    // Non-persistence failures shouldn't auto-block (operator manually
    // decides whether to retry; cron retries naturally tomorrow).
    expect(verdict.allow).toBe(true);
  });

  it("fails SAFE on read error (allows polling rather than paralyzing prod)", async () => {
    resetMocks();
    setSelect([{ data: null, error: { message: "rls denied" } }]);
    const verdict = await checkPersistenceGate({
      tenantId: "t1",
      source: "openai-native-poll",
    });
    expect(verdict.allow).toBe(true);
    expect(verdict.reason).toMatch(/gate-read-failed/);
  });
});
