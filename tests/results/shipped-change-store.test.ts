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
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// Codex P2 (2026-07-09): a real temp `.data` root so the tenant-EXPLICIT file
// fallback (readShippedChangesFileForTenant) can be exercised through real
// readFileSync/existsSync - the founder-leak this fix closes is a FILE-path
// routing bug, so it must be tested against real files, not the readStore mock.
const fsFix = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const fsMod = require("node:fs") as typeof import("node:fs");
  const pathMod = require("node:path") as typeof import("node:path");
  const root = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), "shipped-store-tenant-"));
  return { root };
});

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// getDataDir routes an EXPLICIT slug to the temp tenants dir; a null slug (the
// ambient/founder flat path) routes to the temp root, which we NEVER seed - so a
// founder-fallback read would surface as [] (leak-free) in these tests.
vi.mock("@/lib/tenant", () => ({
  getDataDir: (slug?: string | null) => {
    const pathMod = require("node:path") as typeof import("node:path");
    return slug ? pathMod.join(fsFix.root, "tenants", String(slug)) : fsFix.root;
  },
}));

// Registry: tenant-a -> site-a, tenant-b -> site-b; anything else is unresolved
// (null), so the explicit file read must fail closed to [].
vi.mock("@/domains/tenants/store", () => ({
  getTenant: async (id: string) => {
    const map: Record<string, string> = { "tenant-a": "site-a", "tenant-b": "site-b" };
    return map[id] ? { id, slug: map[id] } : null;
  },
}));

vi.mock("@/app/(shell)/results/results-surface-store", () => ({
  invalidateResultsSurface: vi.fn(async () => {}),
}));

// W2-B (2026-07-10): the ledger-mutation choke point now ALSO age-stamps the core
// Today/Changes surface caches (invalidateResultsSurfaceSafe calls both, best-effort).
// Mock it like the results surface above so its real store writes can never clobber
// this test's single captured fileRows array.
vi.mock("@/app/(shell)/surface-release", () => ({
  invalidateCoreSurfaces: vi.fn(async () => {}),
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
} from "@/domains/proof-gsc/shipped-change-store";

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
    operatorVerdictOverride: null, calibrationVersion: null,
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

/** Write a real per-tenant ledger file at the temp root's `.data/tenants/{slug}/`. */
function seedTenantLedgerFile(slug: string, records: ShippedChangeRecord[]): void {
  const dir = join(fsFix.root, "tenants", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "proof-gsc-ledger.json"), JSON.stringify(records));
}

beforeEach(() => {
  chains = [];
  supabaseThrows = false;
  readData = null;
  readError = null;
  mutError = null;
  updateReturnData = [];
  fileRows = [];
  rmSync(join(fsFix.root, "tenants"), { recursive: true, force: true });
});

afterAll(() => {
  rmSync(fsFix.root, { recursive: true, force: true });
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

});

describe("loadShippedChangesForTenant - tenant-EXPLICIT file fallback (Codex P2, fail closed)", () => {
  it("no-env branch: reads tenant A's OWN file, never the ambient (founder) readStore rows", async () => {
    supabaseThrows = true; // getSupabaseAdmin throws -> file fallback
    // Ambient readStore mock holds tenant B's data - the founder-leak this test guards.
    fileRows = [baseRecord({ id: "ambient-b", path: "/tenant-b-secret" }) as unknown as Record<string, unknown>];
    // Tenant A's OWN durable file on disk:
    seedTenantLedgerFile("site-a", [baseRecord({ id: "a-1", path: "/tenant-a-page" })]);

    const out = await loadShippedChangesForTenant("tenant-a");
    expect(out.map((r) => r.id)).toEqual(["a-1"]);
    // The ambient tenant-B row is NEVER returned for an explicit tenant-a read.
    expect(out.some((r) => r.id === "ambient-b")).toBe(false);
  });

  it("cross-tenant isolation: tenant B's explicit read returns tenant B's file, never tenant A's", async () => {
    supabaseThrows = true;
    seedTenantLedgerFile("site-a", [baseRecord({ id: "a-1", path: "/a" })]);
    seedTenantLedgerFile("site-b", [baseRecord({ id: "b-1", path: "/b" })]);

    const outA = await loadShippedChangesForTenant("tenant-a");
    const outB = await loadShippedChangesForTenant("tenant-b");
    expect(outA.map((r) => r.id)).toEqual(["a-1"]);
    expect(outB.map((r) => r.id)).toEqual(["b-1"]);
  });

  it("fails CLOSED to [] on an unresolved tenant (not in registry, no env match) - never the flat founder file", async () => {
    supabaseThrows = true;
    // Ambient readStore still holds rows; an unresolved tenant must NOT get them.
    fileRows = [baseRecord({ id: "ambient-b" }) as unknown as Record<string, unknown>];
    const out = await loadShippedChangesForTenant("tenant-unknown");
    expect(out).toEqual([]);
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

});

describe("row mapping: operator_verdict_override and predeclaration round-trips (folded)", () => {
function makeRecord(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "cities-2026-06-20",
    page: "https://iranopedia.com/cities",
    path: "/cities",
    actionType: "edit_title",
    before: "Cities",
    after: "List of cities in Iran",
    shippedAt: "2026-06-20T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 1000, ctr: 0.01, position: 9, windowDays: 28 },
    targetQueries: ["cities in iran"],
    controlPages: ["https://iranopedia.com/provinces"],
    windows: [],
    verdict: "won",
    confidence: "medium",
    measuredAt: "2026-06-27T00:00:00.000Z",
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    ...over,
  };
}

describe("shipped-change-store row mapping — operator_verdict_override round-trip (audit-9)", () => {
  it("emits operator_verdict_override as a PRESENT key even when null (re-include must clear it)", () => {
    const row = recordToRow("tenant-iranopedia", makeRecord({ operatorVerdictOverride: null }));
    // The KEY must be present (not omitted) so a Supabase upsert SETs it to null
    // — omitting it would leave a previously-excluded row stuck at "inconclusive".
    expect("operator_verdict_override" in row).toBe(true);
    expect(row.operator_verdict_override).toBeNull();
  });

  it("round-trips both the excluded and the re-included states", () => {
    const excluded = rowToRecord(
      recordToRow("t", makeRecord({ operatorVerdictOverride: "inconclusive" })),
    );
    expect(excluded.operatorVerdictOverride).toBe("inconclusive");

    const reincluded = rowToRecord(
      recordToRow("t", makeRecord({ operatorVerdictOverride: null })),
    );
    expect(reincluded.operatorVerdictOverride).toBeNull();
  });

  it("treats a missing/legacy column (pre-migration row) as no override", () => {
    const row = recordToRow("t", makeRecord({ operatorVerdictOverride: "inconclusive" }));
    // Simulate a pre-migration read where the column doesn't exist on the row.
    const legacy = { ...row };
    delete (legacy as { operator_verdict_override?: unknown }).operator_verdict_override;
    expect(rowToRecord(legacy).operatorVerdictOverride).toBeNull();
  });
});

describe("shipped-change-store row mapping - predeclaration contract round-trip (Lane P2, protocol 4.1)", () => {
  const predeclared: Partial<ShippedChangeRecord> = {
    judgedMetric: "ctr",
    expectedDirection: 1,
    primaryWindowDays: 28,
    windowPlan: [
      { day: 7, role: "context" },
      { day: 14, role: "context" },
      { day: 28, role: "primary" },
      { day: 56, role: "demote_only" },
      { day: 84, role: "context" },
    ],
    controlSetIds: { urls: ["https://iranopedia.com/a", "https://iranopedia.com/b"], hash: "abc123" },
    controlAlternates: ["https://iranopedia.com/c", "https://iranopedia.com/d"],
    classifierVersionPredeclared: "c4-frozen@deadbeef",
    baselineSnapshot: {
      clicks: 10,
      impressions: 1000,
      ctr: 0.01,
      position: 9,
      windowDays: 28,
      trafficTier: "medium",
    },
    predeclaredAt: "2026-06-20T00:00:00.000Z",
  };

  it("round-trips every predeclaration field losslessly", () => {
    const back = rowToRecord(recordToRow("t", makeRecord(predeclared)));
    expect(back.judgedMetric).toBe("ctr");
    expect(back.expectedDirection).toBe(1);
    expect(back.primaryWindowDays).toBe(28);
    expect(back.windowPlan).toEqual(predeclared.windowPlan);
    expect(back.controlSetIds).toEqual(predeclared.controlSetIds);
    expect(back.controlAlternates).toEqual(predeclared.controlAlternates);
    expect(back.classifierVersionPredeclared).toBe("c4-frozen@deadbeef");
    expect(back.baselineSnapshot).toEqual({
      ...predeclared.baselineSnapshot,
      dailyVariance: null,
      trendSlope: null,
      pageFamily: null,
    });
    expect(back.predeclaredAt).toBe("2026-06-20T00:00:00.000Z");
  });

  it("emits every predeclaration column UNCONDITIONALLY, even when unset (null)", () => {
    const row = recordToRow("t", makeRecord()); // no predeclaration overrides
    for (const key of [
      "judged_metric",
      "expected_direction",
      "primary_window_days",
      "window_plan",
      "control_set_ids",
      "control_alternates",
      "classifier_version_predeclared",
      "baseline_snapshot",
      "predeclared_at",
    ] as const) {
      expect(key in row).toBe(true);
      expect((row as Record<string, unknown>)[key]).toBeNull();
    }
  });

  it("coerces malformed persisted values to null (never a fabricated metric/direction)", () => {
    const row = recordToRow("t", makeRecord(predeclared)) as Record<string, unknown>;
    row.judged_metric = "impressions"; // not a valid ProofMetric
    row.expected_direction = 0; // not +1/-1
    row.window_plan = [{ day: 28, role: "not_a_role" }]; // bad role
    row.control_set_ids = { urls: "nope" }; // urls not an array, no hash
    row.baseline_snapshot = { clicks: 10 }; // missing required fields
    const back = rowToRecord(row as unknown as Parameters<typeof rowToRecord>[0]);
    expect(back.judgedMetric).toBeNull();
    expect(back.expectedDirection).toBeNull();
    expect(back.windowPlan).toBeNull();
    expect(back.controlSetIds).toBeNull();
    expect(back.baselineSnapshot).toBeNull();
  });
});
});
