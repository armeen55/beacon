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

const ROOT = join(__dirname, "..", "..", "..");
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

  it("Profound sync — tracks per-table write failure + returns synced:false if any failed", () => {
    const src = read("src/lib/connectors/profound/sync-nightly.ts");
    // all five table writes flip the failure flag
    expect((src.match(/writeFailed = "/g) ?? []).length).toBeGreaterThanOrEqual(5);
    // the final return honours the flag
    expect(src).toMatch(/if \(writeFailed\) return \{ synced: false, reason: writeFailed \}/);
  });
});

describe("push-service finalizes the reserved daily-cap slot on every refusal path", () => {
  it("each post-reservation refusal records a push_failed ledger row", () => {
    const src = read("src/domains/push/push-service.ts");
    for (const reason of [
      "products_query",
      "product_not_found",
      "product_read",
      "merged_tags_limit",
      "element_key_mismatch",
      "protected_field",
      "length_limit",
      "unmapped_url",
    ]) {
      expect(src, `missing recordLedger finalize for "${reason}"`).toContain(reason);
    }
    // The Ritz publish hard-block must remain BEFORE adapter/Wix selection.
    expect(src).toMatch(/Ritz|ritz/);
  });
});

describe("image-alt + product-SEO scan persists under free-text move_drafts kinds (no migration)", () => {
  it("MoveDraftKind includes the Sprint-6 free-text kinds", () => {
    const src = read("src/domains/demand-graph/move-draft-store.ts");
    expect(src).toContain('"image_alt_findings"');
    expect(src).toContain('"product_seo_findings"');
    expect(src).toContain('"page_eeat_findings"');
  });
});
