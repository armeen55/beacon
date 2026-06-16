/**
 * Architecture invariant — Expert-rec-engine Slice 1 (2026-06-16):
 * recommendation EVIDENCE-LINE render-guard contract. The sibling of
 * `recommendation-why-render-guard.test.ts`, closing audit cross-cutting
 * BUG #5 (the GSC/SEMrush/Clarity/AEO evidence lines rendered unguarded).
 *
 * Pins TWO things:
 *   1. The guard module
 *      (`src/domains/recommendations/evidence-line-display-guard.ts`) is pure:
 *      no fetch(, no Supabase, no LLM, no persistence imports; it composes the
 *      `why-display-guard` and exports the locked vendor rail.
 *   2. Every customer-facing surface that renders `*EvidenceLines`
 *      (EvidenceLine[]) imports + references `filterDisplaySafeEvidenceLines`:
 *        • src/app/(shell)/recommendations/[id]/recommendation-detail-client.tsx
 *        • src/components/recommendations/v2/recommendation-v2-card.tsx
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
  "evidence-line-display-guard.ts",
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
    "components",
    "recommendations",
    "v2",
    "recommendation-v2-card.tsx",
  ),
] as const;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("recommendation-evidence-line-render-guard / module purity", () => {
  it("guard file exists at the expected path", () => {
    expect(
      existsSync(GUARD_FILE),
      `Expected guard at ${GUARD_FILE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on evidence-line-display-guard.ts", () => {
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

    it("composes the why-display-guard", () => {
      // Relative (./why-display-guard) or aliased import — both compose it.
      expect(active).toContain("why-display-guard");
      expect(active).toContain("checkWhyDisplaySafe");
    });

    it("exports the public surface", () => {
      expect(active).toMatch(/export\s+function\s+isEvidenceLineDisplaySafe\b/);
      expect(active).toMatch(
        /export\s+function\s+filterDisplaySafeEvidenceLines\b/,
      );
      expect(active).toMatch(
        /export\s+const\s+ANSWER_ENGINE_VENDOR_TERMS\b/,
      );
    });
  });
});

describe("recommendation-evidence-line-render-guard / customer-facing render sites", () => {
  for (const site of RENDER_SITES) {
    const rel = site.replace(REPO_ROOT + "/", "");

    describe(rel, () => {
      it("file exists", () => {
        expect(existsSync(site), `Expected render site at ${rel}`).toBe(true);
      });

      const active = stripComments(read(site));

      it("imports filterDisplaySafeEvidenceLines from the guard", () => {
        expect(active).toContain(
          "@/domains/recommendations/evidence-line-display-guard",
        );
        expect(active).toContain("filterDisplaySafeEvidenceLines");
      });

      it("references filterDisplaySafeEvidenceLines in active code (not just imports)", () => {
        const matches = active.match(/filterDisplaySafeEvidenceLines/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});
