/**
 * M4 (operator audit, 2026-05-05) — Mark Shipped is restricted to
 * `accepted` rows only. Showing the button on `recommended` rows
 * conflates Accept with Mark Shipped: a single click would silently
 * skip the Accept step and stamp `verified_live`. The operator
 * audit said "do not confuse Accept with Mark Shipped."
 *
 * This invariant pins TWO contracts on the source:
 *
 *   1. `/changes` per-row Mark Shipped button (scorecard-client.tsx)
 *      gates on `lifecycleStatus === "accepted"` only — NOT on
 *      `recommended`. The "stale pending" tint may still fire on
 *      either status (the row IS pending in both cases) but the
 *      button itself is `accepted`-gated.
 *
 *   2. `/changes` server action (`markChangelogEditShipped`) refuses
 *      `recommended` rows with a CLEAR error directing the operator
 *      to Accept first. Defense in depth: a stale tab or direct API
 *      call must not skip Accept.
 *
 *   3. The post-flip feedback copy is correlation-toned ("verdict
 *      clock started") — Mark Shipped MUST NOT auto-claim impact.
 *      The verdict engine still has to compute the lift on the next
 *      materialize pass; Mark Shipped only stamps `live_at`.
 *
 * Source-text invariant rather than runtime/render: the scorecard is
 * an internal client component nested under multiple data props that
 * change shape often; pinning the lexical contract on the gate
 * expression is more robust against unrelated layout shuffles.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SCORECARD_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/scorecard-client.tsx",
);
const CHANGES_ACTION_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/actions.ts",
);
const RECS_CLIENT_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/recommendations/recommendations-client.tsx",
);

describe("M4 — /changes Mark Shipped button is accepted-only", () => {
  it("scorecard-client.tsx exists and is loaded for inspection", () => {
    expect(existsSync(SCORECARD_PATH)).toBe(true);
  });

  it("canMarkShipped gate is `lifecycleStatus === \"accepted\"` and excludes `recommended`", () => {
    const src = readFileSync(SCORECARD_PATH, "utf-8");
    // The gate must be present and accepted-only.
    expect(
      src.includes('canMarkShipped = lifecycleStatus === "accepted"'),
      "scorecard-client must gate Mark Shipped on `accepted` only (M4 — operator audit 2026-05-05)",
    ).toBe(true);
    // The legacy `(recommended || accepted)` shape must NOT appear in
    // the canMarkShipped binding.
    const legacyShape =
      'canMarkShipped =\n    lifecycleStatus === "recommended" || lifecycleStatus === "accepted"';
    expect(
      src.includes(legacyShape),
      "scorecard-client must not include `recommended` in the Mark Shipped gate (M4)",
    ).toBe(false);
  });

  it("button renders inside `{canMarkShipped && (…)}` (so recommended rows hide it)", () => {
    const src = readFileSync(SCORECARD_PATH, "utf-8");
    // Find the {canMarkShipped && (…)} guard; it must wrap the
    // Mark Shipped <button>. The simplest robust check: the literal
    // "Mark shipped" string must appear AFTER `{canMarkShipped &&`
    // and BEFORE the matching `)}` close (counted naively). We
    // approximate "matching close" by finding the next `)}` that
    // is preceded by `</div>` (the button group's wrapper).
    const guardIdx = src.indexOf("{canMarkShipped &&");
    expect(
      guardIdx,
      "scorecard-client must include `{canMarkShipped && (…)}` guard (M4)",
    ).toBeGreaterThan(0);
    const markIdx = src.indexOf("Mark shipped", guardIdx);
    expect(
      markIdx,
      "'Mark shipped' literal must appear after the canMarkShipped guard (M4)",
    ).toBeGreaterThan(guardIdx);
    // After the button, the canMarkShipped block must close. We don't
    // try to count braces; we just confirm the next `canMarkShipped`
    // reference (if any) is far enough away that we're not double-
    // counting another guard. This is heuristic — the key invariant
    // is the order: guard → button.
    const guardEndApprox = src.indexOf(")}\n", markIdx);
    expect(
      guardEndApprox,
      "canMarkShipped guard block must close after the Mark Shipped button (M4)",
    ).toBeGreaterThan(markIdx);
  });
});

describe("M4 — /changes markChangelogEditShipped action refuses `recommended`", () => {
  it("action source explicitly rejects `recommended` with an Accept-first message", () => {
    const src = readFileSync(CHANGES_ACTION_PATH, "utf-8");
    expect(
      src.includes('if (status === "recommended")'),
      "markChangelogEditShipped must explicitly branch on `recommended` (M4)",
    ).toBe(true);
    expect(
      src.includes("Accept the recommendation first"),
      "markChangelogEditShipped must direct the operator to Accept first when called on a `recommended` row (M4)",
    ).toBe(true);
    // The post-Accept honest copy ("verdict clock started") must
    // still appear in the flip-success path on the client side.
    const scorecardSrc = readFileSync(SCORECARD_PATH, "utf-8");
    expect(
      scorecardSrc.includes("verdict clock started"),
      "Mark Shipped feedback must lead with 'verdict clock started' (tracking, not impact-claim) — M4",
    ).toBe(true);
  });
});

describe("M4 — /recommendations Mark Shipped button is accepted-only", () => {
  it("Mark Shipped button only renders in the `accepted` branch", () => {
    const src = readFileSync(RECS_CLIENT_PATH, "utf-8");
    // The Action column dispatches by row.status. Mark Shipped lives
    // inside `case "accepted":`. We pin: the literal "Mark shipped"
    // appears, AND the renderShippedAction switch (or its surroundings)
    // must dispatch under the `accepted` case.
    expect(src.includes("Mark shipped")).toBe(true);
    expect(
      src.includes('case "accepted":'),
      "/recommendations Action column must have an `accepted` case where Mark Shipped lives (M4)",
    ).toBe(true);
    // No `case "recommended":` next to a Mark Shipped reference. We
    // can't lex-prove this fully, but we pin: the `recommended` case
    // (`case "new":` or `case "recommended":`) must NOT contain the
    // mark_shipped data attribute.
    const recommendedCase = src.indexOf('case "new":');
    const acceptedCase = src.indexOf('case "accepted":');
    if (recommendedCase >= 0 && acceptedCase > recommendedCase) {
      const recommendedSlice = src.slice(recommendedCase, acceptedCase);
      expect(
        recommendedSlice.includes('data-rec-action-button="mark_shipped"'),
        "Mark Shipped button must not appear in the `new` (recommended) action-column branch (M4)",
      ).toBe(false);
    }
  });

  it("post-flip success copy is honest about tracking, not claiming impact", () => {
    const src = readFileSync(RECS_CLIENT_PATH, "utf-8");
    // Honest copy: "verdict clock started" — describes that the math
    // engine starts measuring, not that an impact has landed.
    expect(
      src.includes("verdict clock started"),
      "/recommendations post-flip copy must use 'verdict clock started' wording (M4)",
    ).toBe(true);
    // Forbidden auto-impact-claim copy:
    const forbidden = [
      "Marked as winning",
      "Verified win",
      "Impact confirmed",
      "Lift recorded",
    ];
    for (const phrase of forbidden) {
      expect(
        src.includes(phrase),
        `/recommendations Mark Shipped copy must NOT include "${phrase}" (M4)`,
      ).toBe(false);
    }
  });
});

describe("M4 — markRecommendedEditsAsShipped persistence is tracking-only (no verdict stamp)", () => {
  it("persistence helper does not stamp a verdict label on the row", () => {
    const persistencePath = join(
      REPO_ROOT,
      "src/domains/recommendations/recommended-edits-persistence.ts",
    );
    const src = readFileSync(persistencePath, "utf-8");
    // The flipped row sets implementation_status to "verified_live"
    // (a lifecycle truth: "the change is live on the page") but
    // does NOT set any helping/hurting/landing_z field. The verdict
    // engine computes those on the next materialize pass.
    const flipBlock = src.slice(
      src.indexOf("export async function markRecommendedEditsAsShipped"),
    );
    const truncated = flipBlock.slice(0, 4000);
    expect(truncated).toContain('implementation_status: "verified_live"');
    // Sanity: the verdict label fields ("helping" / "hurting") must
    // NOT appear in the flipped-row literal — those live on
    // url_change_outcomes, populated separately.
    const verdictLabelInFlip =
      /verdict:\s*['"](helping|hurting|nothing_yet)['"]/.test(truncated);
    expect(
      verdictLabelInFlip,
      "markRecommendedEditsAsShipped must not stamp a verdict label on the flipped row (M4 — Mark Shipped is tracking-only, not impact-claiming)",
    ).toBe(false);
  });
});
