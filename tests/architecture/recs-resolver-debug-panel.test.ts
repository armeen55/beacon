/**
 * P0 — 2026-05-13 architecture invariants for the inline debug panel
 * at `/recommendations?debugResolver=1`.
 *
 * Pins:
 *   1. The panel is render-only — no mutation calls, no LLM imports,
 *      no `fetch(`, no API key references.
 *   2. The panel is wired into the v2 branch ONLY when
 *      `searchParams.debugResolver === "1"`. It does not render by
 *      default.
 *   3. The page passes `debugResolver` through Suspense to the async
 *      content component.
 *   4. The persisted-loader synthesis mirror in the panel matches the
 *      load-queue.ts implementation in shape (same action mapping +
 *      same group-by-rec-id + same primary-edit selection rule).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PANEL_SRC = stripComments(
  read("src/app/(shell)/recommendations/recs-resolver-debug-panel.tsx"),
);
const PAGE_SRC = stripComments(
  read("src/app/(shell)/recommendations/page.tsx"),
);

describe("RecsResolverDebugPanel — read-only contract", () => {
  it("does not import any LLM provider", () => {
    expect(PANEL_SRC).not.toMatch(
      /from\s+['"]@\/domains\/recommendations\/providers/,
    );
    expect(PANEL_SRC).not.toMatch(
      /from\s+['"]@\/domains\/recommendations\/specific-edit-provider['"]/,
    );
  });

  it("does not import the LLM orchestrator", () => {
    expect(PANEL_SRC).not.toMatch(/runProviderAndPersist/);
  });

  it("does not call adjudicator-budget or cost-ledger helpers", () => {
    expect(PANEL_SRC).not.toMatch(
      /from\s+['"]@\/domains\/recommendations\/adjudicator-budget['"]/,
    );
    expect(PANEL_SRC).not.toMatch(/from\s+['"]@\/lib\/cost\//);
  });

  it("does not call any naked fetch(", () => {
    expect(PANEL_SRC).not.toMatch(/\bfetch\s*\(/);
  });

  it("does not reference OPENAI_API_KEY / ANTHROPIC_API_KEY / PERPLEXITY_API_KEY", () => {
    expect(PANEL_SRC).not.toMatch(/OPENAI_API_KEY/);
    expect(PANEL_SRC).not.toMatch(/ANTHROPIC_API_KEY/);
    expect(PANEL_SRC).not.toMatch(/PERPLEXITY_API_KEY/);
  });

  it("does not call any mutation server action / revalidate", () => {
    expect(PANEL_SRC).not.toMatch(/revalidateTag\s*\(/);
    expect(PANEL_SRC).not.toMatch(/revalidatePath\s*\(/);
  });
});

describe("/recommendations — debugResolver wiring", () => {
  it("page.tsx defines a shouldShowResolverDebug helper", () => {
    expect(PAGE_SRC).toMatch(/function\s+shouldShowResolverDebug\s*\(/);
    expect(PAGE_SRC).toMatch(
      /searchParams\.debugResolver\s*===\s*['"]1['"]/,
    );
  });

  it("page.tsx threads debugResolver into RecommendationsAsyncContent", () => {
    expect(PAGE_SRC).toMatch(
      /<RecommendationsAsyncContent[\s\S]{0,200}debugResolver=\{debugResolver\}/,
    );
  });

  it("RecommendationsAsyncContent renders the panel ONLY when debugResolver is true", () => {
    expect(PAGE_SRC).toMatch(
      /\{\s*debugResolver\s*&&\s*\(\s*<RecsResolverDebugPanel/,
    );
  });

  it("the panel is wired off the persisted loader output", () => {
    // Surface collapse (2026-06-15): /recommendations is V2-only — the
    // `if (useV2)` / legacy branch was removed. The panel consumes
    // `persisted` from loadPersistedRecommendationQueueForPage and is
    // rendered unconditionally (gated only by `debugResolver`).
    expect(PAGE_SRC).toMatch(/<RecsResolverDebugPanel/);
    expect(PAGE_SRC).toMatch(/persisted=\{persisted\}/);
    // No legacy live-pipeline branch remains.
    expect(PAGE_SRC).not.toMatch(/Legacy table view/);
  });
});

describe("Panel persisted-loader synthesis mirror", () => {
  // The panel re-implements the persisted loader's group-by-rec-id +
  // primary-edit-selection logic so it can fire an uncached fetch
  // against Supabase for the divergence check. If load-queue.ts
  // changes its synthesis behavior, the mirror must update too. These
  // pins catch the most common drifts.
  const LOADER_SRC = stripComments(
    read("src/domains/recommendations/load-queue.ts"),
  );

  it("primary-edit selection rule matches: most-recent updated/created edit", () => {
    const loaderRule = /\[\.\.\.edits\]\.sort\(\([^)]*\)\s*=>[\s\S]{0,200}created_at[\s\S]{0,80}localeCompare/.test(
      LOADER_SRC,
    );
    const panelRule = /\[\.\.\.edits\]\.sort\(\([^)]*\)\s*=>[\s\S]{0,200}created_at[\s\S]{0,80}localeCompare/.test(
      PANEL_SRC,
    );
    expect(
      loaderRule && panelRule,
      "primary-edit selection must use the same sort rule in load-queue.ts AND the panel",
    ).toBe(true);
  });

  it("both files map ActionType → RecommendationAction via the same switch shape", () => {
    expect(PANEL_SRC).toMatch(/case\s+"add_h2_section":/);
    expect(PANEL_SRC).toMatch(/case\s+"add_faq":\s*\n\s*return\s+"add_section_or_faq"/);
    expect(PANEL_SRC).toMatch(/case\s+"create_page":\s*\n\s*return\s+"create_new_page"/);
    expect(LOADER_SRC).toMatch(/case\s+"add_h2_section":/);
    expect(LOADER_SRC).toMatch(/case\s+"add_faq":\s*\n\s*return\s+"add_section_or_faq"/);
  });

  it("the panel groups edits by rec_id and skips edits without a rec_id (matches loader)", () => {
    expect(PANEL_SRC).toMatch(/if\s*\(\s*!edit\.rec_id\s*\)\s*continue/);
    expect(LOADER_SRC).toMatch(/if\s*\(\s*!edit\.rec_id\s*\)\s*continue/);
  });
});
