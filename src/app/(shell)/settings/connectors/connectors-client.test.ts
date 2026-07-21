/**
 * connectors-client - copy-honesty guard (round 2). Source-pinning (this repo's
 * convention for interactive client components with no jsdom/@testing-library/react
 * configured, see today-moves-prepare-ux3.test.ts). Confirms the GSC gap-line doc
 * comments and rendered copy never claim scheduled/overnight timing - Beacon has no
 * scheduler (vercel.json crons: []); the actual re-pull happens on-use
 * (src/domains/gsc/ingestion-gaps.ts).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "connectors-client.tsx"), "utf8");

describe("ConnectorsClient - no-scheduler honesty (Beacon has no cron)", () => {
  it("never claims scheduled/overnight timing", () => {
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });
});

describe("ConnectorsClient - streak-escalation copy (2026-07-20)", () => {
  it("leads the sync-failing state with the day-count line, first person, no dash", () => {
    // A source escalated after N consecutive failed pulls reads the day count,
    // not a bare reconnect nag.
    expect(SRC).toContain(
      "This source has not synced in ${daysStale} day",
    );
    expect(SRC).toContain("I keep retrying, but it may need your attention.");
    // Still keeps the dated fallback for when there is no usable since date.
    expect(SRC).toContain("I have not been able to pull your data since");
  });

  it("computes the day count from the last good sync (needsAttentionSince)", () => {
    expect(SRC).toContain("const daysStale =");
    expect(SRC).toContain("needsAttentionSince ? Date.parse(needsAttentionSince)");
  });
});
