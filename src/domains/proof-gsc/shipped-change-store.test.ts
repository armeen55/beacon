/**
 * shipped-change-store.test.ts (J-73/C-25, 2026-07-09).
 *
 * Pins the two additive columns the crawl-verify pass writes
 * (verify-shipped-change.ts):
 *   - recordToRow/rowToRecord round-trip editDiff + verifyState losslessly,
 *     and emit both columns UNCONDITIONALLY (including null) so a re-verify
 *     that clears a stale value actually clears it.
 *   - rowToRecord defends against a malformed/legacy value in either column
 *     (never lets a bad JSON blob crash a render).
 *   - markVerifyResultById is a targeted, tenant-EXPLICIT single-row update
 *     (never load-all/upsert-all, never ambient tenant) - two tenants with
 *     the same row id never cross-write each other's ledger.
 *   - markVerifyResultById only ever sets verified_live=true for outcome
 *     "verified_live" - every other outcome writes verified_live=false.
 *   - a PGRST204 (missing column - pre-migration) update error is swallowed,
 *     same posture as the pre-existing markRecrawlRequestedById.
 *   - the no-Supabase-env path degrades to the file store and still patches
 *     the matching row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/app/(shell)/results/results-surface-store", () => ({
  invalidateResultsSurface: vi.fn(async () => {}),
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-ambient",
}));

// ── Chainable supabase mock: update().eq().eq() resolves via a thenable chain ──
type EqCall = [string, unknown];
let updateError: { code?: string; message?: string } | null = null;
let supabaseThrows = false;
const updateCalls: Array<{ payload: Record<string, unknown>; eqCalls: EqCall[] }> = [];

function makeChain() {
  const eqCalls: EqCall[] = [];
  const chain: Record<string, unknown> = {};
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    updateCalls.push({ payload, eqCalls });
    return chain;
  });
  chain.eq = vi.fn((col: string, val: unknown) => {
    eqCalls.push([col, val]);
    return chain;
  });
  // The store's final expression is `await admin.from(T).update(...).eq(...).eq(...)`
  // - making the chain itself thenable lets one mock object serve the whole call.
  chain.then = (resolve: (v: { error: typeof updateError }) => void) => resolve({ error: updateError });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (supabaseThrows) throw new Error("no supabase env");
    return { from: vi.fn(() => makeChain()) };
  },
}));

// ── File fallback (json-store) ──────────────────────────────────────────────
let fileRows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => fileRows,
  writeStore: async (_name: string, rows: Array<Record<string, unknown>>) => {
    fileRows = rows;
  },
}));

import {
  recordToRow,
  rowToRecord,
  markVerifyResultById,
  type ShippedChangeRecord,
  type EditDiffRecord,
  type VerifyState,
} from "./shipped-change-store";

function baseRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "id-1",
    page: "https://site.com/treated",
    path: "/treated",
    actionType: "edit_title",
    before: "old title",
    after: "new title",
    shippedAt: "2026-07-01T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 100, ctr: 0.1, position: 5, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

const editDiffFixture: EditDiffRecord = {
  field: "title",
  proposedAfter: "The 12 Best Persian Restaurants in Tehran",
  liveText: "12 Best Persian Restaurants, Tehran",
  similarity: 0.91,
  verdict: "verified_live",
  capturedAt: "2026-07-09T12:00:00.000Z",
};

const verifyStateFixture: VerifyState = { outcome: "verified_live", kind: "modified" };

beforeEach(() => {
  updateError = null;
  supabaseThrows = false;
  updateCalls.length = 0;
  fileRows = [];
});

describe("recordToRow / rowToRecord - editDiff + verifyState round trip", () => {
  it("recordToRow emits edit_diff + verify_state unconditionally, including null", () => {
    const withNulls = recordToRow("tenant-a", baseRecord());
    expect(withNulls.edit_diff).toBeNull();
    expect(withNulls.verify_state).toBeNull();

    const withValues = recordToRow(
      "tenant-a",
      baseRecord({ editDiff: editDiffFixture, verifyState: verifyStateFixture }),
    );
    expect(withValues.edit_diff).toEqual(editDiffFixture);
    expect(withValues.verify_state).toEqual(verifyStateFixture);
  });

  it("round-trips editDiff + verifyState losslessly through recordToRow -> rowToRecord", () => {
    const original = baseRecord({ editDiff: editDiffFixture, verifyState: verifyStateFixture });
    const row = recordToRow("tenant-a", original);
    const restored = rowToRecord(row);
    expect(restored.editDiff).toEqual(editDiffFixture);
    expect(restored.verifyState).toEqual(verifyStateFixture);
  });

  it("rowToRecord defaults both fields to null when the row predates J-73/C-25 (columns absent)", () => {
    const row = recordToRow("tenant-a", baseRecord());
    // Simulate a pre-migration row: the columns are simply absent (not present
    // at all, not just null) — TypeScript allows this since both are optional.
    delete (row as Record<string, unknown>).edit_diff;
    delete (row as Record<string, unknown>).verify_state;
    const restored = rowToRecord(row);
    expect(restored.editDiff).toBeNull();
    expect(restored.verifyState).toBeNull();
  });

  it("rowToRecord never trusts a malformed edit_diff or verify_state blob", () => {
    const row = recordToRow("tenant-a", baseRecord());
    (row as Record<string, unknown>).edit_diff = { field: "title" }; // missing required keys
    (row as Record<string, unknown>).verify_state = { outcome: "not_a_real_outcome" };
    const restored = rowToRecord(row);
    expect(restored.editDiff).toBeNull();
    expect(restored.verifyState).toBeNull();
  });

  it("rowToRecord accepts kind: null on a non-verified_live outcome", () => {
    const row = recordToRow(
      "tenant-a",
      baseRecord({ verifyState: { outcome: "not_found", kind: null } }),
    );
    const restored = rowToRecord(row);
    expect(restored.verifyState).toEqual({ outcome: "not_found", kind: null });
  });
});

describe("markVerifyResultById - explicit tenant, single-row update", () => {
  it("writes verify_state + edit_diff + verified_live=true for outcome verified_live, scoped by tenant_id AND id", async () => {
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: verifyStateFixture,
      editDiff: editDiffFixture,
    });
    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0]!;
    expect(call.payload.verify_state).toEqual(verifyStateFixture);
    expect(call.payload.edit_diff).toEqual(editDiffFixture);
    expect(call.payload.verified_live).toBe(true);
    expect(call.eqCalls).toEqual([
      ["tenant_id", "tenant-a"],
      ["id", "row-1"],
    ]);
  });

  it.each([
    ["verified_live_modified", null],
    ["not_found", null],
    ["needs_review", null],
    ["crawl_failed", null],
  ] as const)("writes verified_live=false for outcome %s (never a silent verified)", async (outcome, kind) => {
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome, kind },
      editDiff: null,
    });
    expect(updateCalls[0]!.payload.verified_live).toBe(false);
  });

  it("two tenants with the SAME row id never cross-write: each call is scoped to its own tenant_id", async () => {
    await markVerifyResultById("tenant-a", "shared-id", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: null,
    });
    await markVerifyResultById("tenant-b", "shared-id", {
      verifyState: { outcome: "not_found", kind: null },
      editDiff: null,
    });
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0]!.eqCalls).toEqual([
      ["tenant_id", "tenant-a"],
      ["id", "shared-id"],
    ]);
    expect(updateCalls[1]!.eqCalls).toEqual([
      ["tenant_id", "tenant-b"],
      ["id", "shared-id"],
    ]);
    // tenant-a's update never asserted anything about tenant-b, and vice
    // versa - the two calls carry independent verdicts for the same id.
    expect(updateCalls[0]!.payload.verified_live).toBe(true);
    expect(updateCalls[1]!.payload.verified_live).toBe(false);
  });

  it("swallows a PGRST204 (missing column, pre-migration) update error rather than throwing", async () => {
    updateError = { code: "PGRST204", message: "Could not find the 'verify_state' column" };
    await expect(
      markVerifyResultById("tenant-a", "row-1", { verifyState: verifyStateFixture, editDiff: null }),
    ).resolves.toBeUndefined();
  });

  it("throws on a real (non-schema) database error", async () => {
    updateError = { code: "23505", message: "some real constraint violation" };
    await expect(
      markVerifyResultById("tenant-a", "row-1", { verifyState: verifyStateFixture, editDiff: null }),
    ).rejects.toThrow(/markVerifyResultById failed/);
  });

  it("degrades to the file store when there is no Supabase env, patching only the matching row", async () => {
    supabaseThrows = true;
    // The file store holds ShippedChangeRecord objects directly (camelCase),
    // NOT LedgerRow (see readFile/upsertFile) — same shape the cache test's
    // file-fallback fixtures use.
    fileRows = [
      baseRecord({ id: "row-1" }) as unknown as Record<string, unknown>,
      baseRecord({ id: "row-2" }) as unknown as Record<string, unknown>,
    ];
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: verifyStateFixture,
      editDiff: editDiffFixture,
    });
    const patched = fileRows.find((r) => r.id === "row-1")!;
    expect(patched.verifyState).toEqual(verifyStateFixture);
    expect(patched.editDiff).toEqual(editDiffFixture);
    expect(patched.verifiedLive).toBe(true);
    const untouched = fileRows.find((r) => r.id === "row-2")!;
    expect(untouched.verifyState).toBeUndefined();
  });
});
