/**
 * Architecture invariants — UX.6.1 Trust Restoration on /today (2026-05-07).
 *
 * Pins the contract for the trust-breaking-issue fixes that landed in
 * UX.6.1. Only FIX 3 remains live:
 *
 *   FIX 1 — Brain readiness card lying in production. DELETED 2026-07-02
 *     (UX5 legacy sweep): `deriveBrainSummaryFromCounts` and the whole
 *     Command Center feature it fed had zero production callers left —
 *     orphaned since the 2026-06-28 deletion of their only host,
 *     today-v2-sections.tsx.
 *
 *   FIX 2 — Poll health false alarm before scheduled poll. DELETED
 *     2026-07-02 (UX5 legacy sweep): poll-health-calm-banner.tsx had
 *     zero importers — orphaned since the 2026-06-16 deletion of the
 *     legacy today-client.tsx, its only renderer.
 *
 *   FIX 3 — Wins copy too caveated by default (still live below).
 *     - The default-rendered rationale text on win cards leads with
 *       "gained citations" (positive) / "lost citations" (negative)
 *       rather than the "URL-level signal — not proof of causation"
 *       methodology caveat.
 *     - The methodology caveat still lives in lineageBullets so the
 *       drill-down ("Why this verdict?" / detail layer) keeps the
 *       honest disclosure.
 *
 * Negative invariants:
 *   - Fix 3 must NOT remove the causation caveat from the drawer
 *     (lineageBullets); it only repositions the default copy.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

// 2026-07-01 (item 101): legacy today-data.ts deleted; the win-card copy
// (Fix 3) lives in the V2 action-cards loader.
const TODAY_V2_DATA = join(REPO_ROOT, "src/app/(shell)/today-v2-data.ts");

const TODAY_V2_DATA_SRC = readFileSync(TODAY_V2_DATA, "utf-8");

// ---------------------------------------------------------------------------
// FIX 3 — Wins copy: confident default, caveat in drawer
// ---------------------------------------------------------------------------

describe("UX.6.1 Fix 3 — Wins rationale leads with confident copy", () => {
  it("wins rationale uses 'gained / lost citations' default copy", () => {
    expect(TODAY_V2_DATA_SRC).toContain(
      "This page gained citations after the change",
    );
    expect(TODAY_V2_DATA_SRC).toContain(
      "This page lost citations after the change",
    );
  });

  it("wins rationale references repeating-the-pattern framing", () => {
    expect(TODAY_V2_DATA_SRC).toMatch(
      /Beacon is tracking the pattern so you can repeat what worked/,
    );
  });

  it("default rationale does NOT lead with the causation caveat", () => {
    // Search for the OLD copy that the audit flagged as too caveated.
    // The rationale field must NOT start with this phrase. The caveat
    // is allowed to appear ELSEWHERE in the source (in lineageBullets
    // text below) but not in the default-rendered rationale string.
    const rationaleMatch = TODAY_V2_DATA_SRC.match(
      /const\s+rationale\s*=[\s\S]{0,400}?;/,
    );
    expect(rationaleMatch).toBeTruthy();
    if (!rationaleMatch) return;
    const rationaleBody = rationaleMatch[0];
    expect(rationaleBody).not.toMatch(/not proof of causation/i);
    expect(rationaleBody).not.toMatch(/URL-level signal/i);
  });

  it("methodology caveat is preserved in lineageBullets (drawer copy)", () => {
    // The honest disclosure still lives in the drill-down — we only
    // moved it out of the default-rendered rationale.
    expect(TODAY_V2_DATA_SRC).toContain("not proof of causation");
    expect(TODAY_V2_DATA_SRC).toContain("URL-level correlation");
  });
});
