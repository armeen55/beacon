/**
 * Architecture invariant — Slice 4.5.G-B.1 (2026-05-21):
 * recommendation `why` render-guard contract.
 *
 * Pins TWO things:
 *
 *   1. The guard module itself
 *      (`src/domains/recommendations/why-display-guard.ts`) is pure:
 *      no `fetch(`, no Supabase, no LLM, no persistence imports.
 *      Does NOT modify or import: brand-assertions, specific-edit-
 *      validator, suggested-copy-display-guard, action-types
 *      registry.
 *
 *   2. Every customer-facing recommendation render path that
 *      surfaces `why` imports + references `checkWhyDisplaySafe`.
 *      The 4 locked customer-facing files:
 *        • src/app/(shell)/recommendations/[id]/recommendation-detail-client.tsx
 *        • src/app/(shell)/recommendations/[id]/suggested-copy-act.tsx
 *        • src/app/(shell)/recommendations/recommendations-client.tsx (legacy drawer)
 *        • src/components/recommendations/v2/recommendation-v2-card.tsx (v2 card)
 *
 * Defense-in-depth alongside the existing `recommendation-safety-
 * audit-coverage` (which scans `recommended_edits` rows for the
 * same kinds at audit time) and `suggested-copy-display-guard.ts`
 * (which guards `proposed_text` at render time).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const GUARD_FILE = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendations",
  "why-display-guard.ts",
);

const RENDER_SITES = [
  resolve(
    REPO_ROOT,
    "src",
    "app",
    "(shell)",
    "recommendations",
    "[id]",
    "recommendation-detail-client.tsx",
  ),
  resolve(
    REPO_ROOT,
    "src",
    "app",
    "(shell)",
    "recommendations",
    "[id]",
    "suggested-copy-act.tsx",
  ),
  // Surface collapse (2026-06-15): the legacy recommendations-client.tsx
  // (the old drawer render site) was deleted; the V2 card + detail client +
  // suggested-copy act are the remaining `why`-render surfaces.
  resolve(
    REPO_ROOT,
    "src",
    "components",
    "recommendations",
    "v2",
    "recommendation-v2-card.tsx",
  ),
] as const;

const FALLBACK_COPY =
  "Beacon has additional context for this recommendation, but it needs review before showing here.";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("recommendation-why-render-guard / module purity", () => {
  it("guard file exists at the expected path", () => {
    expect(
      existsSync(GUARD_FILE),
      `Expected guard at ${GUARD_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on why-display-guard.ts", () => {
    const active = stripComments(read(GUARD_FILE));

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

    it("does NOT import recommended-edits-persistence", () => {
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

    it("exports the locked fallback copy verbatim", () => {
      expect(active).toContain(FALLBACK_COPY);
    });

    it("exports checkWhyDisplaySafe", () => {
      expect(active).toMatch(/export\s+function\s+checkWhyDisplaySafe\b/);
    });
  });
});

describe("recommendation-why-render-guard / customer-facing render sites", () => {
  for (const site of RENDER_SITES) {
    const rel = site.replace(REPO_ROOT + "/", "");

    describe(rel, () => {
      it("file exists", () => {
        expect(existsSync(site), `Expected render site at ${rel}`).toBe(
          true,
        );
      });

      const active = stripComments(read(site));

      it("imports checkWhyDisplaySafe from why-display-guard", () => {
        expect(active).toContain(
          "@/domains/recommendations/why-display-guard",
        );
        expect(active).toContain("checkWhyDisplaySafe");
      });

      it("references checkWhyDisplaySafe in active code (not just imports)", () => {
        // Count occurrences — import + at least one call site = 2+
        const matches = active.match(/checkWhyDisplaySafe/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});
