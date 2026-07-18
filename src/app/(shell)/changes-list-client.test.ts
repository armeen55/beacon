/**
 * changes-list-client - copy-honesty guard (round 2). Source-pinning (this repo's
 * convention for interactive client components with no jsdom/@testing-library/react
 * configured, see today-moves-prepare-ux3.test.ts). Confirms the applied-batch summary
 * row never claims scheduled/overnight timing - Beacon has no scheduler (vercel.json
 * crons: []); all batch work happens on-use.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - no-scheduler honesty (Beacon has no cron)", () => {
  it("never claims scheduled/overnight timing", () => {
    expect(SRC).not.toMatch(/tonight|last night|overnight|nightly/i);
  });

  it("labels the applied-batch summary row as today's batch", () => {
    expect(SRC).toContain("Today&apos;s batch, {batchRows.length} receipts");
  });
});
