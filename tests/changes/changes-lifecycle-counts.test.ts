/**
 * THE ONE-COUNT RULE (Core 100K Phase 6 merge of
 * src/domains/changes/lifecycle-counts.test.ts + measuring-count-single-source.test.ts).
 *
 * The single classifier every surface's lifecycle counts come from. The killer
 * findings these protect: "three different counts for the same lifecycle
 * stage", "the cross-link promises 16 but lands on 25", "'6 of 6 applied' yet
 * the status strip says Ready is 0". This is the count-exactness pin at the
 * data layer: a Today link promising N lands on exactly N rows, and a zero
 * never lies.
 */
import { describe, expect, it, afterAll } from "vitest";
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
} from "@/domains/changes/lifecycle-counts";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildScoreboard, type ScoreboardDay, type ScoreboardLedgerRow } from "@/domains/scoreboard/scoreboard";

// Registered at module-eval time (not beforeAll) because CANONICAL_MEASURING
// below is derived at import time and must see calibrated fixtures as decided.
registerTestCalibratedVersion();
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

  it("a mature, sufficient 'won' is won; a mature, sufficient 'lost' is learned (decided, not a win)", () => {
    expect(ledgerLifecycleStage(row("a", "won", MATURE_WINDOWS), null, NOW)).toBe("won");
    expect(ledgerLifecycleStage(row("a", "lost", MATURE_WINDOWS), null, NOW)).toBe("learned");
  });

  it("a 28-day window that closed too thin to call (inconclusive) stays measuring", () => {
    expect(ledgerLifecycleStage(row("a", "inconclusive", MATURE_WINDOWS), null, NOW)).toBe("measuring");
  });

  it("a 28-day 'won' without enough comparison pages OR with a too-small baseline is NOT decided", () => {
    const thinControls = row("a", "won", [{ day: 28, ran: true, controlsUsed: 1 }]);
    expect(ledgerLifecycleStage(thinControls, null, NOW)).toBe("measuring");
    const thinBaseline = row("a", "won", MATURE_WINDOWS, { baseline: { impressions: 50 } });
    expect(ledgerLifecycleStage(thinBaseline, null, NOW)).toBe("measuring");
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

describe("a revert is bookkeeping, not a second shipped change", () => {
  it("an original ship + its revert count as ONE change, and the revert never adds to Wins", () => {
    expect(isRevertLedgerRow({ actionType: "revert_edit_title" })).toBe(true);
    expect(isRevertLedgerRow({ actionType: "edit_title" })).toBe(false);
    const original = row("orig", "won", MATURE_WINDOWS, { path: "/pageA", actionType: "edit_title" });
    const revert = row("rev", "won", MATURE_WINDOWS, {
      path: "/pageA",
      shippedAt: "2026-05-15T00:00:00.000Z",
      actionType: "revert_edit_title",
    });
    const counts = countLedgerLifecycle([original, revert], NOW);
    expect(counts.won).toBe(1);
    expect(counts.decided).toBe(1);
    expect(counts.measuring).toBe(0);
    const split = splitLedgerLifecycle([original, revert], NOW);
    expect([...split.won, ...split.learned, ...split.measuring].map((r) => r.id)).toEqual(["orig"]);
    expect(excludeRevertBookkeeping([original, revert]).map((r) => r.id)).toEqual(["orig"]);
  });

  it("a legacy ledger row with NO actionType is treated as a real change (never a false drop)", () => {
    const legacy = row("legacy", "won", MATURE_WINDOWS); // no actionType field at all
    expect(countLedgerLifecycle([legacy], NOW)).toEqual({ measuring: 0, decided: 1, won: 1 });
  });
});

describe("countLedgerLifecycle - the 16-vs-25 class of bug (count exactness)", () => {
  it("'measuring' counts EVERY shipped change without a final read, so a Today link promising N lands on exactly N In flight rows", () => {
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
    // The old rule would have promised 1 while Results showed 5 in flight.
    expect(rows.filter((r) => r.verdict === "measuring")).toHaveLength(1);
  });
});

describe("tonightCounts - the same formula as Today's 'Tonight: N of M applied' progress bar", () => {
  const selected = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));

  it("no plan: 0/0; a preview plan is picked but never applied (nothing can apply before approval)", () => {
    expect(tonightCounts(null, null)).toEqual({ picked: 0, applied: 0 });
    expect(tonightCounts(null, { selected })).toEqual({ picked: 6, applied: 0 });
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
    // left = e + f = 2 -> applied = 4, byte-for-byte the "Tonight: 4 of 6 applied" bar.
    expect(tonightCounts(accepted, null)).toEqual({ picked: 6, applied: 4 });
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

describe("fail-closed calibration quarantine - the bucket rule", () => {
  it("a mature, sufficient but UNCALIBRATED won/lost lands in measuring, never won/learned", () => {
    expect(ledgerLifecycleStage(row("a", "won", MATURE_WINDOWS, { calibrationVersion: null }), null, NOW)).toBe("measuring");
    expect(ledgerLifecycleStage(row("a", "lost", MATURE_WINDOWS, { calibrationVersion: null }), null, NOW)).toBe("measuring");
  });

  it("the Today hero derives every number from the one counter (no contradicting won/lost lines)", () => {
    const ledger = [
      row("cal-win", "won", MATURE_WINDOWS),
      row("uncal-win", "won", MATURE_WINDOWS, { calibrationVersion: null }),
      row("uncal-loss", "lost", MATURE_WINDOWS, { calibrationVersion: null }),
      row("open", "measuring", OPEN_WINDOWS),
    ];
    const counts = countLedgerLifecycle(ledger, NOW);
    expect(counts).toEqual({ measuring: 3, decided: 1, won: 1 });
    expect(counts.decided - counts.won).toBe(0); // no "lost" claim off the uncalibrated loss
  });
});

// ── measuring count, single source: every Lane A consumer agrees ────────

function consumerRow(id: string, verdict: string, windows: WindowFix[]): ScoreboardLedgerRow {
  return {
    id,
    path: `/${id}`,
    shippedAt: "2026-05-01T00:00:00.000Z",
    verdict,
    actionType: "edit_title",
    windows,
    baseline: { impressions: 1000 },
    calibrationVersion: TEST_CALIBRATED_VERSION,
  };
}

// ONE fixture, exercised by every consumer below.
// measuring = 2 open + 1 early-win (7d only) + 1 inconclusive-mature = 4
const LEDGER: ScoreboardLedgerRow[] = [
  consumerRow("m1", "measuring", OPEN_WINDOWS),
  consumerRow("m2", "measuring", OPEN_WINDOWS),
  consumerRow("early", "won", [{ day: 7, ran: true, controlsUsed: 3 }]),
  consumerRow("inconclusive", "inconclusive", MATURE_WINDOWS),
  consumerRow("win", "won", MATURE_WINDOWS),
  consumerRow("loss", "lost", MATURE_WINDOWS),
];

const CANONICAL_MEASURING = countLedgerLifecycle(LEDGER, NOW).measuring;

function days28(): ScoreboardDay[] {
  const start = Date.parse("2026-06-04");
  return Array.from({ length: 28 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    clicks: 10,
    impressions: 200,
  }));
}

describe("measuring count - one source, every Lane A consumer agrees", () => {
  it("the canonical count is 4 (open + early-win + inconclusive), not the 2 raw 'measuring' verdicts", () => {
    expect(CANONICAL_MEASURING).toBe(4);
    expect(LEDGER.filter((r) => r.verdict === "measuring")).toHaveLength(2);
  });

  it("scoreboard.measuringCount == countLedgerLifecycle.measuring", () => {
    const s = buildScoreboard(days28(), LEDGER, NOW)!;
    expect(s.measuringCount).toBe(CANONICAL_MEASURING);
  });

  it("two-tenant isolation: a second tenant's larger ledger never bleeds into the first's count", () => {
    const tenantB = [...LEDGER, consumerRow("b-extra", "measuring", OPEN_WINDOWS), consumerRow("b-extra2", "measuring", OPEN_WINDOWS)];
    expect(countLedgerLifecycle(LEDGER, NOW).measuring).toBe(4);
    expect(countLedgerLifecycle(tenantB, NOW).measuring).toBe(6);
    expect(buildScoreboard(days28(), tenantB, NOW)!.measuringCount).toBe(6);
  });
});

describe("static guard - no displayed count derives from the raw verdict string", () => {
  const noRawMeasuring = [
    "src/domains/scoreboard/scoreboard.ts",
  ];
  for (const rel of noRawMeasuring) {
    it(`${rel} contains no verdict === "measuring"`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src.includes('verdict === "measuring"')).toBe(false);
      expect(src.includes('verdict==="measuring"')).toBe(false);
    });
  }

  it("today-moves-data.ts no longer counts measuring off a raw maturity filter", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(shell)/today-moves-data.ts"), "utf8");
    expect(src.includes('filter((p) => p.maturity !== "mature_result").length')).toBe(false);
  });
});
