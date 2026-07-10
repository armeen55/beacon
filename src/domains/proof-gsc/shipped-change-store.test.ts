/**
 * shipped-change-store.test.ts (J-73/C-25 + W5 stop-ship F5, 2026-07-09).
 *
 * Pins the VerifyEnvelope trust boundary the crawl-verify pass writes:
 *   - recordToRow/rowToRecord round-trip editDiff + the verify_state envelope
 *     losslessly, emit both columns UNCONDITIONALLY (incl. null), defend against
 *     a malformed blob, and UPGRADE a legacy flat {outcome,kind} value to an
 *     envelope on read.
 *   - markVerifyResultById SUCCESS path is a blind atomic single UPDATE that
 *     latches canonical + resets retry bookkeeping, scoped to tenant_id AND id,
 *     and flips verified_live only for a verified_live outcome (never
 *     verified_live_modified).
 *   - markVerifyResultById FAILURE path is a compare-and-set: it reads the
 *     envelope, no-ops on a canonical success, else bumps attempts and writes
 *     ONLY the retry fields under a `verify_state->>canonical is null` guard;
 *     0 rows matched is a legitimate no-op.
 *   - the concurrency quartet on the single-process file mirror:
 *     success->failure (keeps all), failure->success (flips+resets),
 *     failure->failure (attempts advance, canonical stays null),
 *     modified->failure (preserves canonical).
 *   - two tenants with the same row id never cross-write.
 *   - resetVerifyRetryById re-arms retry but never a latched success.
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

// ── Chainable supabase mock: supports read (select().eq().eq().maybeSingle())
//    AND write (update().eq().eq()[.filter()][.select()] awaited) ──────────────
type ChainRec = {
  op: "update" | "select" | null;
  payload?: Record<string, unknown>;
  eqCalls: Array<[string, unknown]>;
  filterCalls: Array<[string, string, unknown]>;
  selectCols?: string;
  maybeSingleCalled: boolean;
};
let chains: ChainRec[] = [];
let supabaseThrows = false;
let readData: { verify_state?: unknown } | null = null;
let readError: { code?: string; message?: string } | null = null;
let mutError: { code?: string; message?: string } | null = null;
let updateReturnData: unknown[] = [];

function makeChain() {
  const rec: ChainRec = { op: null, eqCalls: [], filterCalls: [], maybeSingleCalled: false };
  chains.push(rec);
  const chain: Record<string, unknown> = {};
  chain.update = (payload: Record<string, unknown>) => {
    rec.op = "update";
    rec.payload = payload;
    return chain;
  };
  chain.select = (cols?: string) => {
    if (rec.op == null) rec.op = "select";
    rec.selectCols = cols;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    rec.eqCalls.push([col, val]);
    return chain;
  };
  chain.filter = (a: string, b: string, c: unknown) => {
    rec.filterCalls.push([a, b, c]);
    return chain;
  };
  chain.maybeSingle = async () => {
    rec.maybeSingleCalled = true;
    return { data: readData, error: readError };
  };
  // Awaiting the chain (the update path) resolves the mutation result.
  chain.then = (resolve: (v: { data: unknown; error: typeof mutError }) => void) =>
    resolve({ data: updateReturnData, error: mutError });
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
  resetVerifyRetryById,
  loadShippedChangesForTenant,
  canonicalOutcome,
  normalizeVerifyEnvelope,
  MAX_VERIFY_ATTEMPTS,
  type ShippedChangeRecord,
  type EditDiffRecord,
  type VerifyEnvelope,
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

const successEnvelope: VerifyEnvelope = {
  canonical: { outcome: "verified_live", kind: "modified" },
  canonicalAt: "2026-07-09T12:00:00.000Z",
  lastAttempt: null,
  attempts: 0,
  nextRetryAt: null,
  exhausted: false,
};

function updateChains() {
  return chains.filter((c) => c.op === "update");
}

beforeEach(() => {
  chains = [];
  supabaseThrows = false;
  readData = null;
  readError = null;
  mutError = null;
  updateReturnData = [];
  fileRows = [];
});

describe("recordToRow / rowToRecord - editDiff + verify_state envelope round trip", () => {
  it("recordToRow emits edit_diff + verify_state unconditionally, including null", () => {
    const withNulls = recordToRow("tenant-a", baseRecord());
    expect(withNulls.edit_diff).toBeNull();
    expect(withNulls.verify_state).toBeNull();

    const withValues = recordToRow(
      "tenant-a",
      baseRecord({ editDiff: editDiffFixture, verifyState: successEnvelope }),
    );
    expect(withValues.edit_diff).toEqual(editDiffFixture);
    expect(withValues.verify_state).toEqual(successEnvelope);
  });

  it("round-trips editDiff + verify_state envelope losslessly through recordToRow -> rowToRecord", () => {
    const original = baseRecord({ editDiff: editDiffFixture, verifyState: successEnvelope });
    const restored = rowToRecord(recordToRow("tenant-a", original));
    expect(restored.editDiff).toEqual(editDiffFixture);
    expect(restored.verifyState).toEqual(successEnvelope);
  });

  it("rowToRecord defaults both fields to null when the row predates the columns", () => {
    const row = recordToRow("tenant-a", baseRecord());
    delete (row as Record<string, unknown>).edit_diff;
    delete (row as Record<string, unknown>).verify_state;
    const restored = rowToRecord(row);
    expect(restored.editDiff).toBeNull();
    expect(restored.verifyState).toBeNull();
  });

  it("rowToRecord never trusts a malformed edit_diff or verify_state blob", () => {
    const row = recordToRow("tenant-a", baseRecord());
    (row as Record<string, unknown>).edit_diff = { field: "title" };
    (row as Record<string, unknown>).verify_state = { canonical: 42, attempts: "nope" };
    const restored = rowToRecord(row);
    expect(restored.editDiff).toBeNull();
    expect(restored.verifyState).toBeNull();
  });

  it("UPGRADES a legacy flat success {outcome,kind} to a latched canonical envelope on read", () => {
    const row = recordToRow("tenant-a", baseRecord());
    (row as Record<string, unknown>).verify_state = { outcome: "verified_live", kind: "exact" };
    const restored = rowToRecord(row);
    expect(restored.verifyState).toEqual({
      canonical: { outcome: "verified_live", kind: "exact" },
      canonicalAt: null,
      lastAttempt: null,
      attempts: 0,
      nextRetryAt: null,
      exhausted: false,
    });
  });

  it("UPGRADES a legacy flat non-success to an envelope with one recorded attempt", () => {
    const row = recordToRow("tenant-a", baseRecord());
    (row as Record<string, unknown>).verify_state = { outcome: "crawl_failed", kind: null };
    const restored = rowToRecord(row);
    expect(restored.verifyState).toEqual({
      canonical: null,
      canonicalAt: null,
      lastAttempt: { state: "crawl_failed", at: "" },
      attempts: 1,
      nextRetryAt: null,
      exhausted: false,
    });
  });
});

describe("markVerifyResultById - SUCCESS path (blind atomic latch)", () => {
  it("latches canonical + edit_diff + verified_live=true for verified_live, scoped by tenant_id AND id, NO CAS guard", async () => {
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: editDiffFixture,
    });
    const ups = updateChains();
    expect(ups).toHaveLength(1);
    const call = ups[0]!;
    const env = call.payload!.verify_state as VerifyEnvelope;
    expect(env.canonical).toEqual({ outcome: "verified_live", kind: "exact" });
    expect(typeof env.canonicalAt).toBe("string");
    expect(env.attempts).toBe(0);
    expect(env.exhausted).toBe(false);
    expect(call.payload!.edit_diff).toEqual(editDiffFixture);
    expect(call.payload!.verified_live).toBe(true);
    expect(call.eqCalls).toEqual([
      ["tenant_id", "tenant-a"],
      ["id", "row-1"],
    ]);
    // A success is a blind write - never the CAS guard.
    expect(call.filterCalls).toEqual([]);
  });

  it("verified_live_modified latches canonical but OMITS the verified_live column (never the receipt boolean)", async () => {
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live_modified", kind: null },
      editDiff: null,
    });
    const call = updateChains()[0]!;
    const env = call.payload!.verify_state as VerifyEnvelope;
    expect(env.canonical).toEqual({ outcome: "verified_live_modified", kind: null });
    expect(call.payload).not.toHaveProperty("verified_live");
  });

  it("two tenants with the same row id never cross-write (each scoped to its own tenant_id)", async () => {
    await markVerifyResultById("tenant-a", "shared-id", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: null,
    });
    await markVerifyResultById("tenant-b", "shared-id", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: null,
    });
    const ups = updateChains();
    expect(ups).toHaveLength(2);
    expect(ups[0]!.eqCalls).toEqual([["tenant_id", "tenant-a"], ["id", "shared-id"]]);
    expect(ups[1]!.eqCalls).toEqual([["tenant_id", "tenant-b"], ["id", "shared-id"]]);
  });

  it("swallows a PGRST204 (missing column, pre-migration) update error rather than throwing", async () => {
    mutError = { code: "PGRST204", message: "Could not find the 'verify_state' column" };
    await expect(
      markVerifyResultById("tenant-a", "row-1", {
        verifyState: { outcome: "verified_live", kind: "exact" },
        editDiff: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws on a real (non-schema) database error", async () => {
    mutError = { code: "23505", message: "some real constraint violation" };
    await expect(
      markVerifyResultById("tenant-a", "row-1", {
        verifyState: { outcome: "verified_live", kind: "exact" },
        editDiff: null,
      }),
    ).rejects.toThrow(/markVerifyResultById failed/);
  });
});

describe("markVerifyResultById - FAILURE path (compare-and-set)", () => {
  it("reads the envelope, then writes ONLY the retry fields under the canonical-is-null CAS guard", async () => {
    readData = { verify_state: null }; // never verified
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "crawl_failed", kind: null },
      editDiff: null,
    });
    // read chain first, then a guarded update.
    const read = chains.find((c) => c.op === "select" && c.maybeSingleCalled)!;
    expect(read.selectCols).toBe("verify_state");
    expect(read.eqCalls).toEqual([["tenant_id", "tenant-a"], ["id", "row-1"]]);

    const up = updateChains()[0]!;
    const env = up.payload!.verify_state as VerifyEnvelope;
    expect(env.canonical).toBeNull();
    expect(env.attempts).toBe(1);
    expect(env.lastAttempt?.state).toBe("crawl_failed");
    expect(env.exhausted).toBe(false);
    expect(typeof env.nextRetryAt).toBe("string");
    // never touches the receipt boolean or the diff on a failure.
    expect(up.payload).not.toHaveProperty("verified_live");
    expect(up.payload).not.toHaveProperty("edit_diff");
    // the CAS guard is present and select("id") confirms the matched rows.
    expect(up.filterCalls).toEqual([["verify_state->>canonical", "is", null]]);
    expect(up.selectCols).toBe("id");
  });

  it("no-ops (NO update issued) when the read shows a canonical success already latched", async () => {
    readData = { verify_state: successEnvelope };
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "crawl_failed", kind: null },
      editDiff: null,
    });
    expect(updateChains()).toHaveLength(0);
  });

  it("CAS zero-row no-op: an update that matched 0 rows (a concurrent success won) resolves without throwing", async () => {
    readData = { verify_state: null };
    updateReturnData = []; // 0 rows matched the canonical-is-null guard
    await expect(
      markVerifyResultById("tenant-a", "row-1", {
        verifyState: { outcome: "not_found", kind: null },
        editDiff: null,
      }),
    ).resolves.toBeUndefined();
    // the guarded update WAS attempted.
    expect(updateChains()[0]!.filterCalls).toEqual([["verify_state->>canonical", "is", null]]);
  });

  it("advances attempts from the read envelope's prior count", async () => {
    readData = {
      verify_state: {
        canonical: null,
        canonicalAt: null,
        lastAttempt: { state: "not_found", at: "2026-07-08T00:00:00.000Z" },
        attempts: 2,
        nextRetryAt: "2026-07-08T06:00:00.000Z",
        exhausted: false,
      } satisfies VerifyEnvelope,
    };
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "needs_review", kind: null },
      editDiff: { ...editDiffFixture, similarity: 0.72 },
    });
    const env = updateChains()[0]!.payload!.verify_state as VerifyEnvelope;
    expect(env.attempts).toBe(3);
    expect(env.lastAttempt?.state).toBe("needs_review");
    expect(env.lastAttempt?.similarity).toBe(0.72);
  });

  it("marks exhausted (and nulls nextRetryAt) at MAX_VERIFY_ATTEMPTS", async () => {
    readData = {
      verify_state: {
        canonical: null,
        canonicalAt: null,
        lastAttempt: { state: "crawl_failed", at: "2026-07-08T00:00:00.000Z" },
        attempts: MAX_VERIFY_ATTEMPTS - 1,
        nextRetryAt: "2026-07-08T06:00:00.000Z",
        exhausted: false,
      } satisfies VerifyEnvelope,
    };
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "crawl_failed", kind: null },
      editDiff: null,
    });
    const env = updateChains()[0]!.payload!.verify_state as VerifyEnvelope;
    expect(env.attempts).toBe(MAX_VERIFY_ATTEMPTS);
    expect(env.exhausted).toBe(true);
    expect(env.nextRetryAt).toBeNull();
  });
});

describe("markVerifyResultById - file fallback (the concurrency quartet)", () => {
  beforeEach(() => {
    supabaseThrows = true;
  });

  it("1. success -> failure keeps ALL (no-op): canonical, verifiedLive, editDiff, attempts=0 preserved", async () => {
    fileRows = [baseRecord({ id: "row-1", verifiedLive: false }) as unknown as Record<string, unknown>];
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: editDiffFixture,
    });
    // Then a transient crawl_failed re-verify: a complete no-op on the latch.
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "crawl_failed", kind: null },
      editDiff: null,
    });
    const rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(canonicalOutcome(rec.verifyState)).toBe("verified_live");
    expect(rec.verifiedLive).toBe(true);
    expect(rec.editDiff).toEqual(editDiffFixture);
    expect(normalizeVerifyEnvelope(rec.verifyState)?.attempts).toBe(0);
  });

  it("2. failure -> success flips + RESETS: attempts back to 0, canonical latched, verifiedLive true", async () => {
    fileRows = [baseRecord({ id: "row-1", verifiedLive: false }) as unknown as Record<string, unknown>];
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "crawl_failed", kind: null },
      editDiff: null,
    });
    let rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(normalizeVerifyEnvelope(rec.verifyState)?.attempts).toBe(1);
    expect(rec.verifiedLive).toBe(false);

    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: editDiffFixture,
    });
    rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(canonicalOutcome(rec.verifyState)).toBe("verified_live");
    expect(normalizeVerifyEnvelope(rec.verifyState)?.attempts).toBe(0);
    expect(rec.verifiedLive).toBe(true);
  });

  it("3. failure -> failure advances attempts, canonical stays null, verifiedLive stays false", async () => {
    fileRows = [baseRecord({ id: "row-1", verifiedLive: false }) as unknown as Record<string, unknown>];
    await markVerifyResultById("tenant-a", "row-1", { verifyState: { outcome: "crawl_failed", kind: null }, editDiff: null });
    await markVerifyResultById("tenant-a", "row-1", { verifyState: { outcome: "not_found", kind: null }, editDiff: null });
    const rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    const env = normalizeVerifyEnvelope(rec.verifyState)!;
    expect(env.attempts).toBe(2);
    expect(env.canonical).toBeNull();
    expect(env.lastAttempt?.state).toBe("not_found");
    expect(rec.verifiedLive).toBe(false);
  });

  it("4. modified -> failure preserves canonical (verified_live_modified), never downgrades", async () => {
    fileRows = [baseRecord({ id: "row-1", verifiedLive: false }) as unknown as Record<string, unknown>];
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live_modified", kind: null },
      editDiff: editDiffFixture,
    });
    await markVerifyResultById("tenant-a", "row-1", { verifyState: { outcome: "crawl_failed", kind: null }, editDiff: null });
    const rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(canonicalOutcome(rec.verifyState)).toBe("verified_live_modified");
    expect(rec.editDiff).toEqual(editDiffFixture);
    // verified_live_modified never sets the receipt boolean.
    expect(rec.verifiedLive).toBe(false);
  });

  it("patches only the matching row; a sibling is untouched", async () => {
    fileRows = [
      baseRecord({ id: "row-1" }) as unknown as Record<string, unknown>,
      baseRecord({ id: "row-2" }) as unknown as Record<string, unknown>,
    ];
    await markVerifyResultById("tenant-a", "row-1", {
      verifyState: { outcome: "verified_live", kind: "exact" },
      editDiff: editDiffFixture,
    });
    const patched = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(canonicalOutcome(patched.verifyState)).toBe("verified_live");
    expect(patched.verifiedLive).toBe(true);
    const untouched = fileRows.find((r) => r.id === "row-2")!;
    expect(untouched.verifyState).toBeUndefined();
  });

  it("upgrades a legacy flat non-success file row to an envelope on the next failure", async () => {
    fileRows = [
      baseRecord({ id: "row-1", verifyState: { outcome: "crawl_failed", kind: null } as unknown as VerifyEnvelope }) as unknown as Record<string, unknown>,
    ];
    await markVerifyResultById("tenant-a", "row-1", { verifyState: { outcome: "not_found", kind: null }, editDiff: null });
    const rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    const env = normalizeVerifyEnvelope(rec.verifyState)!;
    // legacy flat non-success normalizes to attempts:1, then this failure -> 2.
    expect(env.attempts).toBe(2);
    expect(env.canonical).toBeNull();
    expect(env.lastAttempt?.state).toBe("not_found");
  });
});

describe("loadShippedChangesForTenant (F3 - tenant-explicit read)", () => {
  it("reads the EXPLICIT tenant, never the ambient currentTenantId", async () => {
    updateReturnData = [recordToRow("tenant-x", baseRecord({ id: "x-1" }))];
    const out = await loadShippedChangesForTenant("tenant-x");
    expect(out.map((r) => r.id)).toEqual(["x-1"]);
    const readChain = chains.find(
      (c) => c.op === "select" && c.eqCalls.some(([k]) => k === "tenant_id"),
    );
    // Scoped to the passed tenant-x, NOT the mocked ambient "tenant-ambient".
    expect(readChain?.eqCalls).toEqual([["tenant_id", "tenant-x"]]);
  });

  it("returns [] for an empty tenantId without touching the DB", async () => {
    const out = await loadShippedChangesForTenant("");
    expect(out).toEqual([]);
    expect(chains).toHaveLength(0);
  });
});

describe("resetVerifyRetryById", () => {
  it("file path: re-arms retry (fresh envelope) for a non-latched row", async () => {
    supabaseThrows = true;
    fileRows = [
      baseRecord({
        id: "row-1",
        verifyState: {
          canonical: null,
          canonicalAt: null,
          lastAttempt: { state: "crawl_failed", at: "2026-07-08T00:00:00.000Z" },
          attempts: MAX_VERIFY_ATTEMPTS,
          nextRetryAt: null,
          exhausted: true,
        },
      }) as unknown as Record<string, unknown>,
    ];
    await resetVerifyRetryById("tenant-a", "row-1");
    const env = normalizeVerifyEnvelope(
      (fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord).verifyState,
    )!;
    expect(env.attempts).toBe(0);
    expect(env.exhausted).toBe(false);
    expect(env.nextRetryAt).toBeNull();
  });

  it("file path: leaves a latched canonical success completely alone", async () => {
    supabaseThrows = true;
    fileRows = [
      baseRecord({ id: "row-1", verifiedLive: true, verifyState: successEnvelope }) as unknown as Record<string, unknown>,
    ];
    await resetVerifyRetryById("tenant-a", "row-1");
    const rec = fileRows.find((r) => r.id === "row-1")! as unknown as ShippedChangeRecord;
    expect(canonicalOutcome(rec.verifyState)).toBe("verified_live");
    expect(rec.verifiedLive).toBe(true);
  });

  it("supabase path: writes a fresh envelope under the canonical-is-null CAS guard", async () => {
    await resetVerifyRetryById("tenant-a", "row-1");
    const up = updateChains()[0]!;
    const env = up.payload!.verify_state as VerifyEnvelope;
    expect(env.attempts).toBe(0);
    expect(env.exhausted).toBe(false);
    expect(env.canonical).toBeNull();
    expect(up.eqCalls).toEqual([["tenant_id", "tenant-a"], ["id", "row-1"]]);
    expect(up.filterCalls).toEqual([["verify_state->>canonical", "is", null]]);
  });
});
