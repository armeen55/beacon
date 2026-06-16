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
const CHANGES_ACTION_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/actions.ts",
);
// Surface collapse (2026-06-15): the legacy scorecard-client +
// recommendations-client were deleted. The customer-facing Mark Shipped
// button + its accepted-only gate now live on the V2 surfaces — the
// /changes V2 card (covered by tests/app/changes/changes-v2-client.test.tsx)
// and the V2 recommendation card. This file now pins the SERVER-SIDE
// guarantees (the action refuses `recommended`; persistence is
// tracking-only), which are surface-independent.
const CHANGES_V2_CARD_PATH = join(
  REPO_ROOT,
  "src/components/changes/v2/changes-v2-card.tsx",
);

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
  });

  it("the V2 changes card exists and surfaces the Mark Shipped affordance", () => {
    expect(existsSync(CHANGES_V2_CARD_PATH)).toBe(true);
    const src = readFileSync(CHANGES_V2_CARD_PATH, "utf-8");
    expect(
      src.includes("Mark shipped"),
      "the V2 changes card must surface the Mark Shipped affordance (M4)",
    ).toBe(true);
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
