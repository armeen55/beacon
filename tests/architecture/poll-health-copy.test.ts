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

  it("explicitly distinguishes persistence failure from API failure", () => {
    // Bug-1 SHAPE: separate copy for persistence-failure branch.
    // Round 1 customer-readiness: "persistence" stays, but the
    // vendor names ("Supabase schema", "dual-write logs") are gone.
    expect(SRC).toMatch(/persistence/i);
    expect(SRC).toMatch(/persistence and daily-poll logs|persistence,\s*API keys,\s*and scheduled-job logs/);
    // Operator-locked phrasing: when chunks succeeded but no rows
    // landed, copy says "Poll ran but no observations were saved."
    expect(SRC).toMatch(
      /Poll ran but no observations were saved/i,
    );
  });

  it("references the operator-known schema/persistence failure mode in the copy", () => {
    // For the both-platforms-persistence-failure branch.
    expect(SRC).toMatch(
      /Poll ran but no observations were saved on either platform/,
    );
  });

  it("Round 1 — uses operator-readable 'scheduled-job logs' instead of 'GitHub Actions logs'", () => {
    // The Bug-1 copy named the CI provider explicitly. Round 1
    // customer-readiness audit replaced that with "scheduled-job
    // logs" so the operator copy doesn't expose internal vendor
    // choices. The old phrase MUST be gone.
    expect(/GitHub Actions logs/.test(SRC)).toBe(false);
    // The new phrase MUST be present.
    expect(SRC).toMatch(/scheduled-job logs/);
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
