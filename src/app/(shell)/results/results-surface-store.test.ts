/**
 * Empty-rebuild guard on the /results SWR surface (R4, 2026-07-03) - replicates the
 * worklist-surface-store 2026-07-02 guard on this store: during a data outage the
 * fail-soft loadProofLedger can "successfully" build an empty ledger; persisting it
 * over a real snapshot would make /results render "no changes yet" (a lie) until the
 * next healthy rebuild. writeResultsSurface must never let an empty rebuild replace
 * a non-empty snapshot; explicit resets use invalidateResultsSurface.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readStoreMock = vi.fn(async (..._args: unknown[]): Promise<unknown> => []);
const writeStoreMock = vi.fn(async (..._args: unknown[]): Promise<void> => {});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: (...args: unknown[]) => readStoreMock(...args),
  writeStore: (...args: unknown[]) => writeStoreMock(...args),
}));

import {
  writeResultsSurface,
  invalidateResultsSurface,
  isResultsSurfaceStale,
  RESULTS_SURFACE_FRESH_MS,
} from "./results-surface-store";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

function ledgerOf(count: number): ShippedChangeRecord[] {
  return Array.from(
    { length: count },
    (_, i) => ({ id: `rec-${i}`, path: `/p${i}` }) as unknown as ShippedChangeRecord,
  );
}

beforeEach(() => {
  readStoreMock.mockReset();
  writeStoreMock.mockClear();
});

describe("writeResultsSurface empty-rebuild guard", () => {
  it("refuses to overwrite a non-empty snapshot with an empty rebuild", async () => {
    readStoreMock.mockResolvedValue([
      { computedAt: "2026-07-03T00:00:00.000Z", ledger: ledgerOf(12) },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeResultsSurface([], "2026-07-03T05:00:00.000Z");
    expect(writeStoreMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain("refusing to overwrite");
    warn.mockRestore();
  });

  it("allows an empty write when no snapshot exists (true cold start)", async () => {
    readStoreMock.mockResolvedValue([]);
    await writeResultsSurface([], "2026-07-03T05:00:00.000Z");
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });

  it("allows an empty write over an already-empty snapshot", async () => {
    readStoreMock.mockResolvedValue([
      { computedAt: "2026-07-03T00:00:00.000Z", ledger: [] },
    ]);
    await writeResultsSurface([], "2026-07-03T05:00:00.000Z");
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });

  it("always persists a non-empty rebuild without reading the old snapshot", async () => {
    await writeResultsSurface(ledgerOf(7), "2026-07-03T05:00:00.000Z");
    expect(readStoreMock).not.toHaveBeenCalled();
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [, rows] = writeStoreMock.mock.calls[0] as unknown as [
      string,
      Array<{ ledger: ShippedChangeRecord[] }>,
    ];
    expect(rows[0].ledger).toHaveLength(7);
  });

  it("invalidateResultsSurface stays the explicit reset path (writes empty rows)", async () => {
    await invalidateResultsSurface();
    expect(writeStoreMock).toHaveBeenCalledWith("results-surface", []);
  });
});

describe("isResultsSurfaceStale", () => {
  const NOW = Date.parse("2026-07-03T12:00:00.000Z");

  it("is fresh within the TTL and stale past it", () => {
    const freshAt = new Date(NOW - RESULTS_SURFACE_FRESH_MS + 60_000).toISOString();
    const staleAt = new Date(NOW - RESULTS_SURFACE_FRESH_MS - 60_000).toISOString();
    expect(isResultsSurfaceStale(freshAt, NOW)).toBe(false);
    expect(isResultsSurfaceStale(staleAt, NOW)).toBe(true);
  });

  it("treats an unparseable timestamp as stale", () => {
    expect(isResultsSurfaceStale("not-a-date", NOW)).toBe(true);
  });
});
