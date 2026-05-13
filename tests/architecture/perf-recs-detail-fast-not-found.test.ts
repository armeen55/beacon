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

  it("loads SOME variant of the rec queue and resolves the row via the resolver", () => {
    // After Emergency P0 v4 the detail page called the cached wrapper.
    // After Emergency P0 v5 (2026-05-12) it called the persisted fast
    // loader. After the 2026-05-13 P0 follow-up the page resolves the
    // row through `resolveRecommendationDetail` (four-step ladder:
    // exact → by edit id → by rec stable key → miss). Any of the
    // three loader names is acceptable here; the contract is that
    // SOME loader runs, the action rows are built, AND the resolver
    // is the seam through which the row is located.
    expect(stripped).toMatch(
      /(loadLiveRecommendationQueue(?:ForPage)?|loadPersistedRecommendationQueueForPage)\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
    expect(stripped).toMatch(/buildRecommendationActionRows\(/);
    expect(stripped).toMatch(
      /resolveRecommendationDetail\(\s*allRows\s*,\s*decodedId\s*\)/,
    );
  });

  it("returns the not-found component for an unknown decoded id and a `miss` resolution", () => {
    // Two not-found paths: bad id (didn't decode) and `miss` resolution
    // (decoded but no exact/edit/rec match found). Both must render
    // <RecommendationDetailNotFound /> (with an optional `hint` prop
    // populated by the resolver in the `miss` case).
    expect(stripped).toMatch(
      /if\s*\(\s*!decodedId\s*\)\s*\{[\s\S]*?return\s+<RecommendationDetailNotFound\s*\/>/,
    );
    expect(stripped).toMatch(
      /if\s*\(\s*resolution\.kind\s*===\s*"miss"\s*\)\s*\{[\s\S]*?return\s+<RecommendationDetailNotFound\s+hint=\{\s*resolution\.hint\s*\}\s*\/>/,
    );
  });

  it("redirects to the canonical URL when the resolver finds a fallback row (debugResolver suppresses the redirect)", () => {
    // The `redirect` branch must call Next.js's `redirect()` with the
    // resolved row id encoded for safe URL transport. The 2026-05-13
    // debug follow-up suppresses the redirect when `?debugResolver=1`
    // so the operator can see the diagnostic panel for the resolution
    // that would have fired the 307; the guard is now
    // `resolution.kind === "redirect" && !debugResolver`.
    expect(stripped).toMatch(
      /if\s*\(\s*resolution\.kind\s*===\s*"redirect"\s*&&\s*!debugResolver\s*\)/,
    );
    expect(stripped).toMatch(
      /redirect\(\s*`\/recommendations\/\$\{encodeRecommendationRouteId\(resolution\.row\.id\)\}`\s*,?\s*\)/,
    );
  });

  it("opts out of every cache layer that could serve a stale not-found payload", () => {
    // 2026-05-13 P0 — defense in depth against client Router Cache /
    // edge cache / browser HTTP cache serving a previous not-found
    // render to the operator's signed-in click. `dynamic =
    // "force-dynamic"` already implies revalidate=0, but the explicit
    // exports are pinned so a future Next default change can't break
    // the contract.
    expect(stripped).toMatch(
      /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/,
    );
    expect(stripped).toMatch(/export\s+const\s+revalidate\s*=\s*0/);
    expect(stripped).toMatch(
      /export\s+const\s+fetchCache\s*=\s*['"]force-no-store['"]/,
    );
    expect(stripped).toMatch(
      /import\s*\{\s*unstable_noStore[\s\S]{0,80}from\s+['"]next\/cache['"]/,
    );
    expect(stripped).toMatch(/\bnoStore\(\)/);
  });

  it("reads `searchParams.debugResolver === \"1\"` and threads the flag through every render branch", () => {
    expect(stripped).toMatch(
      /sp\.debugResolver\s*===\s*['"]1['"]/,
    );
    // The panel renders in three call sites: decode-failed branch,
    // miss branch, and a combined exact/redirect branch (one render
    // with a conditional in the `resolution` prop). Together those
    // cover all four resolver outcomes.
    const detailPanelCount = (
      stripped.match(/<DetailDebugPanel/g) ?? []
    ).length;
    expect(detailPanelCount).toBeGreaterThanOrEqual(3);
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

  it("uses calm 'replaced or already handled' wording instead of scary dead-end copy", () => {
    // 2026-05-13 P0 follow-up — the four-step resolver
    // (resolveRecommendationDetail) now handles the stale-URL case
    // by redirecting to a same-rec or same-edit-id replacement. This
    // not-found state only renders when no fallback exists, so the
    // copy reflects that: factual, calm, no "no longer active"
    // vocabulary that read as a dead end.
    expect(src).toContain(
      "This recommendation was replaced or already handled.",
    );
    expect(src).not.toContain("This recommendation is no longer active.");
    expect(src).not.toContain("This recommendation is no longer available.");
  });

  it("points to the current set on the main page", () => {
    expect(src).toContain(
      "The latest set of recommendations is on the main page.",
    );
  });

  it("keeps the 'Back to recommendations' CTA", () => {
    expect(src).toContain("Back to recommendations");
  });
});
