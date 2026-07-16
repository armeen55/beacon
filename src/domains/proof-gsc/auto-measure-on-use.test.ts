import { beforeEach, describe, it, expect, vi } from "vitest";

const { afterMock } = vi.hoisted(() => ({ afterMock: vi.fn() }));
vi.mock("next/server", () => ({ after: afterMock }));

import { scheduleAutoMeasure, selectRowsToReverify } from "./auto-measure-on-use";
import type { ShippedChangeRecord, VerifyEnvelope, VerifyAttempt } from "./shipped-change-store";

// scheduleAutoMeasure schedules via next/after, which is only valid inside a request
// scope. Outside one (here), it must NO-OP without throwing — the render path can never
// be broken by the passive trigger. (The real measurement is covered by the
// auto-measure-pass / measure-lifecycle suites.)
describe("scheduleAutoMeasure — fail-soft render contract", () => {
  beforeEach(() => {
    afterMock.mockReset();
    afterMock.mockImplementation(() => undefined);
  });

  it("no-ops on empty tenantId", () => {
    expect(() => scheduleAutoMeasure("")).not.toThrow();
    expect(afterMock).not.toHaveBeenCalled();
  });
  it("a failed after registration never throws or poisons the next attempt", () => {
    afterMock.mockImplementationOnce(() => {
      throw new Error("outside request scope");
    });
    expect(() => scheduleAutoMeasure("tenant-registration-retry")).not.toThrow();
    expect(() => scheduleAutoMeasure("tenant-registration-retry")).not.toThrow();
    expect(afterMock).toHaveBeenCalledTimes(2);
  });
  it("throttles a rapid second call without throwing", () => {
    expect(() => {
      scheduleAutoMeasure("tenant-throttle-test");
      scheduleAutoMeasure("tenant-throttle-test");
    }).not.toThrow();
    expect(afterMock).toHaveBeenCalledTimes(1);
  });
});

// ── W5 stop-ship F6: which rows a passive pass re-verifies (retry fairness) ───
const NOW = "2026-07-09T12:00:00.000Z";

function succ(outcome: "verified_live" | "verified_live_modified"): VerifyEnvelope {
  return {
    canonical: { outcome, kind: outcome === "verified_live" ? "exact" : null },
    canonicalAt: NOW,
    lastAttempt: null,
    attempts: 0,
    nextRetryAt: null,
    exhausted: false,
  };
}
function fail(
  state: VerifyAttempt["state"],
  at: string,
  opts: { nextRetryAt?: string | null; attempts?: number; exhausted?: boolean } = {},
): VerifyEnvelope {
  return {
    canonical: null,
    canonicalAt: null,
    lastAttempt: { state, at },
    attempts: opts.attempts ?? 1,
    nextRetryAt: opts.nextRetryAt ?? null,
    exhausted: opts.exhausted ?? false,
  };
}
function row(
  id: string,
  verifyState: VerifyEnvelope | null,
  over: Partial<ShippedChangeRecord> = {},
): ShippedChangeRecord {
  return {
    id,
    page: "https://site.com/p",
    after: "some proposed text",
    verifyState,
    ...over,
  } as unknown as ShippedChangeRecord;
}

describe("selectRowsToReverify (F6)", () => {
  it("selects rows never verified, prior crawl_failed / not_found, AND unresolved needs_review", () => {
    const rows = [
      row("never", null),
      row("crawl", fail("crawl_failed", "2026-07-08T00:00:00.000Z")),
      row("nf", fail("not_found", "2026-07-08T01:00:00.000Z")),
      row("review", fail("needs_review", "2026-07-08T02:00:00.000Z")),
    ];
    const ids = selectRowsToReverify(rows, 5, NOW).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["never", "crawl", "nf", "review"]));
    expect(ids).toHaveLength(4);
  });

  it("skips latched canonical successes (verified_live / verified_live_modified)", () => {
    const rows = [row("live", succ("verified_live")), row("livemod", succ("verified_live_modified"))];
    expect(selectRowsToReverify(rows, 5, NOW)).toEqual([]);
  });

  it("skips exhausted rows (permanently off the retry list)", () => {
    const rows = [
      row("done", fail("crawl_failed", "2026-07-01T00:00:00.000Z", { attempts: 5, exhausted: true })),
    ];
    expect(selectRowsToReverify(rows, 5, NOW)).toEqual([]);
  });

  it("respects the retry cooldown: a future nextRetryAt is skipped, a past one is selected", () => {
    const rows = [
      row("cooling", fail("crawl_failed", "2026-07-09T06:00:00.000Z", { nextRetryAt: "2026-07-10T00:00:00.000Z" })),
      row("ready", fail("crawl_failed", "2026-07-09T00:00:00.000Z", { nextRetryAt: "2026-07-09T06:00:00.000Z" })),
    ];
    expect(selectRowsToReverify(rows, 5, NOW).map((r) => r.id)).toEqual(["ready"]);
  });

  it("sorts oldest attempt first; a never-attempted row sorts before any attempted one", () => {
    const rows = [
      row("b", fail("crawl_failed", "2026-07-08T00:00:00.000Z")),
      row("a", null), // never attempted -> lastAttempt "" sorts first
      row("c", fail("not_found", "2026-07-07T00:00:00.000Z")),
    ];
    expect(selectRowsToReverify(rows, 5, NOW).map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  it("skips rows with no page or no proposal (nothing to crawl-verify against)", () => {
    const rows = [
      row("nopage", null, { page: "" }),
      row("noafter", null, { after: "  " }),
      row("ok", null),
    ];
    expect(selectRowsToReverify(rows, 5, NOW).map((r) => r.id)).toEqual(["ok"]);
  });

  it("caps the batch at the requested max (after the oldest-first sort)", () => {
    const rows = [row("a", null), row("b", null), row("c", null)];
    expect(selectRowsToReverify(rows, 2, NOW)).toHaveLength(2);
  });
});
