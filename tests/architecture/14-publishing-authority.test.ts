/**
 * CONSTITUTION §4 — Publishing authority.
 *
 * Consolidated from mark-shipped-publish-auth + mark-shipped-accepted-only.
 * (Push caps / armed-mode fail-closed staging live in the sibling
 * 14b-publishing-stage-in-wix.) Pins:
 *   1. Every manual verified-live override checks canPublishForCurrentTenant()
 *      BEFORE any tenant work — publish authority is enforced at the action.
 *   2. Mark Shipped refuses `recommended` rows (Accept-first), and the
 *      persistence flip is tracking-only: it stamps live_at/verified_live
 *      but never a helping/hurting verdict (no impact self-claim).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../..");

describe("manual verified-live overrides enforce tenant publish authority", () => {
  for (const [label, rel, action] of [
    ["Changes", "src/app/(shell)/changes/actions.ts", "markChangelogEditShipped"],
    [
      "Recommendations",
      "src/app/(shell)/recommendations/actions.ts",
      "markRecommendationShipped",
    ],
  ] as const) {
    it(`${label} checks canPublishForCurrentTenant inside ${action}`, () => {
      const source = readFileSync(resolve(ROOT, rel), "utf8");
      const start = source.indexOf(`export async function ${action}`);
      expect(start).toBeGreaterThan(-1);
      const body = source.slice(start, start + 1_600);
      expect(body).toContain("await canPublishForCurrentTenant()");
      expect(body.indexOf("await canPublishForCurrentTenant()")).toBeLessThan(
        body.indexOf("await currentTenantId()"),
      );
    });
  }
});

describe("Mark Shipped is accepted-only and tracking-only (no impact self-claim)", () => {
  const CHANGES_ACTION = join(ROOT, "src/app/(shell)/changes/actions.ts");
  const V2_CARD = join(ROOT, "src/components/changes/v2/changes-v2-card.tsx");
  const PERSISTENCE = join(
    ROOT,
    "src/domains/recommendations/recommended-edits-persistence.ts",
  );

  it("markChangelogEditShipped refuses `recommended` with an Accept-first message", () => {
    const src = readFileSync(CHANGES_ACTION, "utf-8");
    expect(src.includes('if (status === "recommended")')).toBe(true);
    expect(src.includes("Accept the recommendation first")).toBe(true);
  });

  it("the V2 changes card surfaces the Mark Shipped affordance", () => {
    expect(existsSync(V2_CARD)).toBe(true);
    expect(readFileSync(V2_CARD, "utf-8").includes("Mark shipped")).toBe(true);
  });

  it("the shipped flip is tracking-only — verified_live, never a verdict label", () => {
    const src = readFileSync(PERSISTENCE, "utf-8");
    const flip = src
      .slice(src.indexOf("export async function markRecommendedEditsAsShipped"))
      .slice(0, 4000);
    expect(flip).toContain('implementation_status: "verified_live"');
    expect(/verdict:\s*['"](helping|hurting|nothing_yet)['"]/.test(flip)).toBe(
      false,
    );
  });
});
