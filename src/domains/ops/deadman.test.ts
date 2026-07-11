import { describe, it, expect } from "vitest";

import {
  assessDeadman,
  classifyJobPace,
  duePhrase,
  fmtPacific,
  lastDueBefore,
  schedulePeriodMs,
  summarizeJobReceipts,
  ABANDONED_RUN_GRACE_MS,
} from "./deadman";
import { findScheduleForJob, type CronScheduleEntry } from "./cron-schedule-map";

const SYNC = findScheduleForJob("sync-connectors")!; // "0 9 * * *" daily
const MEASURE = findScheduleForJob("measure-due")!; // "30 9 * * *" daily
const AI = findScheduleForJob("ai-engines")!; // "17 10 * * 1,3,5"
const FACTORY = findScheduleForJob("page-factory")!; // "47 13 * * 1" weekly

function latest(map: Record<string, string | null>): Map<string, string | null> {
  return new Map(Object.entries(map));
}

describe("schedulePeriodMs", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");
  it("is 24h for a daily schedule", () => {
    expect(schedulePeriodMs(SYNC.schedule, now)).toBe(24 * 60 * 60 * 1000);
  });
  it("is 72h (the weekend gap) for Mon/Wed/Fri", () => {
    expect(schedulePeriodMs(AI.schedule, now)).toBe(72 * 60 * 60 * 1000);
  });
  it("is 7 days for a weekly schedule", () => {
    expect(schedulePeriodMs(FACTORY.schedule, now)).toBe(7 * 24 * 60 * 60 * 1000);
  });
  it("falls back to 24h for an unparseable schedule", () => {
    expect(schedulePeriodMs("not a cron", now)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("lastDueBefore", () => {
  it("finds this morning's fire when now is past it", () => {
    const due = lastDueBefore(SYNC.schedule, new Date("2026-07-10T12:00:00.000Z"));
    expect(due?.toISOString()).toBe("2026-07-10T09:00:00.000Z");
  });
  it("finds yesterday's fire when today's has not happened yet", () => {
    const due = lastDueBefore(SYNC.schedule, new Date("2026-07-10T08:00:00.000Z"));
    expect(due?.toISOString()).toBe("2026-07-09T09:00:00.000Z");
  });
});

describe("classifyJobPace: jobs with receipts", () => {
  it("healthy when the last run is within 1.5x the period", () => {
    const pace = classifyJobPace(
      SYNC,
      "2026-07-03T09:05:00.000Z",
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-04T08:00:00.000Z"), // ~23h later
    );
    expect(pace.pace).toBe("healthy");
    expect(pace.sentence).toBeNull();
  });

  it("late between 1.5x and 3x the period, and says so plainly", () => {
    const pace = classifyJobPace(
      SYNC,
      "2026-07-02T09:05:00.000Z",
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-04T08:00:00.000Z"), // ~47h later
    );
    expect(pace.pace).toBe("late");
    expect(pace.sentence).toContain("The nightly data sync is running behind.");
    expect(pace.sentence).toContain("It last ran");
  });

  it("stalled beyond 3x the period, with the spec's plain sentence shape", () => {
    // Last ran Jul 3 09:00 UTC (Jul 3, 2:00 AM Pacific); now Jul 6 16:00 UTC
    // (Jul 6, 9 AM Pacific) - 79h elapsed on a 24h period.
    const pace = classifyJobPace(
      MEASURE,
      "2026-07-03T09:30:00.000Z",
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-06T16:00:00.000Z"),
    );
    expect(pace.pace).toBe("stalled");
    expect(pace.sentence).toBe(
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    );
  });

  it("a Mon/Wed/Fri job that last ran Friday is still healthy on Sunday", () => {
    const pace = classifyJobPace(
      AI,
      "2026-07-03T10:20:00.000Z", // Friday
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-05T12:00:00.000Z"), // Sunday, ~50h later, period 72h
    );
    expect(pace.pace).toBe("healthy");
  });

  it("a weekly job is healthy a full 6 days after its last run", () => {
    const pace = classifyJobPace(
      FACTORY,
      "2026-07-06T13:50:00.000Z", // Monday
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-12T13:00:00.000Z"), // Sunday
    );
    expect(pace.pace).toBe("healthy");
  });
});

describe("classifyJobPace: never-ran grace", () => {
  it("waiting before the first scheduled moment since the ledger began", () => {
    const pace = classifyJobPace(
      SYNC,
      null,
      null, // empty ledger -> anchored at the 2026-07-04 epoch (first unattended night)
      new Date("2026-07-04T05:00:00.000Z"), // before the Jul 4 09:00 UTC fire
    );
    expect(pace.pace).toBe("waiting");
    expect(pace.sentence).toBeNull();
  });

  it("late (not stalled) within one period of the missed first moment", () => {
    const pace = classifyJobPace(
      SYNC,
      null,
      null,
      new Date("2026-07-04T10:00:00.000Z"), // 1h past the first 09:00 UTC fire
    );
    expect(pace.pace).toBe("late");
    expect(pace.sentence).toBe(
      "The nightly data sync has not made its first run yet. It was due this morning.",
    );
  });

  it("stalled beyond one full period with no first run", () => {
    const pace = classifyJobPace(
      SYNC,
      null,
      null,
      new Date("2026-07-05T10:00:00.000Z"), // 25h past the first fire
    );
    expect(pace.pace).toBe("stalled");
    expect(pace.sentence).toBe(
      "The nightly data sync has never run. Its first run was due yesterday. Check the Connections page.",
    );
  });

  it("anchors grace at the ledger's own first receipt when one exists", () => {
    // Ledger began Jul 10 06:00 UTC; the job's first fire after that is
    // Jul 10 09:00 UTC, still ahead of now -> waiting, not stalled.
    const pace = classifyJobPace(
      SYNC,
      null,
      "2026-07-10T06:00:00.000Z",
      new Date("2026-07-10T08:00:00.000Z"),
    );
    expect(pace.pace).toBe("waiting");
  });
});

describe("summarizeJobReceipts", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  it("finished rows: last run is the newest finished, nothing died", () => {
    const s = summarizeJobReceipts(
      [
        { started_at: "2026-07-11T09:00:00.000Z", phase: "finished" },
        { started_at: "2026-07-10T09:00:00.000Z", phase: "finished" },
      ],
      now,
    );
    expect(s.lastRunStartedAt).toBe("2026-07-11T09:00:00.000Z");
    expect(s.diedMidRunStartedAt).toBeNull();
    expect(s.oldestStartedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  it("legacy rows with no phase read as finished", () => {
    const s = summarizeJobReceipts([{ started_at: "2026-07-11T09:00:00.000Z" }], now);
    expect(s.lastRunStartedAt).toBe("2026-07-11T09:00:00.000Z");
    expect(s.diedMidRunStartedAt).toBeNull();
  });

  it("a RECENT started row is in-flight: counts as a fresh run, nothing died", () => {
    const recent = new Date(now.getTime() - 60_000).toISOString(); // 1 min ago
    const s = summarizeJobReceipts(
      [
        { started_at: recent, phase: "running" },
        { started_at: "2026-07-10T09:00:00.000Z", phase: "finished" },
      ],
      now,
    );
    expect(s.lastRunStartedAt).toBe(recent); // treated as a run happening now
    expect(s.diedMidRunStartedAt).toBeNull();
  });

  it("a STALE started row (beyond the grace window) reads as died mid-run", () => {
    const stale = new Date(now.getTime() - ABANDONED_RUN_GRACE_MS - 60_000).toISOString();
    const s = summarizeJobReceipts(
      [
        { started_at: stale, phase: "running" },
        { started_at: "2026-07-10T09:00:00.000Z", phase: "finished" },
      ],
      now,
    );
    expect(s.diedMidRunStartedAt).toBe(stale);
    // Pacing still points at the last real finished run, not the abandoned row.
    expect(s.lastRunStartedAt).toBe("2026-07-10T09:00:00.000Z");
  });

  it("empty history: all null", () => {
    const s = summarizeJobReceipts([], now);
    expect(s).toEqual({ lastRunStartedAt: null, diedMidRunStartedAt: null, oldestStartedAt: null });
  });
});

describe("classifyJobPace: died mid-run", () => {
  it("an abandoned started receipt stalls with the 'did not finish' sentence", () => {
    const pace = classifyJobPace(
      SYNC,
      "2026-07-09T09:00:00.000Z", // last finished run
      "2026-07-01T09:00:00.000Z",
      new Date("2026-07-11T09:30:00.000Z"),
      "2026-07-11T09:00:00.000Z", // started this morning, never finished
    );
    expect(pace.pace).toBe("stalled");
    expect(pace.sentence).toBe(
      "The nightly data sync started Jul 11, 2:00 AM but did not finish. Check the Connections page.",
    );
    // Figure dash through horizontal bar (U+2012..U+2015), written as unicode
    // escapes so no literal dash characters appear on this added line.
    expect(pace.sentence).not.toMatch(new RegExp("[\\u2012\\u2013\\u2014\\u2015]"));
  });
});

describe("assessDeadman", () => {
  const entries: CronScheduleEntry[] = [SYNC, MEASURE];

  it("a died-mid-run job alarms Today with the 'did not finish' sentence", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-11T09:35:00.000Z", // measure healthy
        "measure-due": "2026-07-11T09:35:00.000Z",
      }),
      diedMidRunByJob: latest({ "sync-connectors": "2026-07-11T09:00:00.000Z" }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      now: new Date("2026-07-11T09:30:00.000Z"),
    });
    expect(verdict.overall).toBe("stalled");
    expect(verdict.alarm).toBe(true);
    expect(verdict.sentences[0]).toContain("but did not finish");
  });

  it("mixed fleet: overall takes the worst pace and alarms on stalled", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-06T09:05:00.000Z", // healthy
        "measure-due": "2026-07-03T09:30:00.000Z", // stalled
      }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.overall).toBe("stalled");
    expect(verdict.alarm).toBe(true);
    expect(verdict.sentences).toEqual([
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    ]);
  });

  it("late alone never alarms Today (it shows on the health panel instead)", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-04T09:05:00.000Z", // ~2 days -> late
        "measure-due": "2026-07-06T09:35:00.000Z", // healthy
      }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.overall).toBe("late");
    expect(verdict.alarm).toBe(false);
    expect(verdict.sentences).toEqual([]);
  });

  it("healthy fleet: quiet verdict, no sentences", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-06T09:05:00.000Z",
        "measure-due": "2026-07-06T09:35:00.000Z",
      }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.overall).toBe("healthy");
    expect(verdict.alarm).toBe(false);
    expect(verdict.sentences).toEqual([]);
  });

  it("two stalled jobs: one worst-case sentence plus an honest count", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-01T09:05:00.000Z", // most overdue
        "measure-due": "2026-07-03T09:30:00.000Z",
      }),
      ledgerBeganAt: "2026-06-25T09:00:00.000Z",
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.sentences).toHaveLength(2);
    expect(verdict.sentences[0]).toContain("The nightly data sync has not run since");
    expect(verdict.sentences[1]).toBe("1 other scheduled job is stalled too.");
  });

  it("two failed probes in a row add the site-down sentence first", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-06T09:05:00.000Z",
        "measure-due": "2026-07-03T09:30:00.000Z", // stalled
      }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      probes: [
        { checkedAt: "2026-07-06T09:10:00.000Z", ok: false, status: null },
        { checkedAt: "2026-07-05T09:10:00.000Z", ok: false, status: 503 },
      ],
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.siteDown).toBe(true);
    expect(verdict.alarm).toBe(true);
    expect(verdict.sentences[0]).toBe(
      "Your site did not answer the last two times I checked. I last tried Jul 6, 2:10 AM. Check that your site is up before anything else.",
    );
    expect(verdict.sentences[1]).toContain("The nightly results check has not run since");
  });

  it("one failed probe alone stays quiet (weather, not fire)", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({
        "sync-connectors": "2026-07-06T09:05:00.000Z",
        "measure-due": "2026-07-06T09:35:00.000Z",
      }),
      ledgerBeganAt: "2026-07-01T09:00:00.000Z",
      probes: [
        { checkedAt: "2026-07-06T09:10:00.000Z", ok: false, status: 503 },
        { checkedAt: "2026-07-05T09:10:00.000Z", ok: true, status: 200 },
      ],
      now: new Date("2026-07-06T16:00:00.000Z"),
    });
    expect(verdict.siteDown).toBe(false);
    expect(verdict.alarm).toBe(false);
  });

  it("all-waiting fleet (fresh ledger, nothing due yet) stays quiet", () => {
    const verdict = assessDeadman({
      entries,
      latestRunByJob: latest({}),
      ledgerBeganAt: null,
      now: new Date("2026-07-03T05:00:00.000Z"),
    });
    expect(verdict.overall).toBe("waiting");
    expect(verdict.alarm).toBe(false);
    expect(verdict.sentences).toEqual([]);
  });
});

describe("copy hygiene", () => {
  it("no sentence ever carries an em or en dash", () => {
    const verdict = assessDeadman({
      latestRunByJob: latest({}),
      ledgerBeganAt: null,
      probes: [
        { checkedAt: "2026-07-06T09:10:00.000Z", ok: false, status: null },
        { checkedAt: "2026-07-05T09:10:00.000Z", ok: false, status: 503 },
      ],
      now: new Date("2026-07-20T16:00:00.000Z"),
    });
    for (const s of [...verdict.sentences, verdict.siteSentence ?? ""]) {
      expect(s).not.toMatch(/[‒–—―]/);
    }
    expect(fmtPacific("2026-07-06T09:10:00.000Z")).toBe("Jul 6, 2:10 AM");
    expect(duePhrase(new Date("2026-07-01T09:00:00.000Z"), new Date("2026-07-06T16:00:00.000Z"))).toBe("on Jul 1");
  });
});
