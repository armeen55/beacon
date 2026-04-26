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
    expect(PAGE_SOURCE).toMatch(
      /getRepository\(\)\.forTenant\([^)]+\)\.getRecommendedEdits\(/,
    );
    // Must NOT import recommended-edits-persistence's mutable in-memory
    // helper (readRecommendedEditsLocal) — that would be a module-level
    // cache read, the same bug class Sprint 1 fixed for /changes.
    expect(PAGE_SOURCE).not.toMatch(/readRecommendedEditsLocal/);
  });

  it("wraps the edits read in safeCall so a read failure gracefully degrades to empty edits", () => {
    // Sprint 7 Phase 7.5b Commit 2 — same pattern, with `.forTenant(tenantId)`.
    expect(PAGE_SOURCE).toMatch(
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

describe("Phase 6A.1.12 — recommendations-client UI", () => {
  it("imports RecommendedEditRow", () => {
    expect(CLIENT_SOURCE).toMatch(/RecommendedEditRow/);
  });

  it("destructures edits from the row + computes editCount", () => {
    expect(CLIENT_SOURCE).toMatch(
      /const\s*\{\s*rec,\s*response,\s*edits\s*\}\s*=\s*row/,
    );
    expect(CLIENT_SOURCE).toMatch(/editCount\s*=\s*edits\.length/);
  });

  it("renders a Specific edits section when editCount > 0", () => {
    expect(CLIENT_SOURCE).toMatch(/Specific edits/);
    expect(CLIENT_SOURCE).toMatch(
      /editCount\s*>\s*0\s*&&\s*<SpecificEditsSection/,
    );
  });

  it("Accept button copy reflects the edit count", () => {
    expect(CLIENT_SOURCE).toMatch(/Accept — track \$\{editCount\} edit/);
  });

  it("Specific edits section displays action_type, display_label, current/proposed text, why, evidence, confidence, difficulty", () => {
    expect(CLIENT_SOURCE).toMatch(/edit\.action_type/);
    expect(CLIENT_SOURCE).toMatch(/edit\.display_label/);
    expect(CLIENT_SOURCE).toMatch(/edit\.current_text/);
    expect(CLIENT_SOURCE).toMatch(/edit\.proposed_text/);
    expect(CLIENT_SOURCE).toMatch(/edit\.why/);
    expect(CLIENT_SOURCE).toMatch(/edit\.evidence/);
    expect(CLIENT_SOURCE).toMatch(/edit\.confidence/);
    expect(CLIENT_SOURCE).toMatch(/edit\.difficulty/);
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
    expect(ACTIONS_SOURCE).toMatch(/syncChangelogEntries\(newEntries\)/);
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
