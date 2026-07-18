import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CRON_SCHEDULE_MAP, nextScheduledRun, findScheduleForJob } from "./cron-schedule-map";

type VercelCron = { path: string; schedule: string };

function readVercelCrons(): VercelCron[] {
  const raw = readFileSync(resolve(__dirname, "../../../vercel.json"), "utf-8");
  const parsed = JSON.parse(raw) as { crons?: VercelCron[] };
  return parsed.crons ?? [];
}

describe("CRON_SCHEDULE_MAP pins vercel.json", () => {
  it("has exactly one entry per vercel.json cron, matching path + schedule", () => {
    const real = readVercelCrons();
    expect(CRON_SCHEDULE_MAP.length).toBe(real.length);
    for (const cron of real) {
      const mapped = CRON_SCHEDULE_MAP.find((e) => e.path === cron.path);
      expect(mapped, `no CRON_SCHEDULE_MAP entry for path ${cron.path}`).toBeTruthy();
      expect(mapped!.schedule).toBe(cron.schedule);
    }
  });

  it("keeps Vercel scheduling disabled because authenticated use drives upkeep", () => {
    expect(readVercelCrons()).toEqual([]);
    expect(CRON_SCHEDULE_MAP).toEqual([]);
  });

  it("does not contain any entry NOT present in vercel.json (stale/removed cron)", () => {
    const real = readVercelCrons();
    const realPaths = new Set(real.map((c) => c.path));
    for (const entry of CRON_SCHEDULE_MAP) {
      expect(realPaths.has(entry.path), `${entry.path} not in vercel.json - remove stale entry`).toBe(true);
    }
  });
});

describe("nextScheduledRun", () => {
  it("computes the next daily fire time later the same day", () => {
    const from = new Date("2026-07-03T08:00:00.000Z");
    const next = nextScheduledRun("0 9 * * *", from);
    expect(next?.toISOString()).toBe("2026-07-03T09:00:00.000Z");
  });

  it("rolls to tomorrow when today's time already passed", () => {
    const from = new Date("2026-07-03T10:00:00.000Z");
    const next = nextScheduledRun("0 9 * * *", from);
    expect(next?.toISOString()).toBe("2026-07-04T09:00:00.000Z");
  });

  it("honors a weekday list (Mon/Wed/Fri)", () => {
    // 2026-07-03 is a Friday.
    const from = new Date("2026-07-03T11:00:00.000Z");
    const next = nextScheduledRun("17 10 * * 1,3,5", from);
    // Already past 10:17 UTC on Friday -> next hit is Monday.
    expect(next?.getUTCDay()).toBe(1);
    expect(next?.getUTCHours()).toBe(10);
    expect(next?.getUTCMinutes()).toBe(17);
  });

  it("honors a weekly single-day schedule (Sunday)", () => {
    const from = new Date("2026-07-03T00:00:00.000Z"); // Friday
    const next = nextScheduledRun("33 13 * * 0", from);
    expect(next?.getUTCDay()).toBe(0);
  });

  it("returns null for an unparseable schedule", () => {
    expect(nextScheduledRun("not a cron")).toBeNull();
  });
});

describe("findScheduleForJob", () => {
  it("does not pretend guarded maintenance routes are scheduled", () => {
    expect(findScheduleForJob("sync-connectors")).toBeNull();
  });

  it("returns null for an unknown job", () => {
    expect(findScheduleForJob("not-a-real-job")).toBeNull();
  });
});
