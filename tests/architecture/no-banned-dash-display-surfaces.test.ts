import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { actionLabel } from "@/domains/insight/page-primary";
import { proofOutcomeSentence, type GscProofVerdict } from "@/domains/proof-gsc/measure";

/**
 * HARD RULE GUARD: no em/en/figure/bar dash in user-visible copy, ever.
 *
 * The dash enforcer (src/lib/copy/strip-dashes.ts) only runs on GENERATED
 * artifact/recommendation copy. The Insight / Workbench / Proof / Opportunity
 * render surfaces emit static literals that bypass it, so a pre-merge audit found
 * ~68 leaked dashes there. This test hardcodes the rule against regression: the
 * curated display surfaces below must contain ZERO banned dashes outside comments,
 * and the key pure label/sentence functions must never return one.
 */
const BANNED = /[‒–—―]/; // figure, en, em, horizontal bar

/** Strip block comments, JSX comments, and line comments (but not "://" URLs). */
function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, " "); // /* ... */ and {/* ... */}
  return noBlocks
    .split("\n")
    .map((line) => (line.includes("://") ? line : line.replace(/\/\/.*$/, "")))
    .join("\n");
}

// Curated set: every surface the audit flagged + the proof surfaces touched here.
const DISPLAY_SURFACES = [
  "src/app/(shell)/workbench/workbench-view.tsx",
  "src/app/(shell)/state-of-union-section.tsx",
  "src/app/(shell)/today-v2-data.ts",
  "src/app/(shell)/changes/page.tsx",
  "src/app/(shell)/changes/proof-ledger-strip.tsx",
  "src/app/(shell)/proof/page.tsx",
  "src/app/(shell)/proof/proof-ledger-client.tsx",
  "src/app/(shell)/recommendations/recommendations-v2-client.tsx",
  "src/components/recommendations/v2/recommendation-v2-card.tsx",
  "src/domains/insight/diagnosis-matrix.ts",
  "src/domains/insight/opportunity.ts",
  "src/domains/insight/serp-guard.ts",
  "src/domains/insight/state-of-union.ts",
  "src/domains/insight/compute-state-of-union.ts",
  "src/domains/insight/connection-health.ts",
  "src/domains/insight/page-primary.ts",
  "src/domains/proof-gsc/measure.ts",
];

describe("no banned dash in display surfaces (hard rule)", () => {
  it.each(DISPLAY_SURFACES)("%s has no em/en dash outside comments", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    const stripped = stripComments(src);
    const offending = stripped
      .split("\n")
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => BANNED.test(l));
    expect(
      offending.map(({ l, n }) => `${n}: ${l.trim()}`),
      `Banned dash in user-visible copy of ${rel}; use ", " (spaced) or "-" (unspaced)`,
    ).toEqual([]);
  });

  it("actionLabel never returns a banned dash", () => {
    const keys = [
      "edit_title",
      "edit_meta",
      "change_h1",
      "intro_answer_block",
      "section_add",
      "faq",
      "schema",
      "add_internal_link",
      "keep_current",
      "monitor",
      "change",
      null,
      undefined,
    ];
    for (const k of keys) expect(BANNED.test(actionLabel(k))).toBe(false);
  });

  it("proofOutcomeSentence never returns a banned dash", () => {
    const verdicts: GscProofVerdict[] = [
      "measuring",
      "won",
      "lost",
      "inconclusive",
      "insufficient_data",
    ];
    const basis = {
      day: 28 as const,
      checkOn: "2026-07-18",
      ran: true,
      treatedDelta: 30,
      controlDelta: 2,
      adjustedLift: 28,
      controlsUsed: 3,
    };
    for (const verdict of verdicts) {
      const s = proofOutcomeSentence({ verdict, confidence: "high", basis });
      expect(BANNED.test(s), `verdict=${verdict}: "${s}"`).toBe(false);
    }
  });
});
