/**
 * Emergency P0 v5 (2026-05-12) — source-level pin for the persisted-row
 * fast loader.
 *
 * After v4 (the cache wrapper), cold renders of /recommendations still
 * paid the full ~33 s pipeline because cache misses ran the canonical
 * seed → matrix → generate → resolve → adjudicate → prioritize
 * pipeline. For the v2 card surface, that pipeline is overkill — every
 * card the operator can act on is anchored on a persisted row in
 * `recommended_edits`. The fast loader reads only persisted tables in
 * parallel (4 small Supabase reads) and synthesizes minimal
 * `LiveRecQueueItem`s the existing `buildRecommendationActionRows`
 * builder can consume, producing the same `RecommendationActionRow[]`
 * shape the v2 client renders.
 *
 * Pinned:
 *   1. `load-queue.ts` exports `loadPersistedRecommendationQueueForPage`
 *      and reads only persisted small tables (recommended_edits,
 *      recommendation_responses, tracked_prompts, changelog_entries) —
 *      NEVER calls `loadFreshCanonicalData`, `buildPromptDecisionMatrix`,
 *      `generateRecommendations`, `resolvePageIntent`, or the
 *      adjudicator inside the cached body.
 *   2. The same TTL + tag invariants as v4's cached wrapper hold
 *      (60 s TTL, tenant-scoped `recs-queue:<tenantId>` tag).
 *   3. The `/recommendations` page calls the persisted loader when v2,
 *      and the full loader when legacy (`?legacy=1`).
 *   4. The `/recommendations/[id]` page calls the persisted loader
 *      unconditionally (detail brief reuses the v2 row shape).
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

describe("Emergency P0 v5: loadPersistedRecommendationQueueForPage", () => {
  const src = read("src/domains/recommendations/load-queue.ts");
  const stripped = stripComments(src);

  it("exports loadPersistedRecommendationQueueForPage", () => {
    expect(stripped).toMatch(
      /export\s+async\s+function\s+loadPersistedRecommendationQueueForPage\b/,
    );
  });

  it("uses unstable_cache with the same TTL constant + tenant tag", () => {
    // Find the persisted loader's body — slice between its name and the
    // next top-level `export` declaration.
    const startIdx = stripped.indexOf("loadPersistedRecommendationQueueForPage");
    expect(startIdx).toBeGreaterThan(-1);
    const tail = stripped.slice(startIdx);
    const endIdx = tail.indexOf("\nexport ");
    const body = endIdx > 0 ? tail.slice(0, endIdx) : tail;
    expect(body).toMatch(/unstable_cache/);
    expect(body).toMatch(/revalidate\s*:\s*REC_QUEUE_CACHE_TTL_SECONDS/);
    expect(body).toMatch(/tags\s*:\s*\[\s*buildRecQueueCacheTag\(\s*tenantId\s*\)\s*\]/);
  });

  it("uses a distinct cache key from the full-pipeline cached wrapper", () => {
    // v4 uses ["recs-queue:v1", tenantId]; v5 uses a distinct key so the
    // two cached layers don't collide.
    expect(stripped).toMatch(/\["recs-persisted:v1",\s*tenantId\]/);
  });

  it("does NOT call the heavy pipeline functions inside the cached body", () => {
    // Pin that the persisted loader is genuinely fast — no canonical
    // seed / matrix build / generate / adjudicator / prioritize calls.
    // We scope the check to the function body to avoid false positives
    // from the same function names being mentioned elsewhere in the
    // file (e.g., inside loadLiveRecommendationQueue).
    const startIdx = stripped.indexOf("loadPersistedRecommendationQueueForPage");
    const tail = stripped.slice(startIdx);
    const endIdx = tail.indexOf("\nexport ");
    const body = endIdx > 0 ? tail.slice(0, endIdx) : tail;
    expect(body).not.toMatch(/\bloadFreshCanonicalData\(/);
    expect(body).not.toMatch(/\bbuildPromptDecisionMatrix\(/);
    expect(body).not.toMatch(/\bgenerateRecommendations\(/);
    expect(body).not.toMatch(/\bresolvePageIntent\(/);
    expect(body).not.toMatch(/\badjudicateFromCacheOnly\(/);
    expect(body).not.toMatch(/\bprioritizeRecommendations\(/);
    expect(body).not.toMatch(/\bbuildPageInventory\(/);
  });

  it("reads exactly the four persisted tables in parallel", () => {
    const startIdx = stripped.indexOf("loadPersistedRecommendationQueueForPage");
    const tail = stripped.slice(startIdx);
    const endIdx = tail.indexOf("\nexport ");
    const body = endIdx > 0 ? tail.slice(0, endIdx) : tail;
    expect(body).toMatch(/getRecommendedEdits\(\)/);
    expect(body).toMatch(/getRecommendationResponses\(\)/);
    expect(body).toMatch(/getTrackedPrompts\(\)/);
    expect(body).toMatch(/getChangelogEntries\(\)/);
    expect(body).toMatch(/Promise\.all\(/);
  });
});

describe("Emergency P0 v5: /recommendations uses the persisted fast loader", () => {
  const src = read("src/app/(shell)/recommendations/page.tsx");
  const stripped = stripComments(src);

  it("calls loadPersistedRecommendationQueueForPage (the fast loader)", () => {
    // Surface collapse (2026-06-15): /recommendations is V2-only — the
    // `if (useV2)` switcher + the legacy `loadLiveRecommendationQueueForPage`
    // 30 s cold-path were removed. The persisted fast loader is now the
    // only data path.
    expect(stripped).toMatch(
      /loadPersistedRecommendationQueueForPage\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
  });

  it("no longer imports or calls the legacy live pipeline loader", () => {
    expect(stripped).not.toMatch(/loadLiveRecommendationQueueForPage/);
  });
});

describe("Emergency P0 v5: /recommendations/[id] uses the fast loader", () => {
  it("detail page imports + calls loadPersistedRecommendationQueueForPage", () => {
    const src = read("src/app/(shell)/recommendations/[id]/page.tsx");
    const stripped = stripComments(src);
    expect(stripped).toMatch(
      /import\s+\{[\s\S]*?\bloadPersistedRecommendationQueueForPage\b[\s\S]*?\}\s+from\s+["']@\/domains\/recommendations\/load-queue["']/,
    );
    expect(stripped).toMatch(
      /loadPersistedRecommendationQueueForPage\(\s*\{\s*tenantId\s*\}\s*\)/,
    );
  });
});
