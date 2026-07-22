/**
 * B82++ reliability pass — regression guards for the 18 critical fixes shipped in
 * the Sprint-6 adversarial campaign.
 *
 * WHY source-level guards (not full behavioral tests): every one of these fixes
 * lives in an I/O path that calls `getSupabaseAdmin()` / the live OpenAI+Wix clients
 * directly (no injectable deps), so a true behavioral test needs heavy env + Supabase
 * + OpenAI mocking infrastructure that doesn't yet exist. These guards assert the fix
 * PATTERN is present (and the fail-open/masked-failure anti-pattern is absent), which
 * is what actually prevents silent reintroduction. The downstream contract
 * (`{synced:false}` → not stamped fresh) is already behaviorally tested in
 * tests/lib/connectors/cron-sync-succeeded.test.ts. The LLM/connector behavioral
 * tests are tracked as a follow-up test-infra investment (see the reliability report).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("LLM spend caps fail CLOSED on a budget-check throw (money safety)", () => {
  const targets = [
    "src/domains/llm/structured-drafter.ts",
    "src/domains/demand-graph/llm-answer-block.ts",
  ];
  for (const f of targets) {
    it(`${f} — checkBudget().catch returns allowed:false, never allowed:true`, () => {
      const src = read(f);
      // The fix: a budget-check exception must NOT bypass the cap.
      expect(src).not.toMatch(/checkBudget\([^)]*\)\.catch\(\(\)\s*=>\s*\(\{\s*allowed:\s*true/);
      expect(src).toMatch(/checkBudget\([^)]*\)\.catch\(\(\)\s*=>\s*\(\{\s*allowed:\s*false/);
    });
  }
});

describe("connector syncs report synced:false on a DB write failure (no masked success)", () => {
  it("GSC sync — both upsert-error paths return synced:false", () => {
    const src = read("src/lib/connectors/gsc/sync-search-analytics.ts");
    expect(src).toContain('reason: "gsc_daily_rows_upsert_failed"');
    expect(src).toContain('reason: "gsc_page_totals_upsert_failed"');
    // anti-pattern: a `synced: true` immediately inside an upsert-error block.
    expect(src).not.toMatch(/upsert failed[\s\S]{0,160}?return \{ synced: true/);
  });

  // (Profound sync regression removed 2026-07-20: the borrowed account was fully
  //  disconnected and src/lib/connectors/profound/sync-nightly.ts deleted.)
});

// The "push-service finalizes the reserved daily-cap slot" regression was retired
// 2026-07-22 (CORE 100K manual-publishing transition): the Wix auto-write path
// (push-service/executePush) was removed by product decision. Publishing is now
// manual — the operator applies the edit in their CMS and clicks Mark implemented.
// The publishing-authority OUTCOME (nothing goes live without the operator) is
// pinned by tests/architecture/14-publishing-authority and is strictly stronger
// now that no auto-write path exists at all.

describe("image-alt + product-SEO scan persists under free-text move_drafts kinds (no migration)", () => {
  it("MoveDraftKind includes the Sprint-6 free-text kinds", () => {
    const src = read("src/domains/demand-graph/move-draft-store.ts");
    expect(src).toContain('"image_alt_findings"');
    expect(src).toContain('"product_seo_findings"');
    expect(src).toContain('"page_eeat_findings"');
  });
});
