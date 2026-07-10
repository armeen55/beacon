/**
 * Empty-rebuild guard + staleness on the /changes SWR surface (W2-B, 2026-07-10).
 * Same discipline as worklist-surface-store: a degraded (empty) rebuild during a
 * data outage must never overwrite a real snapshot; explicit resets use
 * invalidateChangesSurface.
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
  writeChangesSurface,
  invalidateChangesSurface,
  isChangesSurfaceStale,
  CHANGES_SURFACE_FRESH_MS,
} from "./changes-surface-store";
import type { ChangesView } from "./changes-data";

function view(changeCount: number): ChangesView {
  return {
    changes: Array.from({ length: changeCount }, (_, i) => ({ id: `c${i}` })),
    movesById: {},
    summary: { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 0,
    decidedCountCanonical: 0,
    suppressedRowsNote: null,
    expiredSubline: null,
    receiptLine: null,
    readyCount: 0,
    shippedThisWeekCount: 0,
    watching: [],
  } as unknown as ChangesView;
}

beforeEach(() => {
  readStoreMock.mockReset();
  writeStoreMock.mockClear();
});

describe("writeChangesSurface empty-rebuild guard", () => {
  it("refuses to overwrite a non-empty snapshot with an empty rebuild", async () => {
    readStoreMock.mockResolvedValue([{ computedAt: "2026-07-10T00:00:00.000Z", view: view(30) }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeChangesSurface(view(0), "2026-07-10T05:00:00.000Z");
    expect(writeStoreMock).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain("refusing to overwrite");
    warn.mockRestore();
  });

  it("allows an empty write on a true cold start (no snapshot)", async () => {
    readStoreMock.mockResolvedValue([]);
    await writeChangesSurface(view(0), "2026-07-10T05:00:00.000Z");
    expect(writeStoreMock).toHaveBeenCalledOnce();
  });

  it("always persists a non-empty rebuild without reading the old snapshot", async () => {
    await writeChangesSurface(view(9), "2026-07-10T05:00:00.000Z");
    expect(readStoreMock).not.toHaveBeenCalled();
    expect(writeStoreMock).toHaveBeenCalledOnce();
    const [store, rows] = writeStoreMock.mock.calls[0] as unknown as [string, Array<{ view: ChangesView }>];
    expect(store).toBe("changes-surface");
    expect(rows[0].view.changes).toHaveLength(9);
  });

  it("invalidateChangesSurface writes empty rows (explicit reset path)", async () => {
    await invalidateChangesSurface();
    expect(writeStoreMock).toHaveBeenCalledWith("changes-surface", []);
  });
});

describe("isChangesSurfaceStale", () => {
  const NOW = Date.parse("2026-07-10T12:00:00.000Z");
  it("fresh within the TTL", () => {
    expect(isChangesSurfaceStale(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
  });
  it("stale past the TTL", () => {
    expect(isChangesSurfaceStale(new Date(NOW - CHANGES_SURFACE_FRESH_MS - 60_000).toISOString(), NOW)).toBe(true);
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(isChangesSurfaceStale("garbage", NOW)).toBe(true);
  });
});
