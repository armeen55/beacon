/**
 * Architecture invariants — Poll Integrity Hardening (post May 2-4 incident).
 *
 * Pure source-scan; no DB / network. Pins the operator's R1-R6 contract
 * on the actual code so a future regression that re-introduces the
 * silent-failure pattern fails CI before it ships.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN_POLL_SRC = readFileSync(
  resolve(__dirname, "../../src/domains/observations/run-poll.ts"),
  "utf-8",
);
const POLL_INTEGRITY_SRC = readFileSync(
  resolve(__dirname, "../../src/domains/observations/poll-integrity.ts"),
  "utf-8",
);
const DAILY_POLL_WORKFLOW = readFileSync(
  resolve(__dirname, "../../.github/workflows/daily-native-poll.yml"),
  "utf-8",
);
const CANARY_WORKFLOW = readFileSync(
  resolve(__dirname, "../../.github/workflows/poll-canary.yml"),
  "utf-8",
);
const CANARY_SCRIPT = readFileSync(
  resolve(__dirname, "../../scripts/canary-persistence-write.ts"),
  "utf-8",
);
const DUAL_WRITE_SRC = readFileSync(
  resolve(__dirname, "../../src/lib/persistence/dual-write.ts"),
  "utf-8",
);

describe("R1 — observation run state machine", () => {
  it("run-poll exports PollIntegritySubStatuses with the operator-mandated 5 sub-statuses", () => {
    expect(RUN_POLL_SRC).toMatch(/export type PollIntegritySubStatuses/);
    for (const flag of [
      "provider_completed",
      "raw_saved",
      "observations_persisted",
      "snapshots_derived",
      "verified_complete",
    ]) {
      expect(RUN_POLL_SRC).toMatch(new RegExp(`${flag}: boolean`));
    }
  });

  it("native poll status enum includes 'skipped_persistence_failure_gate' (Operator R6)", () => {
    expect(RUN_POLL_SRC).toMatch(/"skipped_persistence_failure_gate"/);
  });
});

describe("R2 — paid-call reconciliation guards", () => {
  it("reconcilePolledRun checks cost>0 + persisted=0 (silent-failure signature)", () => {
    expect(POLL_INTEGRITY_SRC).toMatch(/Paid call cost \$/);
    expect(POLL_INTEGRITY_SRC).toMatch(/ZERO observations persisted/);
    expect(POLL_INTEGRITY_SRC).toMatch(/silent-write-failure pattern/);
    expect(POLL_INTEGRITY_SRC).toMatch(/May 2-4 incident class/);
  });

  it("reconcilePolledRun checks expectedObsCount>0 + persisted=0", () => {
    expect(POLL_INTEGRITY_SRC).toMatch(
      /Reported \$\{expectedObsCount\} prompts polled but ZERO observations persisted/,
    );
  });

  it("reconcilePolledRun checks completed-but-missing partial persistence", () => {
    expect(POLL_INTEGRITY_SRC).toMatch(
      /Run reported \$\{expectedObsCount\} prompts but only \$\{persisted\} observations persisted/,
    );
  });

  it("run-poll throws when reconciliation fails (so /api/poll/run returns 5xx)", () => {
    expect(RUN_POLL_SRC).toMatch(
      /PERSISTENCE RECONCILIATION FAILED for run=/,
    );
    expect(RUN_POLL_SRC).toMatch(/throw new Error\(/);
  });

  it("run-poll's success-path observationsWritten reads from DB truth, not provider claim", () => {
    // The summarize block uses verdict.persistedObsCount, not
    // result.observations.length.
    const start = RUN_POLL_SRC.indexOf("// ── Summarize ──");
    const slice = RUN_POLL_SRC.slice(start);
    expect(slice).toMatch(/observationsWritten:\s*verdict\.persistedObsCount/);
  });
});

describe("R3 — raw-response safety net", () => {
  it("dual-write exports syncRawPollChunk that THROWS on any error", () => {
    expect(DUAL_WRITE_SRC).toMatch(
      /export async function syncRawPollChunk/,
    );
    // The function MUST throw — silent-fail here would defeat the safety net.
    expect(DUAL_WRITE_SRC).toMatch(/\[syncRawPollChunk\] upsert failed/);
    expect(DUAL_WRITE_SRC).toMatch(/throw new Error/);
  });

  it("dual-write exports stampRawPollChunkReconciliation for post-pipeline status", () => {
    expect(DUAL_WRITE_SRC).toMatch(
      /export async function stampRawPollChunkReconciliation/,
    );
    // The 4 reconciliation enum values per the migration COMMENT ON COLUMN.
    for (const status of [
      "verified_complete",
      "persistence_mismatch",
      "observation_upsert_threw",
      "snapshot_derivation_failed",
    ]) {
      expect(DUAL_WRITE_SRC).toMatch(new RegExp(`"${status}"`));
    }
  });

  it("run-poll writes the raw chunk BEFORE syncObs (the safety net IS the safety net)", () => {
    const rawIdx = RUN_POLL_SRC.indexOf("await syncRawChunk(rawChunkRow)");
    const obsIdx = RUN_POLL_SRC.indexOf("await syncObs(result.observations");
    expect(rawIdx).toBeGreaterThan(0);
    expect(obsIdx).toBeGreaterThan(0);
    expect(rawIdx).toBeLessThan(obsIdx);
  });

  it("run-poll's raw chunk row carries minimum fields needed for recovery", () => {
    // Bare-minimum fields the migration's table accepts.
    const start = RUN_POLL_SRC.indexOf("const rawChunkRow:");
    const end = RUN_POLL_SRC.indexOf("await syncRawChunk(rawChunkRow)");
    const block = RUN_POLL_SRC.slice(start, end);
    for (const f of [
      "run_id:",
      "tenant_id:",
      "platform:",
      // `source` may be shorthand (`source,`) or explicit (`source:`).
      "source",
      "chunk_offset:",
      "chunk_limit:",
      "prompt_count:",
      "prompt_ids:",
      "raw_response:",
      "cost_usd:",
    ]) {
      expect(block).toMatch(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("R4 — GitHub Actions verify-persistence step", () => {
  it("daily-native-poll workflow has a verify-persistence job that runs always", () => {
    expect(DAILY_POLL_WORKFLOW).toMatch(/verify-persistence:/);
    expect(DAILY_POLL_WORKFLOW).toMatch(
      /Verify persistence \(Operator R4 contract\)/,
    );
    // if: always() so partial chunk failures still verify.
    const start = DAILY_POLL_WORKFLOW.indexOf("verify-persistence:");
    const slice = DAILY_POLL_WORKFLOW.slice(start);
    expect(slice).toMatch(/if:\s*always\(\)/);
  });

  it("verify-persistence step runs check-yesterday-poll.ts (the canary script)", () => {
    expect(DAILY_POLL_WORKFLOW).toMatch(/scripts\/check-yesterday-poll\.ts/);
  });

  it("verify-persistence step depends on both poll jobs + the index rebuild", () => {
    const start = DAILY_POLL_WORKFLOW.indexOf("verify-persistence:");
    const slice = DAILY_POLL_WORKFLOW.slice(start);
    expect(slice).toMatch(/needs:\s*\[poll-perplexity,\s*poll-openai/);
  });
});

describe("R5 — canary verifies persistence end-to-end", () => {
  it("canary script writes through the production dual-write path", () => {
    expect(CANARY_SCRIPT).toMatch(/syncPromptAnswerObservations/);
    expect(CANARY_SCRIPT).toMatch(/syncDailyMetricSnapshots/);
  });

  it("canary script READS BACK the rows to verify they actually landed", () => {
    expect(CANARY_SCRIPT).toMatch(/observation upsert succeeded silently but row not in Supabase/);
    expect(CANARY_SCRIPT).toMatch(/snapshot upsert succeeded silently but row not in Supabase/);
  });

  it("canary script CLEANS UP its rows (no metric pollution)", () => {
    expect(CANARY_SCRIPT).toMatch(/tryDeleteRow.*prompt_answer_observations/);
    expect(CANARY_SCRIPT).toMatch(/tryDeleteRow.*daily_metric_snapshots/);
  });

  it("canary writes competitor_descriptor_windows so future column-drift fails LOUD here", () => {
    expect(CANARY_SCRIPT).toMatch(/competitor_descriptor_windows:\s*\{/);
  });

  it("canary tags rows with metadata.canary:true so consumers can filter", () => {
    expect(CANARY_SCRIPT).toMatch(/canary:\s*true/);
  });

  it("poll-canary workflow runs the persistence-write canary AFTER check-yesterday-poll", () => {
    expect(CANARY_WORKFLOW).toMatch(/canary-persistence-write\.ts/);
    // Both steps must exist in the canary workflow.
    expect(CANARY_WORKFLOW).toMatch(/check-yesterday-poll\.ts/);
  });
});

describe("R6 — auto-disable on persistence failure", () => {
  it("checkPersistenceGate is the gate function, blocks when latest run failed persistence", () => {
    expect(POLL_INTEGRITY_SRC).toMatch(
      /export async function checkPersistenceGate/,
    );
    expect(POLL_INTEGRITY_SRC).toMatch(/scope_label\.includes\(["']PERSISTENCE FAILED["']\)/);
  });

  it("run-poll calls the gate BEFORE the budget guard (skips paid call entirely)", () => {
    const gateIdx = RUN_POLL_SRC.indexOf("await checkGate(");
    const adapterIdx = RUN_POLL_SRC.indexOf("await runAdapter(");
    expect(gateIdx).toBeGreaterThan(0);
    expect(adapterIdx).toBeGreaterThan(0);
    expect(gateIdx).toBeLessThan(adapterIdx);
  });

  it("gate honors force=true (operator manual override stays available)", () => {
    const start = RUN_POLL_SRC.indexOf("// ── Persistence-failure gate");
    const slice = RUN_POLL_SRC.slice(start, start + 1500);
    // The gate is wrapped in `if (!force)`.
    expect(slice).toMatch(/if \(!force\)\s*\{/);
  });

  it("gate-blocked runs return a SPECIFIC status, not the generic 'skipped' codes", () => {
    expect(RUN_POLL_SRC).toMatch(/status:\s*"skipped_persistence_failure_gate"/);
  });
});

describe("Operator-mandated test invariants — no green 'complete' status without persisted observations", () => {
  it("the success-path observationsWritten field is sourced from verdict.persistedObsCount", () => {
    const start = RUN_POLL_SRC.indexOf("// ── Summarize ──");
    const slice = RUN_POLL_SRC.slice(start);
    expect(slice).toMatch(/observationsWritten:\s*verdict\.persistedObsCount/);
    // The cost estimate is also recomputed from DB truth, not provider claim.
    expect(slice).toMatch(/verdict\.persistedObsCount\s*\*\s*costRate/);
  });

  it("dual-write throws on persistent error (Bug-1 fix preserved)", () => {
    // No DATA_SOURCE conditional gate around throws.
    expect(DUAL_WRITE_SRC).not.toMatch(
      /if\s*\(\s*process\.env\.DATA_SOURCE\s*===\s*"supabase"\s*\)\s*\{[\s\S]*?throw/,
    );
  });
});
