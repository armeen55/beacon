/**
 * Architecture invariant — Slice 4.5.G-A.2 (2026-05-21):
 * recommendation safety audit read-only contract.
 *
 * Pins the read-only nature of two files:
 *   • src/domains/recommendation-intelligence/safety-audit.ts
 *     (A.1 scanner — still pure, no I/O)
 *   • src/app/(shell)/diagnostics/recommendation-safety-audit/
 *     page.tsx (A.2 operator-only diagnostic page)
 *
 * The scanner module shipped in A.1 with the sibling
 * `recommendation-safety-audit-coverage` invariant. This A.2
 * invariant adds the file-boundary read-only contract on BOTH
 * files (scanner negatives + page contract). Adding it here
 * keeps the boundary pinned forward — if a future slice
 * introduces a write path on either file, this invariant trips.
 *
 * Neither file may:
 *   • import `recommended-edits-persistence`
 *   • reference `persistRecommendedEditsLocal`
 *   • reference `syncRecommendedEdits`
 *   • reference `runProviderAndPersist`
 *   • contain a direct Supabase `recommended_edits` write shape
 *   • import the OpenAI provider
 *   • import the LLM-draft gateway
 *   • call `fetch(`
 *
 * The diagnostic page additionally:
 *   • does NOT define a server action (`"use server"` pragma)
 *   • does NOT call `revalidatePath` (pure read; no cache
 *     invalidation side-effects on render)
 *   • does NOT import validator modules
 *   • does NOT import `brand-assertions`
 *   • does NOT import the `action-types` registry
 *   • does NOT render `<form>` or `<button>` elements
 *   • DOES import + reference `isOperatorModeServer` (operator gate)
 *   • DOES import + reference `notFound` (gate enforcement)
 *   • DOES import + reference `auditRecommendedEditRow` (scanner)
 *
 * Defense-in-depth alongside `recommendation-intelligence-no-queue-
 * write` (which auto-covers the scanner via `walk(INTEL_DIR)`) and
 * `recommendation-intelligence-llm-draft-gateway-render-isolation`
 * (which separately pins the LLM-caller boundary).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const SCANNER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "safety-audit.ts",
);
const PAGE_FILE = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-safety-audit",
  "page.tsx",
);

const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("recommendation-safety-audit-read-only", () => {
  it("scanner file exists at the expected path", () => {
    expect(
      existsSync(SCANNER_FILE),
      `Expected scanner at ${SCANNER_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  it("page file exists at the expected path", () => {
    expect(
      existsSync(PAGE_FILE),
      `Expected page at ${PAGE_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("scanner source-text contract (safety-audit.ts)", () => {
    const active = stripComments(read(SCANNER_FILE));

    it("does NOT import recommended-edits-persistence", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference persistRecommendedEditsLocal", () => {
      expect(active).not.toContain("persistRecommendedEditsLocal");
    });

    it("does NOT reference syncRecommendedEdits", () => {
      expect(active).not.toContain("syncRecommendedEdits");
    });

    it("does NOT reference runProviderAndPersist", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT contain Supabase recommended_edits write shape", () => {
      expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
    });

    it("does NOT import openaiProvider / provider module", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/providers/openai",
      );
      expect(active).not.toContain("openaiProvider");
    });

    it("does NOT import the llm-draft-gateway module", () => {
      expect(active).not.toContain(
        "@/domains/recommendation-intelligence/llm-draft-gateway",
      );
    });

    it("does NOT call fetch(", () => {
      expect(active).not.toMatch(/\bfetch\s*\(/);
    });
  });

  describe("page source-text contract (recommendation-safety-audit/page.tsx)", () => {
    const raw = read(PAGE_FILE);
    const active = stripComments(raw);

    it("does NOT import recommended-edits-persistence", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference persistRecommendedEditsLocal", () => {
      expect(active).not.toContain("persistRecommendedEditsLocal");
    });

    it("does NOT reference syncRecommendedEdits", () => {
      expect(active).not.toContain("syncRecommendedEdits");
    });

    it("does NOT reference runProviderAndPersist", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT contain Supabase recommended_edits write shape", () => {
      expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
    });

    it("does NOT import openaiProvider / provider module", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/providers/openai",
      );
      expect(active).not.toContain("openaiProvider");
    });

    it("does NOT import the llm-draft-gateway module", () => {
      expect(active).not.toContain(
        "@/domains/recommendation-intelligence/llm-draft-gateway",
      );
    });

    it("does NOT import validator modules", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/specific-edit-validator",
      );
      expect(active).not.toContain("validateSpecificEdit");
    });

    it("does NOT import brand-assertions", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/brand-assertions",
      );
    });

    it("does NOT import the action-types registry", () => {
      expect(active).not.toContain("@/domains/recommendations/action-types");
      expect(active).not.toContain("ACTION_TYPE_REGISTRY");
    });

    it("does NOT call fetch(", () => {
      expect(active).not.toMatch(/\bfetch\s*\(/);
    });

    it('does NOT define a server action ("use server" pragma)', () => {
      expect(raw).not.toMatch(/^\s*["']use server["']\s*;?/m);
    });

    it("does NOT call revalidatePath", () => {
      expect(active).not.toMatch(/\brevalidatePath\s*\(/);
    });

    it("does NOT render <form> or <button> elements", () => {
      // Comment-stripped active source — checks JSX render output.
      expect(active).not.toMatch(/<form\b/);
      expect(active).not.toMatch(/<button\b/);
    });

    it("DOES import + reference isOperatorModeServer", () => {
      expect(active).toContain("@/lib/operator-mode");
      expect(active).toContain("isOperatorModeServer");
    });

    it("DOES import + reference notFound", () => {
      expect(active).toContain("notFound");
    });

    it("DOES import + reference auditRecommendedEditRow (A.1 scanner)", () => {
      expect(active).toContain(
        "@/domains/recommendation-intelligence/safety-audit",
      );
      expect(active).toContain("auditRecommendedEditRow");
    });
  });
});
