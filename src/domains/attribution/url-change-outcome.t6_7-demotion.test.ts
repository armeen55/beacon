/**
 * Trust Sprint Mini-Phase T6.7 (2026-05-06) — materializer demotion semantics.
 *
 * Pre-T6.7: `recordUrlOutcome` had a hard gate
 *   `if (!isTerminalVerdict(v.verdict)) return null;`
 *
 * That gate skipped:
 *   (a) FRESH inserts of pre-landing verdicts (too_early, not_enough_data,
 *       not_enough_native_baseline) — correct, avoids polluting the brain
 *       with "we don't have data yet" rows.
 *   (b) FRESH inserts of `weak_signal` (T5.2's directional tier) —
 *       INCORRECT, the brain wants to track directional signals.
 *   (c) UPDATES of existing terminal records when the recompute lands
 *       non-terminal (the demotion path) — INCORRECT, this is the
 *       T5.3 menlo-park-style drift where a row stayed `helping`
 *       even when T5.2's sparse-pre-window precondition fired.
 *
 * Post-T6.7:
 *   - FRESH inserts: `helping`, `hurting`, `nothing_yet`,
 *     `not_implemented`, `weak_signal` write a new row.
 *     `too_early`, `not_enough_data`, `not_enough_native_baseline`
 *     are still skipped.
 *   - EXISTING records: ANY recompute writes (allows demotion). The
 *     `materialChange` predicate fires on the verdict transition;
 *     `transitions` counter increments; `updated_at` refreshes.
 *
 * These tests verify the gate's NEW source-text contract via the
 * `FRESH_INSERT_VERDICTS` set and the gate logic in `recordUrlOutcome`.
 * The behavioral contract (existing helping → demoted to too_early on
 * recompute) is verified end-to-end on the Ritz fixture by running
 * `scripts/rematerialize-verdicts-t5.ts --apply` plus the integrity
 * check, reported in `docs/VERIFICATION_LOG.md`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const SRC = readFileSync(
  join(REPO_ROOT, "src/domains/attribution/url-change-outcome.ts"),
  "utf-8",
);

describe("T6.7 — materializer demotion semantics (source-text invariants)", () => {
  it("FRESH_INSERT_VERDICTS set is declared and includes weak_signal", () => {
    expect(/const FRESH_INSERT_VERDICTS:\s*ReadonlySet<VerdictLabel>/.test(SRC)).toBe(true);
    expect(/"weak_signal"/.test(SRC)).toBe(true);
    // Pin the full set membership — this catches accidental re-additions
    // of pre-landing verdicts that would re-pollute the store.
    const setBlock = SRC.match(
      /const FRESH_INSERT_VERDICTS[\s\S]*?\]\)/,
    )?.[0];
    expect(setBlock).toBeTruthy();
    if (setBlock) {
      expect(setBlock).toContain('"helping"');
      expect(setBlock).toContain('"hurting"');
      expect(setBlock).toContain('"nothing_yet"');
      expect(setBlock).toContain('"not_implemented"');
      expect(setBlock).toContain('"weak_signal"');
      // Negative assertions — these MUST NOT be in the set.
      expect(setBlock).not.toContain('"too_early"');
      expect(setBlock).not.toContain('"not_enough_data"');
      expect(setBlock).not.toContain('"not_enough_native_baseline"');
    }
  });

  it("recordUrlOutcome skips fresh inserts of non-FRESH_INSERT verdicts", () => {
    expect(
      /if\s*\(\s*existingIdx\s*===\s*-1\s*&&\s*!FRESH_INSERT_VERDICTS\.has\(v\.verdict\)\s*\)/.test(
        SRC,
      ),
      "recordUrlOutcome must skip when existingIdx === -1 AND verdict is not in FRESH_INSERT_VERDICTS — pin the gate's exact source-text shape against drift.",
    ).toBe(true);
  });

  it("recordUrlOutcome no longer has the legacy isTerminalVerdict-only gate", () => {
    // Pre-T6.7 the gate was `if (!isTerminalVerdict(v.verdict)) return null;`
    // sitting BEFORE the existingIdx lookup. T6.7 replaces it with the
    // existingIdx-aware gate. This negative invariant catches a future
    // regression where someone re-introduces the old single-line gate.
    expect(
      /^\s*if\s*\(\s*!isTerminalVerdict\(v\.verdict\)\s*\)\s*return\s+null;\s*$/m.test(
        SRC.split("export async function recordUrlOutcome")[1] ?? "",
      ),
    ).toBe(false);
  });

  it("isTerminalVerdict membership is unchanged (pre-landing verdicts stay non-terminal)", () => {
    // T6.7 deliberately does NOT promote pre-landing verdicts to terminal.
    // The fix is at the persistence gate, not the verdict taxonomy.
    const setBlock = SRC.match(/const TERMINAL_VERDICTS[\s\S]*?\]\)/)?.[0];
    expect(setBlock).toBeTruthy();
    if (setBlock) {
      expect(setBlock).toContain('"helping"');
      expect(setBlock).toContain('"hurting"');
      expect(setBlock).toContain('"nothing_yet"');
      expect(setBlock).toContain('"not_implemented"');
      expect(setBlock).not.toContain('"weak_signal"');
      expect(setBlock).not.toContain('"too_early"');
    }
  });

});
