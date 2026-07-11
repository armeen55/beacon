/**
 * lifecycle-counts (FP3, 2026-07-02) - pins for THE ONE-COUNT RULE: the single
 * classifier every surface's lifecycle counts come from. The killer findings these
 * protect: "three different counts for the same lifecycle stage", "the cross-link
 * promises 16 but lands on 25", and "'6 of 6 applied' yet the status strip says
 * Ready is 0 and Results is 0" (the tonight formula must match the checklist's).
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import {
  computeLifecycleCounts,
  countLedgerLifecycle,
  excludeRevertBookkeeping,
  isRevertLedgerRow,
  ledgerLifecycleStage,
  splitLedgerLifecycle,
  tonightCounts,
  type LedgerLifecycleRow,
  type TonightPlanLike,
} from "./lifecycle-counts";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

// Fail-closed calibration quarantine (2026-07-11): rows default to CALIBRATED so
// the existing bucket cases pin that a calibrated mature won/lost still lands in
// won/learned. The dedicated uncalibrated block pins the quarantine (a mature
// won/lost measured under the failed self-test lands in measuring, never won).
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

const NOW = new Date("2026-07-02T12:00:00Z");

type WindowFix = { day: number; ran: boolean; controlsUsed?: number };

function row(
  id: string,
  verdict: string,
  windows: WindowFix[],
  over: Partial<LedgerLifecycleRow> = {},
): LedgerLifecycleRow {
  return {
    id,
    path: `/${id}`,
    shippedAt: "2026-05-01T00:00:00.000Z",
    verdict,
    windows,
    baseline: { impressions: 1000 },
    calibrationVersion: TEST_CALIBRATED_VERSION,
    ...over,
  };
}

const OPEN_WINDOWS: WindowFix[] = [
  { day: 7, ran: false },
  { day: 14, ran: false },
  { day: 28, ran: false },
];
const MATURE_WINDOWS: WindowFix[] = [
  { day: 7, ran: true, controlsUsed: 3 },
  { day: 14, ran: true, controlsUsed: 3 },
  { day: 28, ran: true, controlsUsed: 3 },
];

describe("ledgerLifecycleStage - the decided vs measuring rule, reconciled once", () => {
  it("a row still collecting (verdict measuring, no window closed) is measuring", () => {
    expect(ledgerLifecycleStage(row("a", "measuring", OPEN_WINDOWS), null, NOW)).toBe("measuring");
  });

  it("an early 7-day 'won' read is NOT decided - it is still measuring (never celebrate an early read)", () => {
    const early = row("a", "won", [{ day: 7, ran: true, controlsUsed: 3 }, { day: 14, ran: false }, { day: 28, ran: false }]);
    expect(ledgerLifecycleStage(early, null, NOW)).toBe("measuring");
  });

  it("a mature, sufficient 'won' (28d closed, 2+ comparisons, 200+ baseline impressions) is won", () => {
    expect(ledgerLifecycleStage(row("a", "won", MATURE_WINDOWS), null, NOW)).toBe("won");
  });

  it("a mature, sufficient 'lost' is learned (decided, not a win)", () => {
    expect(ledgerLifecycleStage(row("a", "lost", MATURE_WINDOWS), null, NOW)).toBe("learned");
  });

  it("a 28-day window that closed too thin to call (inconclusive) stays measuring - same as Results' In flight band", () => {
    expect(ledgerLifecycleStage(row("a", "inconclusive", MATURE_WINDOWS), null, NOW)).toBe("measuring");
  });

  it("a 28-day 'won' without enough comparison pages is NOT decided", () => {
    const thin = row("a", "won", [{ day: 28, ran: true, controlsUsed: 1 }]);
    expect(ledgerLifecycleStage(thin, null, NOW)).toBe("measuring");
  });

  it("a 28-day 'won' with a too-small baseline is NOT decided", () => {
    const thin = row("a", "won", MATURE_WINDOWS, { baseline: { impressions: 50 } });
    expect(ledgerLifecycleStage(thin, null, NOW)).toBe("measuring");
  });

  it("an overlapping edit on the same page keeps even a mature-looking read in measuring (attribution limited)", () => {
    const overlapped = row("a", "won", MATURE_WINDOWS);
    expect(ledgerLifecycleStage(overlapped, { kind: "overlap", otherChangeCount: 1 }, NOW)).toBe("measuring");
  });
});

describe("splitLedgerLifecycle - the exact band membership Results renders", () => {
  it("detects same-page overlaps itself, so two mature wins on one page both read as measuring", () => {
    const a = row("a", "won", MATURE_WINDOWS, { path: "/same", shippedAt: "2026-05-01T00:00:00.000Z" });
    const b = row("b", "won", MATURE_WINDOWS, { path: "/same", shippedAt: "2026-05-04T00:00:00.000Z" });
    const split = splitLedgerLifecycle([a, b], NOW);
    expect(split.won).toHaveLength(0);
    expect(split.measuring).toHaveLength(2);
  });

  it("every row lands in exactly one band (counts always sum to the ledger)", () => {
    const rows = [
      row("w", "won", MATURE_WINDOWS),
      row("l", "lost", MATURE_WINDOWS),
      row("m", "measuring", OPEN_WINDOWS),
      row("i", "inconclusive", MATURE_WINDOWS),
    ];
    const split = splitLedgerLifecycle(rows, NOW);
    expect(split.won.length + split.learned.length + split.measuring.length).toBe(rows.length);
    expect(split.won.map((r) => r.id)).toEqual(["w"]);
    expect(split.learned.map((r) => r.id)).toEqual(["l"]);
    expect(split.measuring.map((r) => r.id).sort()).toEqual(["i", "m"]);
  });
});

describe("bug #14 - a revert is bookkeeping, not a second shipped change", () => {
  it("isRevertLedgerRow: only a revert_* actionType row is a revert (legacy/undefined is real)", () => {
    expect(isRevertLedgerRow({ actionType: "revert_edit_title" })).toBe(true);
    expect(isRevertLedgerRow({ actionType: "edit_title" })).toBe(false);
    expect(isRevertLedgerRow({ actionType: null })).toBe(false);
    expect(isRevertLedgerRow({ actionType: undefined })).toBe(false);
  });

  it("an original ship + its revert count as ONE change, and the revert never adds to Wins", () => {
    // A won title edit, then the revert executor recorded its own revert_edit_title row on
    // the same page (run-revert.ts). Without the fix BOTH rows count, and the revert's
    // same-page ship also drags the original win into measuring (attribution overlap).
    const original = row("orig", "won", MATURE_WINDOWS, { path: "/pageA", actionType: "edit_title" });
    const revert = row("rev", "won", MATURE_WINDOWS, {
      path: "/pageA",
      shippedAt: "2026-05-15T00:00:00.000Z",
      actionType: "revert_edit_title",
    });
    const counts = countLedgerLifecycle([original, revert], NOW);
    // ONE distinct change, and it is still the genuine win - the revert is gone entirely.
    expect(counts.won).toBe(1);
    expect(counts.decided).toBe(1);
    expect(counts.measuring).toBe(0);
    // The original row survives the split; the revert_* row is the one dropped.
    const split = splitLedgerLifecycle([original, revert], NOW);
    expect(split.won.map((r) => r.id)).toEqual(["orig"]);
    expect([...split.won, ...split.learned, ...split.measuring].map((r) => r.id)).toEqual(["orig"]);
  });

  it("PIN: a no-revert ledger is byte-identical - excludeRevertBookkeeping returns the SAME array reference", () => {
    const rows = [
      row("w", "won", MATURE_WINDOWS, { actionType: "edit_title" }),
      row("l", "lost", MATURE_WINDOWS, { actionType: "edit_meta" }),
    ];
    // Same reference (no re-filter, no re-sort) when nothing is a revert.
    expect(excludeRevertBookkeeping(rows)).toBe(rows);
    // And the split is unchanged from a plain no-actionType ledger.
    const withRevert = [...rows, row("rev", "lost", MATURE_WINDOWS, { actionType: "revert_edit_title" })];
    expect(excludeRevertBookkeeping(withRevert)).not.toBe(withRevert);
    expect(excludeRevertBookkeeping(withRevert).map((r) => r.id)).toEqual(["w", "l"]);
  });

  it("a legacy ledger row with NO actionType is treated as a real change (never a false drop)", () => {
    const legacy = row("legacy", "won", MATURE_WINDOWS); // no actionType field at all
    expect(countLedgerLifecycle([legacy], NOW)).toEqual({ measuring: 0, decided: 1, won: 1 });
  });
});

describe("countLedgerLifecycle - the 16-vs-25 class of bug", () => {
  it("'measuring' counts EVERY shipped change without a final read (early reads, thin 28d closes), not just verdict === 'measuring' - so a Today link promising N lands on exactly N In flight rows", () => {
    const rows = [
      row("m1", "measuring", OPEN_WINDOWS),
      // The rows the old verdict-field filter missed - all still in flight on Results:
      row("early-won", "won", [{ day: 7, ran: true, controlsUsed: 3 }]),
      row("thin-28d", "won", [{ day: 28, ran: true, controlsUsed: 1 }]),
      row("inconclusive", "inconclusive", MATURE_WINDOWS),
      row("insufficient", "insufficient_data", MATURE_WINDOWS),
      // And the decided ones:
      row("win", "won", MATURE_WINDOWS),
      row("loss", "lost", MATURE_WINDOWS),
    ];
    const counts = countLedgerLifecycle(rows, NOW);
    expect(counts.measuring).toBe(5);
    expect(counts.decided).toBe(2);
    expect(counts.won).toBe(1);
    // The old rule would have promised 1 ("measuring" verdicts only) while Results
    // showed 5 in flight - the exact contradiction FP3 kills.
    expect(rows.filter((r) => r.verdict === "measuring")).toHaveLength(1);
  });

  it("decided always includes won (won is a subset, never a fourth bucket)", () => {
    const counts = countLedgerLifecycle([row("w", "won", MATURE_WINDOWS), row("l", "lost", MATURE_WINDOWS)], NOW);
    expect(counts.decided).toBe(2);
    expect(counts.won).toBe(1);
  });
});

describe("tonightCounts - the same formula as Today's 'Tonight: N of M applied' progress bar", () => {
  const selected = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));

  it("no plan at all: 0 picked, 0 applied", () => {
    expect(tonightCounts(null, null)).toEqual({ picked: 0, applied: 0 });
  });

  it("a preview plan is picked but never applied (nothing can apply before approval)", () => {
    const preview: TonightPlanLike = { selected };
    expect(tonightCounts(null, preview)).toEqual({ picked: 6, applied: 0 });
  });

  it("an accepted plan with no execution state yet: all items still left to apply", () => {
    const accepted: TonightPlanLike = { selected };
    expect(tonightCounts(accepted, null)).toEqual({ picked: 6, applied: 0 });
  });

  it("applied = picked minus the items still waiting on the operator's edit (execution-checklist's summary.left set)", () => {
    const accepted: TonightPlanLike = {
      selected,
      execution: {
        items: {
          a: { status: "active" },
          b: { status: "gsc_submitted" },
          c: { status: "skipped" },
          d: { status: "verified_live" },
          e: { status: "ready_to_apply" },
          f: { status: "verification_pending" },
        },
      },
    };
    // left = e (ready_to_apply) + f (verification_pending) = 2 -> applied = 4,
    // byte-for-byte what the checklist's "Tonight: 4 of 6 applied" bar shows.
    expect(tonightCounts(accepted, null)).toEqual({ picked: 6, applied: 4 });
  });

  it("the '6 of 6 applied' day: all items past the operator's edit reads 6 picked, 6 applied", () => {
    const accepted: TonightPlanLike = {
      selected,
      execution: {
        items: Object.fromEntries(selected.map((s) => [s.id, { status: "gsc_submitted" as const }])),
      },
    };
    expect(tonightCounts(accepted, null)).toEqual({ picked: 6, applied: 6 });
  });

  it("an accepted plan wins over a stale preview", () => {
    const accepted: TonightPlanLike = { selected: [{ id: "a" }] };
    const preview: TonightPlanLike = { selected };
    expect(tonightCounts(accepted, preview)).toEqual({ picked: 1, applied: 0 });
  });
});

describe("computeLifecycleCounts - the full sextuple", () => {
  it("composes ledger stages + tonight counts + the backlog count", () => {
    const counts = computeLifecycleCounts({
      ledger: [row("w", "won", MATURE_WINDOWS), row("m", "measuring", OPEN_WINDOWS)],
      acceptedPlan: { selected: [{ id: "a" }, { id: "b" }], execution: { items: { a: { status: "active" } } } },
      previewPlan: null,
      backlogToDo: 42,
      now: NOW,
    });
    expect(counts).toEqual({
      toDo: 42,
      tonightPicked: 2,
      tonightApplied: 1,
      measuring: 1,
      decided: 1,
      won: 1,
    });
  });
});

describe("fail-closed calibration quarantine (2026-07-11) - the bucket rule", () => {
  it("a mature, sufficient but UNCALIBRATED 'won' lands in measuring, never won", () => {
    const uncal = row("a", "won", MATURE_WINDOWS, { calibrationVersion: null });
    expect(ledgerLifecycleStage(uncal, null, NOW)).toBe("measuring");
  });

  it("a mature, sufficient but UNCALIBRATED 'lost' lands in measuring, never learned", () => {
    const uncal = row("a", "lost", MATURE_WINDOWS, { calibrationVersion: null });
    expect(ledgerLifecycleStage(uncal, null, NOW)).toBe("measuring");
  });

  it("counts collapse: a ledger of uncalibrated mature won/lost reads as all measuring, zero decided", () => {
    const ledger = [
      row("a", "won", MATURE_WINDOWS, { calibrationVersion: null }),
      row("b", "lost", MATURE_WINDOWS, { calibrationVersion: null }),
      row("c", "won", MATURE_WINDOWS, { calibrationVersion: null }),
    ];
    expect(countLedgerLifecycle(ledger, NOW)).toEqual({ measuring: 3, decided: 0, won: 0 });
  });
});
