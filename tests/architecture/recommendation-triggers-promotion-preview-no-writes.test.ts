/**
 * Architecture invariant — Slice 4.5.D.α₀b — Promotion Preview
 * no-writes contract.
 *
 * Defense-in-depth source-text scan over the operator-only
 * `/diagnostics/recommendation-triggers/page.tsx`. The page
 * MUST be render-only: it consumes
 * `selectPromotableCandidates(...)` output for display, never
 * for persistence.
 *
 * Negative assertions:
 *   • No `.from("recommended_edits").{insert,upsert,update,delete}(`
 *   • No `runProviderAndPersist` reference.
 *   • No `recommended-edits-persistence` substring (already
 *     covered by `recommendation-intelligence-no-queue-write` —
 *     duplicated here for locality).
 *
 * Positive assertions (pin the section's existence so future
 * maintenance can't silently remove it):
 *   • Page imports `selectPromotableCandidates`.
 *   • Page source contains `data-diagnostic-section="promotion-preview"`.
 *   • Page source contains the locked title literal.
 *   • Page source contains `data-counter="promotion-preview-counters"`.
 *   • Page source contains `Eligible for promotion:` counter literal.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "page.tsx",
);

function readPage(): string {
  return readFileSync(PAGE_PATH, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Match any `.from("recommended_edits").<write>(` shape in
 *  comment-stripped source. Whitespace-tolerant. */
const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

describe("recommendation-triggers-promotion-preview-no-writes", () => {
  // ── Negative assertions (no writes) ─────────────────────────
  it("page does NOT perform a Supabase write against `recommended_edits`", () => {
    const active = stripComments(readPage());
    expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
  });

  it("page does NOT reference `runProviderAndPersist`", () => {
    const active = stripComments(readPage());
    expect(active).not.toContain("runProviderAndPersist");
  });

  it("page does NOT contain the `recommended-edits-persistence` substring", () => {
    expect(readPage()).not.toContain("recommended-edits-persistence");
  });

  // ── Positive assertions (Promotion Preview section pinned) ──
  it("page imports `selectPromotableCandidates`", () => {
    expect(readPage()).toContain("selectPromotableCandidates");
  });

  it("page renders the Promotion Preview section data-attribute", () => {
    expect(readPage()).toContain('data-diagnostic-section="promotion-preview"');
  });

  it("page renders the operator-locked title literal", () => {
    expect(readPage()).toContain("Promotion Preview (DRY-RUN — no writes)");
  });

  it("page renders the counter data-attribute", () => {
    expect(readPage()).toContain('data-counter="promotion-preview-counters"');
  });

  it("page renders the `Eligible for promotion:` counter literal", () => {
    expect(readPage()).toContain("Eligible for promotion:");
  });
});
