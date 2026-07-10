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

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));
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

import { ledgerCheckedAgoLine, loadLedgerWithSwr } from "./results-ledger-data";
import { RESULTS_SURFACE_FRESH_MS } from "./results-surface-store";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const rec = (id: string, measuredAt?: string): ShippedChangeRecord =>
  ({ id, path: `/${id}`, measuredAt: measuredAt ?? null }) as unknown as ShippedChangeRecord;

beforeEach(() => {
  readStoreMock.mockReset();
  readStoreMock.mockResolvedValue([]);
  writeStoreMock.mockClear();
  afterMock.mockClear();
  loadProofLedgerMock.mockReset();
  loadProofLedgerMock.mockResolvedValue([rec("fresh-1"), rec("fresh-2")]);
  loadProofLedgerPersistedMock.mockReset();
  loadProofLedgerPersistedMock.mockResolvedValue([rec("persisted-1"), rec("persisted-2")]);
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

  it("a background refresh failure is swallowed (the next visit retries)", async () => {
    const computedAt = new Date(Date.now() - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    readStoreMock.mockResolvedValue([{ computedAt, ledger: [rec("snap-old")] }]);
    loadProofLedgerMock.mockRejectedValue(new Error("GSC wedged"));

    await loadLedgerWithSwr("tenant-test");
    const refresh = afterMock.mock.calls[0][0] as () => Promise<void>;
    await expect(refresh()).resolves.toBeUndefined();
    expect(writeStoreMock).not.toHaveBeenCalled(); // build-then-write: no write on failure
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
});
