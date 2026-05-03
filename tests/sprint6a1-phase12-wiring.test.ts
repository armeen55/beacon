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

const CLIENT_PATH = resolve(
  __dirname,
  "../src/app/(shell)/recommendations/recommendations-client.tsx",
);
const CLIENT_SOURCE = readFileSync(CLIENT_PATH, "utf8");

const ACTIONS_PATH = resolve(
  __dirname,
  "../src/app/(shell)/recommendations/actions.ts",
);
const ACTIONS_SOURCE = readFileSync(ACTIONS_PATH, "utf8");

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
  it("imports RecommendedEditRow type", () => {
    expect(PAGE_SOURCE).toMatch(/RecommendedEditRow/);
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

  it("groups edits by rec_id and threads them into the decorated rows", () => {
    expect(PAGE_SOURCE).toMatch(/editsByRecId/);
    expect(PAGE_SOURCE).toMatch(/edits:\s*editsByRecId\.get\(rec\.stableKey\)/);
  });

  it("RecommendationQueueRow + RecommendationWatchRow expose the edits slice", () => {
    expect(PAGE_SOURCE).toMatch(/edits:\s*RecommendedEditRow\[\]/);
  });
});

// ── 3. recommendations-client UI ──────────────────────────────────────────

describe("Phase 6A.1.12 — recommendations-client UI (post-Step-3.5e action table)", () => {
  // After W3 Step 3.5e (2026-05-03) the page is a HubSpot-style
  // ranked action table. The pre-3.5e wiring assertions
  // ("destructure edits from row" / "Specific edits section") no
  // longer apply — that work moved into the pure
  // `buildRecommendationActionRows` builder, which the client
  // imports + invokes once per render.
  //
  // What the contract still pins:
  //   - The client consumes recommended-edit rows via the action-row
  //     builder (same upstream data; new shape).
  //   - The accept / defer / dismiss / mark-shipped / undo server
  //     actions are still wired into row buttons.
  //
  // The detailed table contract lives in
  // `tests/architecture/recommendations-step-3.5e-action-table.test.ts`.

  it("imports buildRecommendationActionRows from the recommendations domain", () => {
    expect(CLIENT_SOURCE).toMatch(
      /import\s*\{[^}]*buildRecommendationActionRows[^}]*\}\s*from\s*["']@\/domains\/recommendations\/recommendation-action-rows["']/,
    );
  });

  it("invokes buildRecommendationActionRows with the queue prop", () => {
    expect(CLIENT_SOURCE).toMatch(
      /buildRecommendationActionRows\(\s*\{\s*queue\s*\}/,
    );
  });

  it("Accept / Defer / Dismiss / Mark-shipped / Undo server actions still wired into row buttons", () => {
    expect(CLIENT_SOURCE).toMatch(/acceptRecommendation\(/);
    expect(CLIENT_SOURCE).toMatch(/deferRecommendation\(/);
    expect(CLIENT_SOURCE).toMatch(/dismissRecommendation\(/);
    expect(CLIENT_SOURCE).toMatch(/markRecommendationShipped\(/);
    expect(CLIENT_SOURCE).toMatch(/undoRecommendationResponse\(/);
  });
});

// ── 4. Accept action fan-out wiring ───────────────────────────────────────

describe("Phase 6A.1.12 — accept action fan-out", () => {
  it("imports the repository to fetch fresh recommended_edits", () => {
    expect(ACTIONS_SOURCE).toMatch(
      /from\s+["']@\/lib\/persistence\/repositories["']/,
    );
    // Sprint 7 Phase 7.5b Commit 2 (2026-04-25) — tenant-bound read.
    expect(ACTIONS_SOURCE).toMatch(
      /getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/,
    );
  });

  it("filters fetched edits by rec_id === payload.stableKey", () => {
    expect(ACTIONS_SOURCE).toMatch(
      /allEdits\.filter\(\(e\)\s*=>\s*e\.rec_id\s*===\s*payload\.stableKey\)/,
    );
  });

  it("falls back to the legacy single-entry path when editsForRec is empty", () => {
    // The legacy path is gated on `editsForRec.length > 0`.
    expect(ACTIONS_SOURCE).toMatch(/editsForRec\.length\s*>\s*0/);
  });

  it("fan-out helper stamps action_type + target_element_key + source_rec_id", () => {
    expect(ACTIONS_SOURCE).toMatch(/action_type:\s*edit\.action_type/);
    expect(ACTIONS_SOURCE).toMatch(/target_element_key:\s*edit\.target_element_key/);
    expect(ACTIONS_SOURCE).toMatch(/source_rec_id:\s*payload\.stableKey/);
  });

  it("fan-out persists via writeStore + syncChangelogEntries (matches createChangelogEntry semantics)", () => {
    expect(ACTIONS_SOURCE).toMatch(
      /writeStore\(\s*["']imported-changes["']/,
    );
    // Phase 7.7b Commit 2 (2026-04-25): syncChangelogEntries now requires tenantId.
    expect(ACTIONS_SOURCE).toMatch(/syncChangelogEntries\(newEntries,\s*tenantId\)/);
  });

  it("returns changeIds (array) when fan-out fired; preserves changeId (string) for both paths", () => {
    expect(ACTIONS_SOURCE).toMatch(/changeIds:\s*string\[\]/);
    expect(ACTIONS_SOURCE).toMatch(/return\s*\{\s*success:\s*true,\s*changeId,\s*changeIds\s*\}/);
  });

  it("graceful degrade: edits read failure does not abort acceptance — falls through to single-entry path", () => {
    expect(ACTIONS_SOURCE).toMatch(/edits read failed; falling back/);
  });
});

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
