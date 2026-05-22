/**
 * Architecture invariant — Section 7 C7d off-site customer-tile
 * no-queue contract (2026-05-22).
 *
 * C7d is a READ-ONLY customer surface. Off-site rows are permanently
 * blocked from customer-queue promotion (locked
 * `recommendation-intelligence-offsite-contract` → `diagnostic_only`).
 * The C7d tile + its Today section must NOT:
 *   • import the recommendation-intelligence queue emitter, the
 *     promotion writer, the off-site→queue adapter, the
 *     recommended-edits persistence layer, or `runProviderAndPersist`;
 *   • expose any Accept / Defer / Dismiss action (no server action, no
 *     `<form action=...>`, no recommendation-response handler).
 *
 * The tile reads ONLY the cached off-site snapshot path
 * (`loadOffSitePresenceSnapshot` + the pure
 * `computeOffSiteRecommendationCandidates`); no connector / API /
 * scrape / LLM call (those are pinned separately by
 * `off-site-authority-no-paid-or-scan-or-llm`).
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TILE = "src/components/today/off-site-authority-tile.tsx";
const SECTION = "src/app/(shell)/today-v2-sections.tsx";
const OFFSITE_CONTRACT =
  "tests/architecture/recommendation-intelligence-offsite-contract.test.ts";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TILE_ACTIVE = stripComments(read(TILE));
const SECTION_ACTIVE = stripComments(read(SECTION));

// Queue / promotion / persistence module substrings forbidden in the
// C7d read surfaces.
const FORBIDDEN_IMPORT_SUBSTRINGS: ReadonlyArray<string> = [
  "recommendation-intelligence/emitter",
  "recommendation-intelligence/promotion-writer",
  "promotion-result-to-edit-row",
  "off-site-authority/to-candidate-row",
  "recommended-edits-persistence",
  "runProviderAndPersist",
  "recommendation-actions",
  "respondToRecommendation",
];

describe("Architecture — Section 7 C7d off-site tile no-queue", () => {
  it("the offsite-contract invariant file still exists (diagnostic_only contract intact)", () => {
    expect(existsSync(resolve(REPO_ROOT, OFFSITE_CONTRACT))).toBe(true);
  });

  describe("tile does not import queue / promotion / persistence modules", () => {
    for (const sub of FORBIDDEN_IMPORT_SUBSTRINGS) {
      it(`${TILE} does not reference '${sub}'`, () => {
        expect(TILE_ACTIVE.includes(sub)).toBe(false);
      });
    }
  });

  describe("Today section does not import queue / promotion / persistence modules", () => {
    for (const sub of FORBIDDEN_IMPORT_SUBSTRINGS) {
      it(`${SECTION} does not reference '${sub}'`, () => {
        expect(SECTION_ACTIVE.includes(sub)).toBe(false);
      });
    }
  });

  it("tile exposes no Accept / Defer / Dismiss action affordance", () => {
    expect(TILE_ACTIVE.includes('"use server"')).toBe(false);
    expect(TILE_ACTIVE.includes("<form")).toBe(false);
    expect(/action=\{/.test(TILE_ACTIVE)).toBe(false);
    expect(/<button/i.test(TILE_ACTIVE)).toBe(false);
  });

  it("the off-site Today section reads ONLY the cached snapshot path (positive)", () => {
    expect(SECTION_ACTIVE).toContain("loadOffSitePresenceSnapshot");
    expect(SECTION_ACTIVE).toContain("computeOffSiteRecommendationCandidates");
  });
});
