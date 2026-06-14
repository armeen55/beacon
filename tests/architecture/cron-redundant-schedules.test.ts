/**
 * Architecture test — daily-native-poll + poll-canary are NO-CRON / on-demand.
 *
 * 2026-06-15: the operator disabled ALL GitHub Actions (out of minutes) and
 * does not want nightly crons. The `schedule:` triggers were removed from
 * every cron workflow (only `workflow_dispatch` remains); all 6 workflows are
 * also `disabled_manually` on the live repo. Data refresh is on-demand
 * (in-app Sync/Refresh actions + manual dispatch).
 *
 * This ratchet now pins the OPPOSITE of the old redundant-schedule contract:
 * the poll + canary workflows must NOT declare any cron schedule, must keep
 * workflow_dispatch, and must carry the on-demand rationale comment so a
 * future edit can't silently re-introduce a nightly minute burn. (Re-adding a
 * `schedule:` block is a deliberate decision that should also flip this test.)
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

// ── 1. Daily-native-poll: no cron, on-demand only ──

describe("daily-native-poll — crons removed (on-demand only)", () => {
  it("file exists", () => {
    expect(existsSync(POLL_PATH)).toBe(true);
  });

  it("declares NO cron schedule (nightly minute burn removed)", () => {
    expect(POLL_YAML).not.toMatch(/-\s*cron:\s*"/);
    expect(POLL_YAML).not.toMatch(/^\s*schedule:\s*$/m);
  });

  it("keeps workflow_dispatch for manual/on-demand runs", () => {
    expect(POLL_YAML).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });

  it("comment documents the on-demand / no-cron rationale", () => {
    expect(POLL_YAML).toMatch(/on-demand/i);
    expect(POLL_YAML).toMatch(/cron/i);
  });
});

// ── 2. Poll-canary: no cron, on-demand only ──

describe("poll-canary — crons removed (on-demand only)", () => {
  it("file exists", () => {
    expect(existsSync(CANARY_PATH)).toBe(true);
  });

  it("declares NO cron schedule", () => {
    expect(CANARY_YAML).not.toMatch(/-\s*cron:\s*"/);
    expect(CANARY_YAML).not.toMatch(/^\s*schedule:\s*$/m);
  });

  it("keeps workflow_dispatch for manual/on-demand runs", () => {
    expect(CANARY_YAML).toMatch(/^\s*workflow_dispatch:\s*$/m);
  });
});

// ── Budget-ledger dual-write env wiring (2026-05-10 fix) ──
//
// The poll STEPS are unchanged by the cron removal — only the `on:` trigger
// block changed — so these env-wiring ratchets still hold: the Stage B.2
// dual-write writer reads `process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE`, and
// the poll steps must pass it from secrets. (If/when the poll is ever run
// only on-demand via the in-app action, these GH-step assertions stay valid
// for the manual workflow_dispatch path.)

describe("budget-ledger dual-write env wiring", () => {
  it("Perplexity poll step references BEACON_BUDGET_LEDGER_DUAL_WRITE from secrets", () => {
    expect(POLL_YAML).toMatch(
      /Run Perplexity poll[\s\S]+?BEACON_BUDGET_LEDGER_DUAL_WRITE:\s*\$\{\{\s*secrets\.BEACON_BUDGET_LEDGER_DUAL_WRITE\s*\}\}/,
    );
  });

  it("ChatGPT/OpenAI poll step references BEACON_BUDGET_LEDGER_DUAL_WRITE from secrets", () => {
    expect(POLL_YAML).toMatch(
      /Run ChatGPT poll[\s\S]+?BEACON_BUDGET_LEDGER_DUAL_WRITE:\s*\$\{\{\s*secrets\.BEACON_BUDGET_LEDGER_DUAL_WRITE\s*\}\}/,
    );
  });

  it("does NOT wire the active enforcement flags yet (B.4 / B.5 not landed)", () => {
    expect(POLL_YAML).not.toContain("BEACON_BUDGET_ENFORCE_SHADOW");
    expect(POLL_YAML).not.toContain("BEACON_BUDGET_ENFORCE");
  });

  it("the BEACON_BUDGET_LEDGER_DUAL_WRITE secret reference appears exactly twice (one per provider step)", () => {
    const matches =
      POLL_YAML.match(
        /BEACON_BUDGET_LEDGER_DUAL_WRITE:\s*\$\{\{\s*secrets\.BEACON_BUDGET_LEDGER_DUAL_WRITE\s*\}\}/g,
      ) ?? [];
    expect(matches.length).toBe(2);
  });
});
