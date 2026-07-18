/**
 * error-spike tests (BEACON_500 R7 / N39, 2026-07-03).
 *
 * Pins the Today line's honesty contract in BOTH states:
 *   - self-hiding (null) below ERROR_SPIKE_MIN_COUNT failures in 24h,
 *     including when older failures would otherwise push it over;
 *   - one plain sentence at/above the threshold, with the "mostly on"
 *     clause only for a strict-majority route that has a plain-English
 *     subject (raw route keys never reach Today).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let ledgerRows: unknown[] = [];
let ledgerThrows = false;

vi.mock("@/lib/obs/error-ledger", () => ({
  listAppErrorsForTenant: async () => {
    if (ledgerThrows) throw new Error("ledger read exploded");
    return ledgerRows;
  },
}));

import {
  buildErrorSpikeLine,
  loadErrorSpikeLine,
  ERROR_SPIKE_MIN_COUNT,
} from "./error-spike";
import type { AppErrorRow } from "@/lib/obs/error-ledger";

const NOW = new Date("2026-07-03T12:00:00.000Z");

function errAt(hoursAgo: number, route = "cron/sync-connectors"): AppErrorRow {
  return {
    id: `e-${Math.random().toString(36).slice(2)}`,
    at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
    tenantId: "tenant-a",
    route,
    action: "trend-radar",
    message: "boom",
    stack: null,
    context: {},
  };
}

beforeEach(() => {
  ledgerRows = [];
  ledgerThrows = false;
});

describe("buildErrorSpikeLine (pure, both states)", () => {
  it("SELF-HIDES: 9 failures in 24h stays quiet (below the threshold of 10)", () => {
    const rows = Array.from({ length: ERROR_SPIKE_MIN_COUNT - 1 }, (_, i) => errAt(i * 0.5));
    expect(buildErrorSpikeLine(rows, NOW)).toBeNull();
  });

  it("SELF-HIDES: old failures outside the 24h window never count", () => {
    // 20 failures, but all 30+ hours old.
    const rows = Array.from({ length: 20 }, (_, i) => errAt(30 + i));
    expect(buildErrorSpikeLine(rows, NOW)).toBeNull();
  });

  it("FIRES: 14 recent failures, mostly on the nightly sync, composes the exact sentence", () => {
    const rows = [
      ...Array.from({ length: 11 }, (_, i) => errAt(i, "cron/sync-connectors")),
      ...Array.from({ length: 3 }, (_, i) => errAt(i, "/changes")),
    ];
    expect(buildErrorSpikeLine(rows, NOW)).toBe(
      "Something failed 14 times since yesterday, mostly on the connected-source refresh. Details are on the Diagnostics page.",
    );
  });

  it("drops the 'mostly' clause when no route holds a strict majority", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => errAt(i, "cron/sync-connectors")),
      ...Array.from({ length: 5 }, (_, i) => errAt(i, "/changes")),
      ...Array.from({ length: 2 }, (_, i) => errAt(i, "/results")),
    ];
    expect(buildErrorSpikeLine(rows, NOW)).toBe(
      "Something failed 12 times since yesterday. Details are on the Diagnostics page.",
    );
  });

  it("never leaks a raw route key: an unmapped majority route drops the clause too", () => {
    const rows = Array.from({ length: 12 }, (_, i) => errAt(i, "cron/some-new-job"));
    const line = buildErrorSpikeLine(rows, NOW);
    expect(line).toBe(
      "Something failed 12 times since yesterday. Details are on the Diagnostics page.",
    );
    expect(line).not.toContain("some-new-job");
  });

  it("Beacon voice: no em or en dashes in the sentence", () => {
    const rows = Array.from({ length: 12 }, (_, i) => errAt(i));
    expect(buildErrorSpikeLine(rows, NOW)).not.toMatch(/[‒–—―]/);
  });
});

describe("loadErrorSpikeLine (fail-soft loader)", () => {
  it("answers the sentence when the ledger holds a spike", async () => {
    ledgerRows = Array.from({ length: 12 }, (_, i) => errAt(i));
    const line = await loadErrorSpikeLine("tenant-a", NOW);
    expect(line).toContain("Something failed 12 times since yesterday");
  });

  it("answers null when quiet", async () => {
    ledgerRows = [errAt(1)];
    expect(await loadErrorSpikeLine("tenant-a", NOW)).toBeNull();
  });

  it("fail-soft: a ledger explosion answers null, never throws", async () => {
    ledgerThrows = true;
    expect(await loadErrorSpikeLine("tenant-a", NOW)).toBeNull();
  });
});
