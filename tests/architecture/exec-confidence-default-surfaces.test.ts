/**
 * Architecture invariant — Trust Sprint T6.4 (2026-05-06).
 *
 * Pins customer-visible default surfaces against scared / methodology-
 * leaking copy. Per the trust-sprint principle:
 *
 *   "Internally: Beacon must track uncertainty, sample size,
 *    contamination, evidence quality, and attribution risk.
 *    Externally: Beacon should feel confident, clean, decisive,
 *    and premium. Do not over-warn the customer."
 *
 * Default surfaces (this file's scope):
 *   - src/components/today/health-strip.tsx
 *   - src/components/today/today-findings.tsx
 *   - src/components/today/today-visibility-snapshot.tsx
 *
 * Caveats remain in proof drawers (why-this-number, why-this-verdict,
 * truth pages, math drawer, methodology) — those are explicitly NOT
 * scoped here.
 *
 * The forbidden phrases below are scared / methodology-leaking on
 * default surfaces. They are allowed in tests, comments, and proof
 * drawers — only the runtime JSX of the listed default-surface
 * components is pinned.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const DEFAULT_SURFACES = [
  "src/components/today/health-strip.tsx",
  "src/components/today/today-findings.tsx",
  "src/components/today/today-visibility-snapshot.tsx",
];

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function readSurfaceCode(rel: string): string {
  const abs = join(REPO_ROOT, rel);
  return stripComments(readFileSync(abs, "utf-8"));
}

const FORBIDDEN_PHRASES: ReadonlyArray<{ phrase: string; rationale: string }> = [
  {
    phrase: "Data is outdated",
    rationale: "Scared past-tense framing. Use 'Refresh recommended — last crawl is stale' instead.",
  },
  {
    phrase: "Data is aging",
    rationale: "Anthropomorphizes the data. Use 'Refresh due — keep findings current' instead.",
  },
  {
    phrase: "Data may be outdated",
    rationale: "Hedged scared framing. Use '(based on an earlier crawl)' instead.",
  },
  {
    phrase: "data has not been updated recently",
    rationale: "Past-tense scared framing. Use 'based on an earlier crawl' instead.",
  },
  {
    phrase: "no recent data available",
    rationale: "Scared framing. Use 'based on the last available crawl' instead.",
  },
  {
    phrase: "Aging — data may be outdated",
    rationale: "Doubles down on the scared framing. Use 'Refresh due — nearing freshness threshold' instead.",
  },
  {
    phrase: "Stale — data has not been updated recently",
    rationale: "Scared past-tense + label. Use 'Refresh recommended — based on an earlier crawl' instead.",
  },
  {
    phrase: "Critical — no recent crawl data",
    rationale: "Alarm-bell language. Use 'Refresh recommended — last crawl is stale' instead.",
  },
  {
    phrase: "findings may not reflect your latest site",
    rationale: "Hedged scared framing. Use 'Findings reflect the last available crawl. Refresh to update.' instead.",
  },
];

describe("T6.4 — exec confidence on default surfaces", () => {
  for (const rel of DEFAULT_SURFACES) {
    describe(rel, () => {
      const code = readSurfaceCode(rel);
      for (const { phrase, rationale } of FORBIDDEN_PHRASES) {
        it(`does not render the scared phrase "${phrase}"`, () => {
          expect(
            code.includes(phrase),
            `${rel} contains the scared/methodology-leaking phrase "${phrase}". ${rationale}`,
          ).toBe(false);
        });
      }
    });
  }

  it("default surfaces use action-verb framing for staleness", () => {
    // Combined check: at least one default surface uses an action-verb
    // refresh prompt. If we ever delete all of them at once, we've
    // regressed to the pre-T6.4 scared framing.
    const allCode = DEFAULT_SURFACES.map(readSurfaceCode).join("\n");
    expect(
      /Refresh recommended/.test(allCode) || /Refresh due/.test(allCode),
      "At least one default surface must surface an action-verb refresh prompt " +
        "('Refresh recommended' or 'Refresh due'). Without this, the staleness " +
        "framing has lost its actionable framing.",
    ).toBe(true);
  });
});
