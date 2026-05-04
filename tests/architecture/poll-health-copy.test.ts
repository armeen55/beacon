/**
 * Architecture invariant — poll-health-block.tsx subline must
 * distinguish persistence-failure ("chunks completed but rows didn't
 * land") from API-key/rate-limit failure ("chunks themselves
 * reported failed"). Pure source-scan; no DB / render needed.
 *
 * Background (Bug-1, 2026-05-04):
 *
 * Pre-fix the only "failed" subline copy pointed at API keys + GitHub
 * Actions logs:
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
 * Both surfaces of the new copy reference persistence + schema +
 * GitHub Actions logs so the operator's first move is the right one.
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
    expect(SRC).toMatch(/persistence/i);
    expect(SRC).toMatch(/Supabase schema|dual-write logs/);
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

  it("retains the GitHub Actions logs reference (operator's existing diagnostic surface)", () => {
    // The new copy doesn't drop GitHub Actions — it just adds
    // persistence + schema as additional diagnostic targets.
    expect(SRC).toMatch(/GitHub Actions logs/);
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
