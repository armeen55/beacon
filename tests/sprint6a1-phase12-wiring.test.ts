import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 12 — UI surfacing + Accept fan-out wiring tests.
//
// Three layers:
//   1. /recommendations page reads recommended_edits FRESH per request,
//      groups by rec_id, decorates each rec row with its edits slice,
//      and gracefully degrades if the read fails.
//   2. recommendations-client renders a Specific edits (N) section and
//      updates the Accept button copy to "Accept — track N edits".
//   3. accept action fans out to N changelog entries when edits exist,
//      stamping action_type + target_element_key + source_rec_id, and
//      preserves the legacy single-entry path when no edits exist.
// ---------------------------------------------------------------------------

const PAGE_PATH = resolve(
  __dirname,
  "../src/app/(shell)/recommendations/page.tsx",
);
const PAGE_SOURCE = readFileSync(PAGE_PATH, "utf8");

const LOAD_QUEUE_PATH = resolve(
  __dirname,
  "../src/domains/recommendations/load-queue.ts",
);
const LOAD_QUEUE_SOURCE = readFileSync(LOAD_QUEUE_PATH, "utf8");

const REPO_TYPES_PATH = resolve(
  __dirname,
  "../src/lib/persistence/repositories/types.ts",
);
const REPO_TYPES_SOURCE = readFileSync(REPO_TYPES_PATH, "utf8");

const FILE_BACKEND_PATH = resolve(
  __dirname,
  "../src/lib/persistence/repositories/file-backend.ts",
);
const FILE_BACKEND_SOURCE = readFileSync(FILE_BACKEND_PATH, "utf8");

const SUPABASE_BACKEND_PATH = resolve(
  __dirname,
  "../src/lib/persistence/repositories/supabase-backend.ts",
);
const SUPABASE_BACKEND_SOURCE = readFileSync(SUPABASE_BACKEND_PATH, "utf8");

const CHANGELOG_TYPES_PATH = resolve(
  __dirname,
  "../src/domains/changelog/types.ts",
);
const CHANGELOG_TYPES_SOURCE = readFileSync(CHANGELOG_TYPES_PATH, "utf8");

// ── 1. Repository wiring — getRecommendedEdits ────────────────────────────

describe("Phase 6A.1.12 — repository getRecommendedEdits", () => {
  it("interface declares getRecommendedEdits()", () => {
    expect(REPO_TYPES_SOURCE).toMatch(
      /getRecommendedEdits\(\):\s*Promise<RecommendedEditRow\[\]>/,
    );
  });

  it("file backend implements getRecommendedEdits via .data/recommended-edits.json", () => {
    expect(FILE_BACKEND_SOURCE).toMatch(/getRecommendedEdits/);
    expect(FILE_BACKEND_SOURCE).toMatch(
      /readDotDataJson<RecommendedEditRow\[\]>\(\s*["']recommended-edits["']/,
    );
  });

  it("supabase backend implements getRecommendedEdits against the recommended_edits table", () => {
    expect(SUPABASE_BACKEND_SOURCE).toMatch(/getRecommendedEdits/);
    expect(SUPABASE_BACKEND_SOURCE).toMatch(
      /\.from\(\s*["']recommended_edits["']/,
    );
  });
});

// ── 2. /recommendations page wiring ───────────────────────────────────────

describe("Phase 6A.1.12 — /recommendations page wiring", () => {
  it("index redirects to Changes; the RecommendedEditRow type lives in the loader", () => {
    // Move 5 (2026-07-01): the /recommendations index is now a redirect to
    // /changes?status=ready. The RecommendedEditRow-typed queue rows moved to
    // the load-queue loader, which still powers /recommendations/[id] + /changes.
    expect(PAGE_SOURCE).toMatch(/\bredirect\(/);
    expect(LOAD_QUEUE_SOURCE).toMatch(/RecommendedEditRow/);
  });

  it("calls getRecommendedEdits via the repository, NOT a module-level array", () => {
    // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound read.
    // W3 Step 3.3 (2026-05-01) — read MOVED into the loader so
    // engineConfidence can be stamped server-side once. Page.tsx
    // consumes via `live.recommendedEdits` instead of re-fetching.
    // The repository read invariant still holds; it's just relocated.
    expect(LOAD_QUEUE_SOURCE).toMatch(
      /getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/,
    );
    // Page.tsx must NOT re-fetch edits — single source of truth.
    expect(PAGE_SOURCE).not.toMatch(
      /getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/,
    );
    // Must NOT import recommended-edits-persistence's mutable in-memory
    // helper (readRecommendedEditsLocal) — that would be a module-level
    // cache read, the same bug class Sprint 1 fixed for /changes.
    expect(PAGE_SOURCE).not.toMatch(/readRecommendedEditsLocal/);
    expect(LOAD_QUEUE_SOURCE).not.toMatch(/readRecommendedEditsLocal/);
  });

  it("wraps the edits read in safeCall so a read failure gracefully degrades to empty edits", () => {
    // W3 Step 3.3 (2026-05-01) — assertion now applies to the loader.
    expect(LOAD_QUEUE_SOURCE).toMatch(
      /safeCall\(\s*\(\)\s*=>\s*getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/,
    );
  });

  it("RecommendationQueueRow + RecommendationWatchRow expose the edits slice", () => {
    // Move 5 (2026-07-01): these row types moved to the loader with the index redirect.
    expect(LOAD_QUEUE_SOURCE).toMatch(/edits:\s*RecommendedEditRow\[\]/);
  });
});

// ── 3. Accept action fan-out wiring ───────────────────────────────────────
// REMOVED (surface-collapse, 2026-07-21): the accept fan-out lived in the
// deleted `acceptRecommendation` server action (src/app/(shell)/recommendations/
// actions.ts). That action was reachable ONLY through the retired recommendation
// cards; the LIVE Changes/Today accept path (respondToRecommendation +
// autoRecordShippedChangeForRec Ship->Proof bridge) is a separate, surviving
// action and is covered by its own suites. The deleted fan-out's scan assertions
// went with the feature.

// ── 5. ChangelogEntry type extension ──────────────────────────────────────

describe("Phase 6A.1.12 — ChangelogEntry type carries action_type + target_element_key", () => {
  it("ChangelogEntry type declares action_type as optional string", () => {
    expect(CHANGELOG_TYPES_SOURCE).toMatch(/action_type\?:\s*string/);
  });

  it("ChangelogEntry type declares target_element_key as optional string", () => {
    expect(CHANGELOG_TYPES_SOURCE).toMatch(
      /target_element_key\?:\s*string/,
    );
  });
});
