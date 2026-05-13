/**
 * Emergency P0 fix v2 (2026-05-12) — source-level pin for the
 * `/recommendations/[id]` fast path.
 *
 * The first attempt at this fix introduced a "cheap existence check"
 * that compared `stableKey ∈ recommended_edits ∪ recommendation_responses`
 * before loading the live queue. The check had a false-positive: the
 * `buildRecommendationActionRows` generator emits THREE rec-id shapes,
 * but only one of them lives in `recommended_edits`:
 *
 *   1. `${stableKey}::${edit.id}`        — edit-backed (IS in `recommended_edits`)
 *   2. `${stableKey}::faq-pair::${hash}` — synthesized (NOT in `recommended_edits`)
 *   3. `${stableKey}::${metaKind}`        — synthesized (NOT in `recommended_edits`)
 *
 * Shapes (2) and (3) are live v2 cards the customer can click — and
 * the cheap check returned not-found for them. Bug.
 *
 * The actual fix has two parts:
 *   - Restore the queue-load on the detail page (guarantees correctness
 *     for all three id shapes).
 *   - Apply `prefetch={false}` to every list→detail Link in the v2
 *     card stack, eliminating the prefetch storm that was making the
 *     15 s cost compound (14 cards × 15 s = function/connection pool
 *     exhaustion). The 15 s cost is now only paid on actual user clicks,
 *     not on every render of `/recommendations`.
 *
 * Source-level pins to prevent regression:
 *   1. The detail page does NOT carry the discredited cheap-check
 *      (no `not_found_fast_path` outcome, no `knownStableKeys`).
 *   2. The detail page calls `loadLiveRecommendationQueue` and locates
 *      the row via `buildRecommendationActionRows(...).find(r => r.id === ...)`.
 *   3. The v2 recommendation card's `/recommendations/[id]` Link uses
 *      `prefetch={false}` — the storm-elimination half of the fix.
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

describe("Emergency P0 v2: /recommendations/[id] no cheap-check", () => {
  const src = read("src/app/(shell)/recommendations/[id]/page.tsx");
  const stripped = stripComments(src);

  it("does NOT carry the discredited cheap-existence check", () => {
    // The cheap check produced false-positives on FAQ-pair and meta-card
    // rec ids. Pin its absence so it doesn't get reintroduced.
    expect(stripped).not.toMatch(/cheap_existence_check/);
    expect(stripped).not.toMatch(/knownStableKeys/);
    expect(stripped).not.toMatch(/not_found_fast_path/);
  });

  it("loads SOME variant of the rec queue and locates the row by route id", () => {
    // After Emergency P0 v4 the detail page called the cached wrapper.
    // After Emergency P0 v5 (2026-05-12) it calls the persisted fast
    // loader (`loadPersistedRecommendationQueueForPage`) for ~500 ms
    // cold renders. Either of the three names is acceptable here;
    // the contract is that SOME variant of the queue loader runs and
    // the row is found by id from the action-row build.
    expect(stripped).toMatch(
      /(loadLiveRecommendationQueue(?:ForPage)?|loadPersistedRecommendationQueueForPage)\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
    expect(stripped).toMatch(/buildRecommendationActionRows\(/);
    expect(stripped).toMatch(/allRows\.find\(\s*\(r\)\s*=>\s*r\.id\s*===\s*decodedId\s*\)/);
  });

  it("returns the not-found component for an unknown decoded id", () => {
    // Two not-found paths: bad id (didn't decode) and unknown id (decoded
    // but no row matched in the live queue). Both must render
    // <RecommendationDetailNotFound />.
    expect(stripped).toMatch(/if\s*\(\s*!decodedId\s*\)\s*\{[\s\S]*?return\s+<RecommendationDetailNotFound\s*\/>/);
    expect(stripped).toMatch(/if\s*\(\s*!row\s*\)\s*\{[\s\S]*?return\s+<RecommendationDetailNotFound\s*\/>/);
  });
});

describe("Emergency P0 v2: list→detail prefetch storm prevention", () => {
  it("v2 recommendation card uses prefetch={false} on its detail Link", () => {
    const src = read(
      "src/components/recommendations/v2/recommendation-v2-card.tsx",
    );
    // The card renders a Link to /recommendations/[id] (the "Review" CTA).
    // Default Next prefetch made /recommendations spawn 14+ simultaneous
    // detail loads on render — each ~15 s — which overwhelmed Vercel
    // function concurrency. Pin prefetch={false} on the detail Link.
    expect(src).toMatch(/<Link[\s\S]*?\bprefetch=\{false\}/);
  });

  it("v2 working rail uses prefetch={false} on its detail Links", () => {
    const src = read(
      "src/components/recommendations/v2/recommendations-v2-working-rail.tsx",
    );
    // The Working rail renders up to 5 in-flight rec links — same
    // prefetch-storm exposure as the card stack.
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
  });

  it("v2 changes card uses prefetch={false} on its detail Link", () => {
    const src = read("src/components/changes/v2/changes-v2-card.tsx");
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
  });

  it("v2 changes waiting rail uses prefetch={false} on its detail Links", () => {
    const src = read(
      "src/components/changes/v2/changes-v2-waiting-rail.tsx",
    );
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
  });

  it("v2 prompts card uses prefetch={false} on its detail Link", () => {
    const src = read("src/components/prompts/v2/prompts-v2-card.tsx");
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
  });

  it("today primary action uses prefetch={false} on its /changes/[id] Link", () => {
    const src = read("src/components/today/today-primary-action.tsx");
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
  });

  it("today action card uses prefetch={false} on its /changes/[id] Link", () => {
    const src = read("src/components/today/action-card.tsx");
    expect(src).toMatch(/<Link[\s\S]*?prefetch=\{false\}/);
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
