/**
 * Architecture invariant — Slice 4.5.G-B.2 (2026-05-21):
 * write-time copy-sanitizer purity + coverage contract.
 *
 * Pins TWO things:
 *
 *   1. The sanitizer module
 *      (`src/domains/recommendations/copy-sanitize.ts`) is pure:
 *      no `fetch(`, no Supabase, no LLM, no persistence imports.
 *      Does NOT modify or import: brand-assertions, specific-edit-
 *      validator, why-display-guard, suggested-copy-display-guard,
 *      action-types registry. Stays a pure string transformation.
 *
 *   2. The sanitizer's source covers the 3 B.2 pattern families:
 *      (a) canonical UUIDs (carried from M2),
 *      (b) long 32+ hex/hash strings (new in B.2),
 *      (c) the 12 locked internal taxonomy tokens (new in B.2 —
 *          mirrors the B.1 render-guard's blocklist exactly).
 *      Adding a new locked token without paired sanitizer coverage
 *      trips this invariant before the slice can land.
 *
 * Defense-in-depth alongside `recommendation-why-render-guard`
 * (B.1, which guards the SAME 4 reason kinds at render time) and
 * `recommendation-safety-audit-coverage` (A.1, which detects all 9
 * historical violation kinds at audit time). B.2 closes the
 * forward-prevention half of the loop: catch leaks at row
 * persistence so they never reach the database OR the customer
 * surface.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SANITIZER_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "copy-sanitize.ts",
);

/**
 * The 12 internal taxonomy tokens locked in B.1's render-guard
 * blocklist that B.2 must mirror at write time. Order is the same
 * source-text order (read-only assertion; not a behavioral test).
 */
const LOCKED_INTERNAL_TOKENS = [
  "aiSearchSignal",
  "actualSearchQueries",
  "action_type",
  "trigger_signal",
  "evidence_tier",
  "Mode A", // matched as `Mode\\s+[ABC]` in the sanitizer
  "Mode B", // same regex covers all three
  "Mode C",
  "rec_id",
  "source_rec_id",
  "diagnostic_only",
  "customer-queue-ready",
] as const;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("recommendation-copy-sanitize / module purity", () => {
  it("sanitizer file exists at the expected path", () => {
    expect(
      existsSync(SANITIZER_FILE),
      `Expected sanitizer at ${SANITIZER_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on copy-sanitize.ts", () => {
    const active = stripComments(read(SANITIZER_FILE));

    it("does NOT call fetch(", () => {
      expect(active).not.toMatch(/\bfetch\s*\(/);
    });

    it("does NOT import Supabase", () => {
      expect(active).not.toContain("@/lib/persistence/supabase");
      expect(active).not.toContain("@supabase/supabase-js");
    });

    it("does NOT import the OpenAI / LLM provider", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/providers/openai",
      );
      expect(active).not.toContain("openaiProvider");
    });

    it("does NOT import recommended-edits-persistence (callers wire this in; sanitizer stays pure)", () => {
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT import or modify brand-assertions", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/brand-assertions",
      );
    });

    it("does NOT import or modify specific-edit-validator", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/specific-edit-validator",
      );
      expect(active).not.toContain("validateSpecificEdit");
    });

    it("does NOT import or modify why-display-guard (B.1 render path stays separate)", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/why-display-guard",
      );
      expect(active).not.toContain("checkWhyDisplaySafe");
    });

    it("does NOT import or modify suggested-copy-display-guard", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/suggested-copy-display-guard",
      );
    });

    it("does NOT import the action-types registry", () => {
      expect(active).not.toContain("@/domains/recommendations/action-types");
      expect(active).not.toContain("ACTION_TYPE_REGISTRY");
    });

    it("does NOT contain a Supabase `recommended_edits` write shape", () => {
      const writeShape = new RegExp(
        "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
          "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
        "u",
      );
      expect(writeShape.test(active)).toBe(false);
    });

    it("exports sanitizeOperatorEvidenceText (write-time entry)", () => {
      expect(active).toMatch(/export\s+function\s+sanitizeOperatorEvidenceText\b/);
    });

    it("exports scrubInternalLeakagePatterns (B.2 helper)", () => {
      expect(active).toMatch(/export\s+function\s+scrubInternalLeakagePatterns\b/);
    });
  });
});

describe("recommendation-copy-sanitize / B.2 coverage contract", () => {
  const active = stripComments(read(SANITIZER_FILE));

  it("source carries a long-hex-hash pattern (32+ hex)", () => {
    // The implementation pattern is `\b[0-9a-f]{32,}\b/gi` — match
    // either {32,} or {32, ...} at the source-text level so the
    // invariant is robust to trivial reformatting.
    expect(active).toMatch(/\[0-9a-f\]\{32,/);
  });

  it("source uses 'prompt evidence' as the hex/UUID fallback wording", () => {
    expect(active).toContain('"prompt evidence"');
  });

  // Each locked token MUST appear in the sanitizer source — either as
  // a literal regex match (aiSearchSignal, etc.) or via the Mode-A/B/C
  // regex (matched as `Mode\\s+[ABC]`). Mode tokens are checked once.
  describe("each locked internal token is covered by a sanitizer pattern", () => {
    for (const tok of LOCKED_INTERNAL_TOKENS) {
      if (tok.startsWith("Mode ")) {
        // The three Mode tokens share one regex.
        continue;
      }
      it(`covers '${tok}' in the sanitizer source`, () => {
        expect(active).toContain(tok);
      });
    }

    it("covers Mode A/B/C via a single shared regex (`Mode\\s+[ABC]`)", () => {
      expect(active).toMatch(/Mode\\s\+\[ABC\]/);
    });
  });

  it("source-text scan finds the operator-locked replacement style strings", () => {
    // Spot-check 3 of the locked replacements per Section 4.5.G-B.2.
    expect(active).toContain('"search-intent signals"');
    expect(active).toContain('"observed search-intent signals"');
    expect(active).toContain("\"Beacon's evaluation mode\"");
  });
});

describe("recommendation-copy-sanitize / B.4-deferred kinds remain unhandled", () => {
  const active = stripComments(read(SANITIZER_FILE));

  it("does NOT scrub 'architect-led' (architect_overclaim deferred to B.4)", () => {
    // Source must not contain a replacement target for "architect-led"
    // — if a future slice adds one, this invariant pins the change to
    // a paired plan-section update.
    const literal = active.match(/architect-led/g) ?? [];
    // Comments may mention it (e.g., "deferred"); the source-text
    // scan above strips comments, so only active code is searched.
    // Active code MUST NOT contain the literal as a replacement key.
    expect(
      literal.length,
      "B.2 active source must not match 'architect-led'; deferred to B.4",
    ).toBe(0);
  });

  it("does NOT scrub 'architect-designed' (architect_overclaim deferred to B.4)", () => {
    const literal = active.match(/architect-designed/g) ?? [];
    expect(literal.length).toBe(0);
  });

  it("does NOT scrub the 'best' unsupported-claim token (deferred to B.4)", () => {
    // Bare "best" is too common to false-positive on — pin only the
    // architecture-invariant intent: no replacement regex containing
    // the literal `\bbest\b` is present in active source.
    expect(active).not.toMatch(/\\bbest\\b/);
  });

  it("does NOT scrub competitor names (handled on a separate validator path)", () => {
    expect(active).not.toContain("validateCompetitorPublicCopy");
    expect(active).not.toContain("competitorNames");
  });
});
