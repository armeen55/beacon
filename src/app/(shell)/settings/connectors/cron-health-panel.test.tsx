import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

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
 * I-61 (operator spec 2026-07-09): the reliability report is noise unless
 * something needs action. The panel renders ONLY failing/stalled jobs - never
 * the full green roster ("I showed up 5 of 5 nights") - and hides entirely when
 * everything ran on schedule.
 */
describe("CronHealthPanel", () => {
  it("renders nothing when every job ran on schedule", async () => {
    jobs = [
      job({
        lastRun: { startedAt: "2026-07-02T09:00:00.000Z", ok: true, durationMs: 4200 },
        headline: "I showed up 7 of 7 nights this week.",
        pace: "healthy",
      }),
      job({ job: "nightly-batch", label: "Nightly batch", pace: "healthy", lastRun: { startedAt: "2026-07-02T10:00:00.000Z", ok: true, durationMs: 900 } }),
    ];
    expect(await CronHealthPanel()).toBeNull();
  });

  it("renders nothing when no job has run yet and nothing is overdue", async () => {
    jobs = [job(), job({ job: "nightly-batch", label: "Nightly batch" })];
    expect(await CronHealthPanel()).toBeNull();
  });

  it("shows ONLY the failing/stalled jobs, never the green roster", async () => {
    jobs = [
      // Healthy - must NOT appear.
      job({
        job: "sync-connectors",
        label: "Nightly data sync",
        lastRun: { startedAt: "2026-07-02T09:00:00.000Z", ok: true, durationMs: 4200 },
        headline: "I showed up 7 of 7 nights this week.",
        pace: "healthy",
      }),
      // Stalled - must appear.
      job({
        job: "measure",
        label: "Nightly results check",
        pace: "stalled",
        paceSentence:
          "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
      }),
    ];
    const html = renderToStaticMarkup((await CronHealthPanel()) as ReactElement);
    expect(html).toContain('data-cron-health-panel="true"');
    expect(html).toContain("Scheduled work that needs attention");
    // The failing job shows with its red pace line + next run.
    expect(html).toContain('data-cron-health-job="measure"');
    expect(html).toContain('data-cron-health-pace="stalled"');
    expect(html).toContain("Next scheduled run:");
    // The green roster noise is gone: no healthy job, no "I showed up ..." line.
    expect(html).not.toContain('data-cron-health-job="sync-connectors"');
    expect(html).not.toContain("I showed up");
    expect(html).not.toContain("Last run OK");
    expect(html).not.toContain("nights synced");
  });

  it("T0c: a stalled job shows the deadman sentence with the SAME words as Today + a fix", async () => {
    jobs = [
      job({
        job: "measure",
        label: "Nightly results check",
        pace: "stalled",
        paceSentence:
          "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
      }),
    ];
    const html = renderToStaticMarkup((await CronHealthPanel()) as ReactElement);
    expect(html).toContain('data-cron-health-pace="stalled"');
    expect(html).toContain(
      "The nightly results check has not run since Jul 3, 2:30 AM. It was due again this morning. Check the Connections page.",
    );
    expect(html).toContain('data-cron-health-fix="stalled"');
    expect(html).not.toMatch(/[‒–—―]/);
  });

  it("an overdue never-run job renders (nothing to reassure about, only to fix)", async () => {
    jobs = [
      job({
        pace: "stalled",
        paceSentence:
          "The nightly data sync has never run. Its first run was due yesterday. Check the Connections page.",
      }),
      // A healthy peer stays hidden.
      job({ job: "nightly-batch", label: "Nightly batch", pace: "healthy", lastRun: { startedAt: "2026-07-02T10:00:00.000Z", ok: true, durationMs: 900 } }),
    ];
    const html = renderToStaticMarkup((await CronHealthPanel()) as ReactElement);
    expect(html).toContain(
      "The nightly data sync has never run. Its first run was due yesterday. Check the Connections page.",
    );
    expect(html).not.toContain('data-cron-health-job="nightly-batch"');
  });

  it("a job whose last run had issues renders even when the schedule pace is fine", async () => {
    jobs = [
      job({
        job: "measure",
        label: "Nightly results check",
        pace: "healthy",
        lastRun: { startedAt: "2026-07-08T09:00:00.000Z", ok: false, durationMs: 1200 },
        headline: "I showed up 6 of 7 nights this week.",
      }),
    ];
    const html = renderToStaticMarkup((await CronHealthPanel()) as ReactElement);
    expect(html).toContain('data-cron-health-lastrun="issues"');
    expect(html).toContain("The last run had issues.");
  });
});
