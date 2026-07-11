/**
 * verdict-date-single-source (Wave 3A D5 pin, 2026-07-10) - THE contradiction pin for the
 * "Jul 14/15/18" class of bug: three surfaces showing three different "next read" dates for the
 * same ledger. From ONE fixture, every Lane A date consumer must equal verdictSchedule.firstReadOn,
 * and every render site must format it through the one monthDayLabel (UTC).
 */
import { describe, it, expect } from "vitest";

import { verdictSchedule, type VerdictScheduleRow } from "@/domains/proof-gsc/verdict-schedule";
import { buildScoreboard, type ScoreboardDay } from "@/domains/scoreboard/scoreboard";
import { buildDailyExperimentDashboard } from "@/domains/experiments/daily-experiment-dashboard";
import { monthDayLabel } from "@/components/data/receipt-line";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

const NOW = new Date("2026-07-02T12:00:00Z");

// A single change shipped 2026-06-28, still measuring (no window closed). Its 7-day checkpoint
// (2026-07-05) is the soonest FUTURE first-read; its final verdict is ship+28 (2026-07-26) and
// reliable Google data lands 3 days after that (2026-07-29).
const LEDGER: VerdictScheduleRow[] = [
  {
    id: "singers",
    path: "/singers",
    shippedAt: "2026-06-28T05:00:00.000Z",
    verdict: "measuring",
    actionType: "edit_title",
    windows: [
      { day: 7, ran: false },
      { day: 14, ran: false },
      { day: 28, ran: false },
    ],
    baseline: { impressions: 1000 },
  },
];

const SCHEDULE = verdictSchedule(LEDGER, NOW);

function days28(): ScoreboardDay[] {
  const start = Date.parse("2026-06-04");
  return Array.from({ length: 28 }, (_, i) => ({
    date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    clicks: 10,
    impressions: 200,
  }));
}

describe("verdictSchedule - the one proof schedule", () => {
  it("firstReadOn is the soonest FUTURE 7/14/28 checkpoint, finalVerdictOn is ship+28, reliableDataOn adds the GSC lag", () => {
    expect(SCHEDULE.firstReadOn).toBe("2026-07-05");
    expect(SCHEDULE.finalVerdictOn).toBe("2026-07-26");
    expect(SCHEDULE.reliableDataOn).toBe("2026-07-29");
  });

  it("a decided (mature) ledger has no future schedule", () => {
    const mature: VerdictScheduleRow[] = [
      {
        id: "done",
        path: "/done",
        shippedAt: "2026-05-01T00:00:00.000Z",
        verdict: "won",
        actionType: "edit_title",
        windows: [
          { day: 7, ran: true, controlsUsed: 3 },
          { day: 14, ran: true, controlsUsed: 3 },
          { day: 28, ran: true, controlsUsed: 3 },
        ],
        baseline: { impressions: 1000 },
      },
    ];
    expect(verdictSchedule(mature, NOW)).toEqual({
      firstReadOn: null,
      finalVerdictOn: null,
      reliableDataOn: null,
    });
  });
});

describe("every date consumer equals verdictSchedule.firstReadOn", () => {
  it("scoreboard.nextVerdictDate == firstReadOn", () => {
    const s = buildScoreboard(days28(), LEDGER, NOW)!;
    expect(s.nextVerdictDate).toBe(SCHEDULE.firstReadOn);
  });

  it("scoreboard hero line names the date via monthDayLabel (UTC)", () => {
    const s = buildScoreboard(days28(), LEDGER, NOW)!;
    expect(s.verdictLine).toContain(`next reads around ${monthDayLabel(SCHEDULE.firstReadOn)}`);
    expect(s.verdictLine).toContain("next reads around Jul 5");
  });

  it("daily-experiment dashboard nextCheckpoint == firstReadOn and reliableDataDate == reliableDataOn", () => {
    const dash = buildDailyExperimentDashboard({
      ledger: LEDGER as unknown as ShippedChangeRecord[],
      now: NOW,
    });
    expect(dash.activeProofBatch?.nextCheckpoint).toBe(SCHEDULE.firstReadOn);
    expect(dash.activeProofBatch?.reliableDataDate).toBe(SCHEDULE.reliableDataOn);
  });
});

describe("monthDayLabel is UTC single-source (no local-TZ drift)", () => {
  it("formats a date-only and a late-UTC timestamp to the same UTC month/day", () => {
    expect(monthDayLabel("2026-07-05")).toBe("Jul 5");
    expect(monthDayLabel("2026-07-05T23:30:00Z")).toBe("Jul 5");
  });
});
