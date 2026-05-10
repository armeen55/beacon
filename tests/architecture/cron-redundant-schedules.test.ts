/**
 * Architecture test — daily-native-poll + poll-canary redundant-schedule
 * reliability ratchet (2026-05-10).
 *
 * GitHub Actions' shared scheduler can silently skip a scheduled workflow.
 * Beacon's response is to schedule each daily-poll workflow multiple times
 * per UTC day, with the UTC-day budget guard (defaultHasRecentRun in
 * src/domains/observations/run-poll.ts) preventing duplicate paid API
 * calls when more than one attempt actually fires.
 *
 * This test pins the YAML schedule shape so a future edit can't silently
 * collapse the workflow back to a single fragile schedule.
 *
 * Assertions:
 *   1. daily-native-poll.yml lists the three expected cron schedules in
 *      the documented order (07:00 / 08:30 / 10:00 UTC).
 *   2. poll-canary.yml lists three matching canary cron schedules
 *      (07:45 / 09:15 / 10:45 UTC), each ~45 min after the corresponding
 *      poll attempt.
 *   3. Both workflows still keep workflow_dispatch (manual trigger) for
 *      operator override.
 *   4. The redundancy-rationale comment is present on both files so a
 *      future agent reading the YAML doesn't "consolidate" the backups
 *      thinking they're stale.
 *   5. The same-day-skip safety property is documented in the poll
 *      workflow's schedule comment (refers to the run-poll guard test
 *      that ratchets the no-paid-call property).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const POLL_PATH = join(REPO_ROOT, ".github/workflows/daily-native-poll.yml");
const CANARY_PATH = join(REPO_ROOT, ".github/workflows/poll-canary.yml");

const POLL_YAML = existsSync(POLL_PATH) ? readFileSync(POLL_PATH, "utf-8") : "";
const CANARY_YAML = existsSync(CANARY_PATH)
  ? readFileSync(CANARY_PATH, "utf-8")
  : "";

// ── 1. Daily-native-poll has the three expected schedules ──

describe("daily-native-poll redundant schedules", () => {
  it("file exists", () => {
    expect(existsSync(POLL_PATH)).toBe(true);
  });

  it("declares the primary 07:00 UTC schedule", () => {
    expect(POLL_YAML).toMatch(/- cron:\s*"0 7 \* \* \*"/);
  });

  it("declares the backup 08:30 UTC schedule", () => {
    expect(POLL_YAML).toMatch(/- cron:\s*"30 8 \* \* \*"/);
  });

  it("declares the backup 10:00 UTC schedule", () => {
    expect(POLL_YAML).toMatch(/- cron:\s*"0 10 \* \* \*"/);
  });

  it("keeps workflow_dispatch for manual operator override", () => {
    expect(POLL_YAML).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });

  it("comments reference the redundant-schedule reliability rationale", () => {
    expect(POLL_YAML).toMatch(/redundant-schedule reliability/i);
  });

  it("comments reference the same-day skip safety property", () => {
    expect(POLL_YAML).toMatch(/UTC-day/);
    expect(POLL_YAML).toMatch(/skipped_already_ran_today/);
  });
});

// ── 2. Poll-canary has matching delayed schedules ──

describe("poll-canary redundant schedules", () => {
  it("file exists", () => {
    expect(existsSync(CANARY_PATH)).toBe(true);
  });

  it("declares the primary 07:45 UTC canary schedule", () => {
    expect(CANARY_YAML).toMatch(/- cron:\s*"45 7 \* \* \*"/);
  });

  it("declares the backup 09:15 UTC canary schedule", () => {
    expect(CANARY_YAML).toMatch(/- cron:\s*"15 9 \* \* \*"/);
  });

  it("declares the backup 10:45 UTC canary schedule", () => {
    expect(CANARY_YAML).toMatch(/- cron:\s*"45 10 \* \* \*"/);
  });

  it("keeps workflow_dispatch for manual operator override", () => {
    expect(CANARY_YAML).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });

  it("comments reference the redundant-schedule reliability rationale", () => {
    expect(CANARY_YAML).toMatch(/redundant-schedule reliability/i);
  });
});

// ── 3. Schedule alignment: each canary follows ~45 min after its poll ──

describe("schedule alignment between poll and canary", () => {
  it("primary canary fires 45 min after primary poll", () => {
    // Poll: 07:00 → canary: 07:45
    expect(POLL_YAML).toContain('"0 7 * * *"');
    expect(CANARY_YAML).toContain('"45 7 * * *"');
  });

  it("first backup canary fires 45 min after first backup poll", () => {
    // Poll: 08:30 → canary: 09:15
    expect(POLL_YAML).toContain('"30 8 * * *"');
    expect(CANARY_YAML).toContain('"15 9 * * *"');
  });

  it("second backup canary fires 45 min after second backup poll", () => {
    // Poll: 10:00 → canary: 10:45
    expect(POLL_YAML).toContain('"0 10 * * *"');
    expect(CANARY_YAML).toContain('"45 10 * * *"');
  });

  it("each workflow declares exactly 3 cron lines (no silent collapse)", () => {
    const pollCrons = (POLL_YAML.match(/- cron:\s*"[^"]+"/g) ?? []).length;
    const canaryCrons = (CANARY_YAML.match(/- cron:\s*"[^"]+"/g) ?? []).length;
    expect(pollCrons).toBe(3);
    expect(canaryCrons).toBe(3);
  });
});
