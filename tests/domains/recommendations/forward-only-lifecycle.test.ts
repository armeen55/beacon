/**
 * Forward-only lifecycle guard (audit #3, 2026-06-14).
 *
 * A nightly re-generation re-stamps every promoted row with
 * implementation_status="recommended". Without a guard, persisting those
 * rows overwrites an operator-accepted / live / dismissed row of the same
 * deterministic id — silently un-accepting shipped work and corrupting the
 * proof engine's treatment dates. dropLifecycleLockedRewrites filters those
 * downgrades out (used by both the local file writer and the promotion
 * writer's Supabase sync).
 */

import { describe, it, expect } from "vitest";

import {
  dropLifecycleLockedRewrites,
  LIFECYCLE_LOCKED_STATUSES,
} from "@/domains/recommendations/recommended-edits-persistence";

const incoming = [
  { id: "promotion-aaa__edit_title__null", note: "fresh" },
  { id: "promotion-bbb__edit_meta__null", note: "fresh" },
  { id: "promotion-ccc__change_h1__null", note: "fresh" },
];

describe("dropLifecycleLockedRewrites", () => {
  it("drops an incoming rewrite when its persisted twin is accepted", () => {
    const out = dropLifecycleLockedRewrites(incoming, [
      { id: "promotion-aaa__edit_title__null", implementation_status: "accepted" },
    ]);
    expect(out.map((r) => r.id)).toEqual([
      "promotion-bbb__edit_meta__null",
      "promotion-ccc__change_h1__null",
    ]);
  });

  it("keeps rewrites when the persisted twin is still 'recommended'", () => {
    const out = dropLifecycleLockedRewrites(incoming, [
      { id: "promotion-aaa__edit_title__null", implementation_status: "recommended" },
    ]);
    expect(out).toHaveLength(3);
  });

  it("treats missing/undefined status as refreshable (kept)", () => {
    const out = dropLifecycleLockedRewrites(incoming, [
      { id: "promotion-aaa__edit_title__null" },
    ]);
    expect(out).toHaveLength(3);
  });

  it("locks every operator-acted / live status", () => {
    for (const status of [
      "accepted",
      "verified_live",
      "verified_live_modified",
      "partially_implemented",
      "dismissed",
    ] as const) {
      const out = dropLifecycleLockedRewrites(
        [{ id: "x" }],
        [{ id: "x", implementation_status: status }],
      );
      expect(out, `status ${status} must lock`).toHaveLength(0);
      expect(LIFECYCLE_LOCKED_STATUSES.has(status)).toBe(true);
    }
  });

  it("does not lock 'recommended' or other non-acted statuses", () => {
    expect(LIFECYCLE_LOCKED_STATUSES.has("recommended" as never)).toBe(false);
    const out = dropLifecycleLockedRewrites(
      [{ id: "x" }],
      [{ id: "x", implementation_status: "recommended" }],
    );
    expect(out).toHaveLength(1);
  });

  it("no existing rows → all incoming kept", () => {
    expect(dropLifecycleLockedRewrites(incoming, [])).toHaveLength(3);
  });
});
