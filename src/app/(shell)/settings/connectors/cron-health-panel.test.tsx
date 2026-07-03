import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { JobHealthView } from "@/domains/ops/cron-health-view";

let jobs: JobHealthView[] = [];
vi.mock("@/domains/ops/cron-health-view", () => ({
  loadCronHealthView: async () => jobs,
}));

import { CronHealthPanel } from "./cron-health-panel";

function job(overrides: Partial<JobHealthView> = {}): JobHealthView {
  return {
    job: "sync-connectors",
    label: "Sync connectors",
    nextScheduledAtIso: "2026-07-03T09:00:00.000Z",
    pace: "waiting",
    paceSentence: null,
    lastRun: null,
    headline: "I have not run yet.",
    perSourceThisWeek: [],
    failureStreaks: [],
    ...overrides,
  };
}

beforeEach(() => {
  jobs = [];
});

/**
 * FP7 finding (2026-07-02): "How reliably I show up" rendering "I have not
 * run yet." on every single job proved the opposite of its own name. Until
 * at least one job has a real run receipt, the panel collapses to one
 * honest line instead of a wall of empty statuses.
 */
describe("CronHealthPanel", () => {
  it("collapses to one honest line when no job has ever run", async () => {
    jobs = [job(), job({ job: "nightly-batch", label: "Nightly batch" })];
    const html = renderToStaticMarkup(await CronHealthPanel());
    expect(html).toContain('data-cron-health-collapsed="true"');
    expect(html).toContain("How reliably I show up");
    expect(html).toContain("Nightly work starts tonight around 2 AM. I will show receipts for every run here.");
    expect(html).not.toContain("I have not run yet.");
    expect(html).not.toContain("No history yet");
  });

  it("renders the full per-job breakdown once at least one job has a real run", async () => {
    jobs = [
      job({
        lastRun: { startedAt: "2026-07-02T09:00:00.000Z", ok: true, durationMs: 4200 },
        headline: "I showed up 1 of 1 nights this week.",
        pace: "healthy",
      }),
      job({ job: "nightly-batch", label: "Nightly batch" }),
    ];
    const html = renderToStaticMarkup(await CronHealthPanel());
    expect(html).not.toContain('data-cron-health-collapsed="true"');
    expect(html).toContain("Last run OK");
    expect(html).toContain("No history yet");
    expect(html).toContain("I showed up 1 of 1 nights this week.");
    expect(html).not.toContain("data-cron-health-pace");
  });

  it("T0c: a stalled job shows the deadman sentence with the SAME words as Today", async () => {
    jobs = [
      job({
        lastRun: { startedAt: "2026-07-03T09:30:00.000Z", ok: true, durationMs: 4200 },
        headline: "I showed up 3 of 3 nights this week.",
        pace: "stalled",
        paceSentence:
          "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
      }),
      job({
        job: "autopilot",
        label: "Autopilot auto-ship",
        lastRun: { startedAt: "2026-07-04T10:10:00.000Z", ok: true, durationMs: 900 },
        headline: "I showed up 4 of 4 nights this week.",
        pace: "late",
        paceSentence: "The autopilot shipping pass is running behind. It last ran Jul 4, 3:10 AM.",
      }),
    ];
    const html = renderToStaticMarkup(await CronHealthPanel());
    expect(html).toContain('data-cron-health-pace="stalled"');
    expect(html).toContain(
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    );
    expect(html).toContain('data-cron-health-pace="late"');
    expect(html).toContain("The autopilot shipping pass is running behind. It last ran Jul 4, 3:10 AM.");
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("T0c: the collapsed no-history line turns honest once a first run is overdue", async () => {
    jobs = [
      job({
        pace: "stalled",
        paceSentence:
          "The nightly data sync has never run. Its first run was due yesterday. Check the Connections page.",
      }),
      job({ job: "nightly-batch", label: "Nightly batch" }),
    ];
    const html = renderToStaticMarkup(await CronHealthPanel());
    expect(html).toContain('data-cron-health-collapsed="true"');
    expect(html).toContain(
      "The nightly data sync has never run. Its first run was due yesterday. Check the Connections page.",
    );
    expect(html).not.toContain("Nightly work starts tonight around 2 AM.");
  });
});
