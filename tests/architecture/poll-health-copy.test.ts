/**
 * Architecture invariant — poll-health-block.tsx subline must
 * distinguish persistence-failure ("chunks completed but rows didn't
 * land") from API-key/rate-limit failure ("chunks themselves
 * reported failed"). Pure source-scan; no DB / render needed.
 *
 * Background (Bug-1, 2026-05-04):
 *
 * Pre-Bug-1 the only "failed" subline copy pointed at API keys + CI
 * logs:
 *
 *   "Both platforms failed — check API keys and GitHub Actions logs."
 *
 * That was misleading once the dual-write throw fix landed, because
 * a "failed" verdict can now mean EITHER:
 *   (a) API call failure (key wrong, rate-limited, network)
 *   (b) Persistence failure (chunks completed but no rows landed —
 *       e.g. the schema-cache PGRST204 error during the May 2-4
 *       silent-failure window)
 *
 * Bug-1's split was preserved AT THE SHAPE level (different copy for
 * each branch); the SPECIFIC vendor names were customer-readiness
 * leaks and are no longer required.
 *
 * Round 1 customer-readiness update (2026-05-06):
 *
 * Operator audit found that "Supabase schema", "dual-write logs",
 * and "GitHub Actions logs" — all internal infrastructure names —
 * were leaking into operator-facing poll-failure messages. The
 * Round 1 fix replaced them with operator-readable phrases:
 *
 *   Supabase schema / dual-write logs → "persistence" + "daily-poll logs"
 *   GitHub Actions logs               → "scheduled-job logs"
 *
 * The Bug-1 SHAPE (persistence-failure branch vs API-failure branch)
 * stays intact. Only the vendor names are gone. This file's
 * assertions were updated to match the new contract — the customer-
 * readiness invariant lives in
 * `tests/architecture/customer-readiness-round-1.test.ts` and is
 * authoritative for what's allowed in operator-facing poll copy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../src/components/today/poll-health-block.tsx"),
  "utf-8",
);

describe("poll-health-block subline — Bug-1 distinguishes persistence-failure", () => {
  it("source no longer carries the misleading 'check API keys and GitHub Actions logs.' phrasing as the SOLE failed-state copy", () => {
    // Pre-fix: this exact line was the both-platforms-failed copy.
    // Post-fix: the copy now branches on persistence-vs-API. The old
    // single line should not be the only failed-state subline.
    const occurrences = (
      SRC.match(/check API keys and GitHub Actions logs/g) ?? []
    ).length;
    expect(occurrences).toBe(0);
  });

  it("Phase C #8 (2026-05-06) — failure subline uses customer-friendly reassurance, no on-call runbook copy", () => {
    // 2026-05-06 Phase C #8 supersedes the Round 1 + Bug-1 internal
    // distinction. Per operator brief: "Failure copy should not read
    // like on-call infrastructure instructions." Customer copy now:
    //   - "AI tracking didn't run today" / "didn't fully complete"
    //   - "Beacon is still using the valid responses that landed"
    // The Bug-1 SHAPE (isPersistenceFailure helper) is preserved on
    // the data side; just no longer surfaced as customer copy.
    expect(SRC).toMatch(/AI tracking didn't run/i);
    expect(SRC).toMatch(/still using the valid responses/i);
    // The distinction helper still exists (covered by isPersistenceFailure
    // detector test below); customer-facing copy intentionally NO LONGER
    // splits persistence vs API in the rendered subline.
  });

  it("Phase C #8 — no 'Poll ran but no observations were saved' line in customer copy", () => {
    // The Bug-1 / Round-1 copy explicitly said "Poll ran but no
    // observations were saved on either platform" — that's still
    // operator runbook copy. Phase C #8 replaced it with the
    // customer-friendly form. Pin the absence.
    expect(SRC).not.toMatch(/Poll ran but no observations were saved/i);
  });

  it("no vendor / infra leaks: 'GitHub Actions logs' / 'Supabase schema' / 'dual-write logs' all gone", () => {
    // These three vendor leaks were the original Bug-1 / Round 1 fix
    // targets. They must remain absent.
    expect(/GitHub Actions logs/.test(SRC)).toBe(false);
    expect(/Supabase schema/.test(SRC)).toBe(false);
    expect(/dual-write logs/.test(SRC)).toBe(false);
  });

  it("the persistence-failure detector uses the right shape (chunks completed + zero rows)", () => {
    // The detection helper checks:
    //   p.status === "failed" && p.failedChunks === 0 &&
    //   p.completedChunks > 0 && p.observationsWritten === 0
    expect(SRC).toMatch(/isPersistenceFailure/);
    expect(SRC).toMatch(/p\.failedChunks\s*===\s*0/);
    expect(SRC).toMatch(/p\.completedChunks\s*>\s*0/);
    expect(SRC).toMatch(/p\.observationsWritten\s*===\s*0/);
  });

  it("the inline rationale explicitly references Bug-1 + 2026-05-04", () => {
    expect(SRC).toMatch(/Bug-1/);
    expect(SRC).toMatch(/2026-05-04/);
  });
});
