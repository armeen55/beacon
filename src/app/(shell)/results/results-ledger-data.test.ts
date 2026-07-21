/**
 * SWR flow pins for the /results measured-ledger snapshot (R4, 2026-07-03) - the
 * exact loadSurfaceWithSwr posture proven on /changes (moves-data.ts):
 *   - a persisted snapshot serves INSTANTLY (no synchronous re-measure);
 *   - a STALE snapshot still serves instantly and schedules ONE background
 *     refresh via next/server after();
 *   - only a true cold start (no snapshot / just invalidated) pays the full
 *     synchronous re-measure, then persists it for next time.
 * Plus the honest "I last re-checked N ago" line (Beacon voice, no dashes).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
const writeStoreMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});
const afterMock = vi.fn((_cb: () => Promise<void>) => {});
const loadProofLedgerMock = vi.fn(async (_tenantId: string): Promise<unknown[]> => []);
const loadProofLedgerPersistedMock = vi.fn(async (_tenantId: string): Promise<unknown[]> => []);
// Contamination is precomputed at rebuild time (attachControlContaminationForLedger);
// mock only THAT heavy read - the pure serialize/deserialize/isContaminationFrozen
// helpers pass through to the real module so the round-trip stays honest.
const attachContaminationMock = vi.fn(async (..._args: unknown[]): Promise<Map<string, unknown>> => new Map());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));
vi.mock("@/domains/proof-gsc/attach-control-contamination", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/domains/proof-gsc/attach-control-contamination")>();
  return {
    ...actual,
    attachControlContaminationForLedger: (...args: unknown[]) => attachContaminationMock(...args),
  };
});
vi.mock("next/server", () => ({
  after: (cb: () => Promise<void>) => afterMock(cb),
}));
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-test",
}));
vi.mock("@/domains/proof-gsc/load-ledger", () => ({
  loadProofLedger: (tenantId: string) => loadProofLedgerMock(tenantId),
  loadProofLedgerPersisted: (tenantId: string) => loadProofLedgerPersistedMock(tenantId),
}));

import { ledgerCheckedAgoLine, loadLedgerWithSwr, rebuildResultsSurface } from "./results-ledger-data";
import { RESULTS_SURFACE_FRESH_MS, type ResultsSurfaceRow } from "./results-surface-store";
import {
  serializeContaminationAttachment,
  type ContaminationAttachment,
} from "@/domains/proof-gsc/attach-control-contamination";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const rec = (id: string, measuredAt?: string): ShippedChangeRecord =>
  ({ id, path: `/${id}`, measuredAt: measuredAt ?? null }) as unknown as ShippedChangeRecord;

/** A record whose stored windows drive isContaminationFrozen (basisDayOf === 28). */
const recWithWindows = (id: string, windows: Array<{ day: number; ran: boolean }>): ShippedChangeRecord =>
  ({ id, path: `/${id}`, measuredAt: null, windows }) as unknown as ShippedChangeRecord;

/** A minimal, valid ContaminationAttachment for the mock/round-trip fixtures. */
const fakeAttachment = (): ContaminationAttachment => ({
  verdict: { results: [], contaminated: [], hasContamination: false },
  substitutesByOriginal: new Map(),
  effectiveControlPages: [],
  notes: [],
  poolHealth: { cleanControls: 0, knownDirtyControls: 0, totalControls: 0, spareDonors: 0, lastCleanDonorPaths: [], sentence: "" },
  poolHealthLine: null,
  medianBand: null,
});

beforeEach(() => {
  readStoreMock.mockReset();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
  afterMock.mockClear();
  loadProofLedgerMock.mockReset();
  loadProofLedgerMock.mockResolvedValue([rec("fresh-1"), rec("fresh-2")]);
  loadProofLedgerPersistedMock.mockReset();
  loadProofLedgerPersistedMock.mockResolvedValue([rec("persisted-1"), rec("persisted-2")]);
  attachContaminationMock.mockReset();
  attachContaminationMock.mockResolvedValue(new Map());
});

describe("loadLedgerWithSwr", () => {
  it("serves a FRESH snapshot instantly: no re-measure, no background refresh", async () => {
    const computedAt = new Date(Date.now() - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-1")] }]);

    const out = await loadLedgerWithSwr("tenant-test");

    expect(out.ledger.map((r) => r.id)).toEqual(["snap-1"]);
    expect(out.computedAt).toBe(computedAt);
    expect(loadProofLedgerMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
    expect(writeStoreMock).not.toHaveBeenCalled();
  });

  it("serves a STALE snapshot instantly and refreshes in the background via after()", async () => {
    const computedAt = new Date(Date.now() - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-old")] }]);

    const out = await loadLedgerWithSwr("tenant-test");

    // Instant serve of the stale snapshot with its honest timestamp...
    expect(out.ledger.map((r) => r.id)).toEqual(["snap-old"]);
    expect(out.computedAt).toBe(computedAt);
    expect(loadProofLedgerMock).not.toHaveBeenCalled(); // nothing synchronous
    // ...and exactly one scheduled background refresh.
    expect(afterMock).toHaveBeenCalledOnce();
    const refresh = afterMock.mock.calls[0][0] as () => Promise<void>;
    await refresh();
    expect(loadProofLedgerMock).toHaveBeenCalledWith("tenant-test");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, rows] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ ledger: ShippedChangeRecord[] }>,
    ];
    expect(store).toBe("results-surface");
    expect(rows[0].ledger.map((r) => r.id)).toEqual(["fresh-1", "fresh-2"]);
  });

  it("cold start (no snapshot): P0-B GET-guard serves the last PERSISTED verdicts instantly, NO synchronous re-measure, and schedules the heavy rebuild in the background", async () => {
    const out = await loadLedgerWithSwr("tenant-test");

    // GET-safe: the last persisted verdicts serve instantly...
    expect(loadProofLedgerPersistedMock).toHaveBeenCalledWith("tenant-test");
    expect(out.ledger.map((r) => r.id)).toEqual(["persisted-1", "persisted-2"]);
    // P2 (Wave 1 review, 2026-07-10): the default fixture's persisted rows carry
    // NO measuredAt, so the served computedAt must be null, never now() - the
    // freshness line must never claim a check that did not happen.
    expect(out.computedAt).toBeNull();
    // ...and the heavy full-ledger re-measure NEVER runs synchronously on the GET.
    expect(loadProofLedgerMock).not.toHaveBeenCalled();
    expect(writeStoreMock).not.toHaveBeenCalled();
    // Exactly one background rebuild is scheduled; running it does the heavy work.
    expect(afterMock).toHaveBeenCalledOnce();
    const rebuild = afterMock.mock.calls[0][0] as () => Promise<void>;
    await rebuild();
    expect(loadProofLedgerMock).toHaveBeenCalledWith("tenant-test");
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, rows] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ ledger: ShippedChangeRecord[] }>,
    ];
    expect(store).toBe("results-surface");
    expect(rows[0].ledger.map((r) => r.id)).toEqual(["fresh-1", "fresh-2"]);
  });

  it("cold start: the served computedAt reflects the freshest stored measuredAt (honest 'last re-checked' line)", async () => {
    const measuredAt = "2026-07-08T00:00:00.000Z";
    loadProofLedgerPersistedMock.mockResolvedValue([rec("p1", "2026-07-01T00:00:00.000Z"), rec("p2", measuredAt)]);
    const out = await loadLedgerWithSwr("tenant-test");
    expect(out.computedAt).toBe(measuredAt);
  });

  it("cold start, ledger non-empty but NO record ever measured: computedAt is null, never now() (P2, Wave 1 review, 2026-07-10)", async () => {
    loadProofLedgerPersistedMock.mockResolvedValue([rec("p1"), rec("p2")]);
    const out = await loadLedgerWithSwr("tenant-test");
    expect(out.computedAt).toBeNull();
    expect(ledgerCheckedAgoLine(out.computedAt, Date.now())).toBeNull();
  });

  it("a background refresh failure is swallowed (the next visit retries)", async () => {
    const computedAt = new Date(Date.now() - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-old")] }]);
    loadProofLedgerMock.mockRejectedValue(new Error("GSC wedged"));

    await loadLedgerWithSwr("tenant-test");
    const refresh = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(refresh()).resolves.toBeUndefined();
    expect(writeStoreMock).not.toHaveBeenCalled(); // build-then-write: no write on failure
  });

  it("TWO-TENANT (2026-07-10 hygiene batch, sibling fix): a stale rebuild re-measures + persists the EXACT tenant it was called for, no bleed", async () => {
    const computedAt = new Date(Date.now() - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-old")] }]);
    loadProofLedgerMock.mockImplementation(async (t: string) => [rec(`fresh-${t}`)]);

    await loadLedgerWithSwr("tenant-a");
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();
    afterMock.mockClear();
    await loadLedgerWithSwr("tenant-b");
    await (afterMock.mock.calls[0][0] as () => Promise<void>)();

    expect(loadProofLedgerMock).toHaveBeenCalledWith("tenant-a");
    expect(loadProofLedgerMock).toHaveBeenCalledWith("tenant-b");
    expect(writeStoreMock).toHaveBeenCalledTimes(2);
    const [, rowsA, optsA] = writeStoreMock.mock.calls[0] as unknown as [string, Array<{ ledger: ShippedChangeRecord[] }>, { tenantId?: string }];
    const [, rowsB, optsB] = writeStoreMock.mock.calls[1] as unknown as [string, Array<{ ledger: ShippedChangeRecord[] }>, { tenantId?: string }];
    expect(optsA.tenantId).toBe("tenant-a");
    expect(optsB.tenantId).toBe("tenant-b");
    expect(rowsA[0].ledger.map((r) => r.id)).toEqual(["fresh-tenant-a"]);
    expect(rowsB[0].ledger.map((r) => r.id)).toEqual(["fresh-tenant-b"]);
  });

  it("SINGLE-FLIGHT (W2-B): two concurrent stale readers trigger exactly ONE background re-measure", async () => {
    const computedAt = new Date(Date.now() - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-old")] }]);
    let resolveBuild!: (v: unknown[]) => void;
    loadProofLedgerMock.mockImplementation(
      () =>
        new Promise<unknown[]>((res) => {
          resolveBuild = res;
        }),
    );

    // Two concurrent GETs both observe the stale snapshot and schedule a rebuild.
    await loadLedgerWithSwr("tenant-test");
    await loadLedgerWithSwr("tenant-test");
    expect(afterMock).toHaveBeenCalledTimes(2);
    const cb1 = afterMock.mock.calls[0][0] as () => Promise<void>;
    const cb2 = afterMock.mock.calls[1][0] as () => Promise<void>;

    // Fire both scheduled rebuilds CONCURRENTLY: the single-flight lock collapses
    // them to one loadProofLedger run and one persisted write.
    const both = Promise.all([cb1(), cb2()]);
    expect(loadProofLedgerMock).toHaveBeenCalledTimes(1);
    resolveBuild([rec("fresh-1")]);
    await both;
    expect(loadProofLedgerMock).toHaveBeenCalledTimes(1);
    expect(writeStoreMock).toHaveBeenCalledTimes(1);
  });
});

describe("loadLedgerWithSwr - precomputed contamination cache (2026-07-21)", () => {
  it("OLD snapshot without contaminationByClosedRow -> closedContaminationById is empty (fallback to live compute)", async () => {
    const computedAt = new Date(Date.now() - 60_000).toISOString();
    // A snapshot written before the field existed: no contaminationByClosedRow key.
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-1")] }]);
    const out = await loadLedgerWithSwr("tenant-test");
    expect(out.closedContaminationById.size).toBe(0); // nothing to serve -> live compute on the GET
  });

  it("snapshot WITH contaminationByClosedRow deserializes into closedContaminationById (Map rehydrated)", async () => {
    const computedAt = new Date(Date.now() - 60_000).toISOString();
    const serialized = serializeContaminationAttachment(fakeAttachment());
    readStoreMock.mockResolvedValue([
      { computedAt, ledger: [rec("snap-1")], contaminationByClosedRow: { "snap-1": serialized } },
    ]);
    const out = await loadLedgerWithSwr("tenant-test");
    expect(out.closedContaminationById.has("snap-1")).toBe(true);
    expect(out.closedContaminationById.get("snap-1")!.substitutesByOriginal instanceof Map).toBe(true);
  });

  it("a malformed cached entry is skipped, never crashing the read (fail-soft per row)", async () => {
    const computedAt = new Date(Date.now() - 60_000).toISOString();
    readStoreMock.mockResolvedValue([
      { computedAt, ledger: [rec("snap-1")], contaminationByClosedRow: { "snap-1": null } },
    ]);
    const out = await loadLedgerWithSwr("tenant-test");
    // The malformed entry throws inside deserialize, is caught and skipped, and the
    // read still returns (that row simply computes live on the GET).
    expect(out.closedContaminationById.has("snap-1")).toBe(false);
    expect(out.ledger.map((r) => r.id)).toEqual(["snap-1"]);
  });
});

describe("rebuildResultsSurface - precomputes contamination for CLOSED (frozen) rows only", () => {
  it("stores frozen-row verdicts in the snapshot; OPEN rows are never cached", async () => {
    const frozen = recWithWindows("frozen-1", [{ day: 28, ran: true }]); // terminal -> frozen
    const open = recWithWindows("open-1", [{ day: 7, ran: true }]); // still growing -> open
    loadProofLedgerMock.mockResolvedValue([frozen, open]);
    attachContaminationMock.mockResolvedValue(
      new Map<string, unknown>([
        ["frozen-1", fakeAttachment()],
        ["open-1", fakeAttachment()],
      ]),
    );

    await rebuildResultsSurface("tenant-test");

    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, rows] = writeStoreMock.mock.calls[0] as unknown as [string, ResultsSurfaceRow[]];
    expect(store).toBe("results-surface");
    const stored = rows[0].contaminationByClosedRow ?? {};
    expect(Object.keys(stored)).toEqual(["frozen-1"]); // open-1 excluded from the cache
  });

  it("omits the field entirely when the ledger has no frozen rows (byte-identical to pre-field snapshot)", async () => {
    loadProofLedgerMock.mockResolvedValue([recWithWindows("open-only", [{ day: 14, ran: true }])]);
    attachContaminationMock.mockResolvedValue(new Map<string, unknown>([["open-only", fakeAttachment()]]));

    await rebuildResultsSurface("tenant-test");

    const [, rows] = writeStoreMock.mock.calls[0] as unknown as [string, ResultsSurfaceRow[]];
    expect(rows[0].contaminationByClosedRow).toBeUndefined();
  });

  it("a contamination-precompute failure never blocks the ledger snapshot (fail-soft)", async () => {
    loadProofLedgerMock.mockResolvedValue([recWithWindows("frozen-1", [{ day: 28, ran: true }])]);
    attachContaminationMock.mockRejectedValue(new Error("permutation-null wedged"));

    await expect(rebuildResultsSurface("tenant-test")).resolves.toBeUndefined();
    const [, rows] = writeStoreMock.mock.calls[0] as unknown as [string, ResultsSurfaceRow[]];
    expect(rows[0].ledger.map((r) => r.id)).toEqual(["frozen-1"]); // ledger still persisted
    expect(rows[0].contaminationByClosedRow).toBeUndefined(); // no cache, GET computes live
  });
});

describe("ledgerCheckedAgoLine", () => {
  const NOW = Date.parse("2026-07-03T12:00:00.000Z");

  it("reads 'just now' under a minute", () => {
    const line = ledgerCheckedAgoLine(new Date(NOW - 20_000).toISOString(), NOW);
    expect(line).toBe("I re-checked these numbers against your Google data just now.");
  });

  it("names minutes, then hours, then days", () => {
    expect(ledgerCheckedAgoLine(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toContain(
      "5 minutes ago",
    );
    expect(ledgerCheckedAgoLine(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toContain(
      "3 hours ago",
    );
    expect(ledgerCheckedAgoLine(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toContain(
      "3 days ago",
    );
  });

  it("singular forms read correctly", () => {
    expect(ledgerCheckedAgoLine(new Date(NOW - 60_000).toISOString(), NOW)).toContain(
      "1 minute ago",
    );
    expect(ledgerCheckedAgoLine(new Date(NOW - 3_600_000).toISOString(), NOW)).toContain(
      "1 hour ago",
    );
  });

  it("returns null on an unparseable timestamp and never emits a dash", () => {
    expect(ledgerCheckedAgoLine("garbage", NOW)).toBeNull();
    for (const ms of [20_000, 5 * 60_000, 3 * 3_600_000, 3 * 86_400_000]) {
      expect(ledgerCheckedAgoLine(new Date(NOW - ms).toISOString(), NOW)).not.toMatch(/[–—]/);
    }
  });

  it("returns null on a null computedAt (never measured) instead of claiming a check happened (P2, Wave 1 review)", () => {
    expect(ledgerCheckedAgoLine(null, NOW)).toBeNull();
  });
});
