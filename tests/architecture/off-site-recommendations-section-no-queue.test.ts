/**
 * Architecture invariant — Section 7 C7e off-site recommendations
 * section no-queue contract (2026-05-22).
 *
 * The C7e section (`src/app/(shell)/recommendations/off-site-
 * opportunities-section.tsx`) is a READ-ONLY region BELOW the
 * website-edit recommendation queue. Off-site rows are permanently
 * blocked from the queue (locked `recommendation-intelligence-offsite-
 * contract` → `diagnostic_only`); the section must NOT:
 *   • import the recommendation-intelligence queue emitter, the
 *     promotion writer, the off-site→queue adapter, the website-edit
 *     queue loader (`load-queue`), the recommended-edits persistence
 *     layer, `runProviderAndPersist`, or the Accept/Defer/Dismiss
 *     recommendation-response action;
 *   • expose any Accept / Defer / Dismiss affordance (no server action,
 *     no `<form action=...>`, no `<button>`).
 *
 * The section reads ONLY the cached off-site snapshot path
 * (`loadOffSitePresenceSnapshot` + the pure
 * `computeOffSiteRecommendationCandidates`) and reuses the C7d
 * presentation tile.
 *
 * NOTE: this invariant scans ONLY the section file — `recommendations/
 * page.tsx` legitimately imports the website-edit queue loaders for the
 * primary queue, so it is intentionally NOT scanned here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SECTION =
  "src/app/(shell)/recommendations/off-site-opportunities-section.tsx";
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

const SECTION_ACTIVE = stripComments(read(SECTION));

const FORBIDDEN_IMPORT_SUBSTRINGS: ReadonlyArray<string> = [
  "recommendation-intelligence/emitter",
  "recommendation-intelligence/promotion-writer",
  "promotion-result-to-edit-row",
  "off-site-authority/to-candidate-row",
  "recommended-edits-persistence",
  "runProviderAndPersist",
  "recommendation-actions",
  "respondToRecommendation",
  // The website-edit queue loader — off-site never joins that queue.
  "load-queue",
];

describe("Architecture — Section 7 C7e off-site recommendations section no-queue", () => {
  it("the offsite-contract invariant file still exists (diagnostic_only contract intact)", () => {
    expect(existsSync(resolve(REPO_ROOT, OFFSITE_CONTRACT))).toBe(true);
  });

  describe("section does not import queue / promotion / persistence modules", () => {
    for (const sub of FORBIDDEN_IMPORT_SUBSTRINGS) {
      it(`${SECTION} does not reference '${sub}'`, () => {
        expect(SECTION_ACTIVE.includes(sub)).toBe(false);
      });
    }
  });

  it("section exposes no Accept / Defer / Dismiss affordance", () => {
    expect(SECTION_ACTIVE.includes('"use server"')).toBe(false);
    expect(SECTION_ACTIVE.includes("<form")).toBe(false);
    expect(/action=\{/.test(SECTION_ACTIVE)).toBe(false);
    expect(/<button/i.test(SECTION_ACTIVE)).toBe(false);
  });

  it("section reads ONLY the cached snapshot path (positive)", () => {
    expect(SECTION_ACTIVE).toContain("loadOffSitePresenceSnapshot");
    expect(SECTION_ACTIVE).toContain("computeOffSiteRecommendationCandidates");
  });

  it("section reuses the C7d presentation tile (no rendering duplication)", () => {
    expect(SECTION_ACTIVE).toContain("OffSiteAuthorityTile");
  });
});
