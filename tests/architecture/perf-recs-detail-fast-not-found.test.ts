/**
 * Emergency P0 fix (2026-05-12) — source-level pin for the
 * `/recommendations/[id]` fast not-found path.
 *
 * Production trace measured `loadLiveRecommendationQueue` at
 * **15,566 ms** even for an unknown rec id. The slow path was
 * redundant: by the time a user lands on a stale URL, the rec is
 * almost certainly no longer in the live queue. Cheap existence
 * check against the two small tenant-scoped tables (`recommended_edits`,
 * `recommendation_responses`) lets us short-circuit to not-found in
 * <500 ms instead of waiting 15 s for the queue.
 *
 * Source-level pins to prevent regression:
 *   1. The cheap check runs BEFORE `loadLiveRecommendationQueue`.
 *   2. The check reads both `recommended_edits` and
 *      `recommendation_responses` in parallel.
 *   3. When neither table contains the stableKey extracted from the
 *      decoded route id, the page returns the not-found state
 *      WITHOUT calling `loadLiveRecommendationQueue`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Emergency P0: /recommendations/[id] fast not-found", () => {
  const src = read("src/app/(shell)/recommendations/[id]/page.tsx");
  const stripped = stripComments(src);

  it("computes the stableKey candidate by splitting the decoded id at '::'", () => {
    expect(stripped).toMatch(
      /const\s+firstDelimIdx\s*=\s*decodedId\.indexOf\(\s*["']::["']\s*\)/,
    );
    expect(stripped).toMatch(
      /const\s+stableKeyCandidate\s*=\s*firstDelimIdx\s*>=\s*0\s*\?\s*decodedId\.slice\(\s*0\s*,\s*firstDelimIdx\s*\)\s*:\s*decodedId/,
    );
  });

  it("runs the cheap existence check BEFORE loadLiveRecommendationQueue", () => {
    const cheapIdx = stripped.indexOf("cheap_existence_check");
    const queueIdx = stripped.indexOf("loadLiveRecommendationQueue(");
    expect(cheapIdx).toBeGreaterThan(0);
    expect(queueIdx).toBeGreaterThan(0);
    expect(cheapIdx).toBeLessThan(queueIdx);
  });

  it("reads BOTH recommended_edits and recommendation_responses in parallel", () => {
    // The cheap check must use Promise.all over the two repo calls.
    const cheapBlock = stripped.match(
      /cheap_existence_check[\s\S]*?Promise\.all\(\s*\[([\s\S]*?)\]\s*\)/,
    );
    expect(cheapBlock).not.toBeNull();
    const body = cheapBlock![1];
    expect(body).toMatch(/getRecommendedEdits\(\s*\)/);
    expect(body).toMatch(/getRecommendationResponses\(\s*\)/);
  });

  it("returns not-found when the stableKey is in NEITHER table — without calling the queue loader", () => {
    expect(stripped).toMatch(
      /if\s*\(\s*!knownStableKeys\.has\(\s*stableKeyCandidate\s*\)\s*\)/,
    );
    // The block returns the not-found component without first awaiting
    // the queue. Pin the structure: the if-block contains the return,
    // and the return comes BEFORE the next `loadLiveRecommendationQueue(`
    // call in source order.
    const guardIdx = stripped.indexOf(
      "if (!knownStableKeys.has(stableKeyCandidate))",
    );
    const queueIdx = stripped.indexOf("loadLiveRecommendationQueue(");
    expect(guardIdx).toBeGreaterThan(0);
    expect(queueIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeLessThan(queueIdx);
    // The guard block must contain a RecommendationDetailNotFound return.
    const guardEndApprox = stripped.indexOf("loadLiveRecommendationQueue(");
    const guardBlock = stripped.slice(guardIdx, guardEndApprox);
    expect(guardBlock).toMatch(/return\s+<RecommendationDetailNotFound\s*\/>/);
  });

  it("traces the cheap-check outcome label as `not_found_fast_path`", () => {
    expect(stripped).toMatch(
      /trace\.data\(\s*["']outcome["']\s*,\s*["']not_found_fast_path["']\s*\)/,
    );
  });
});

describe("Not-found copy: action-clear wording", () => {
  const src = read(
    "src/app/(shell)/recommendations/[id]/recommendation-detail-not-found.tsx",
  );

  it("uses the action-clear 'no longer active' wording, not the vague 'no longer available'", () => {
    expect(src).toContain("This recommendation is no longer active.");
    expect(src).not.toContain("This recommendation is no longer available.");
  });

  it("explains the cause in concrete terms (resolved/dismissed/replaced)", () => {
    expect(src).toContain("resolved, dismissed, or replaced");
  });

  it("keeps the 'Back to recommendations' CTA", () => {
    expect(src).toContain("Back to recommendations");
  });
});
