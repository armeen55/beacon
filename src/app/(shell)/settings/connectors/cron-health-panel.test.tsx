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
      }),
      job({ job: "nightly-batch", label: "Nightly batch" }),
    ];
    const html = renderToStaticMarkup(await CronHealthPanel());
    expect(html).not.toContain('data-cron-health-collapsed="true"');
    expect(html).toContain("Last run OK");
    expect(html).toContain("No history yet");
    expect(html).toContain("I showed up 1 of 1 nights this week.");
  });
});
