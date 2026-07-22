import { describe, it, expect } from "vitest";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import {
  getResponseFromMap,
  isRecSuppressedFromMap,
} from "@/domains/product/recommendation-response-store";

// ---------------------------------------------------------------------------
// Sprint 4 / Phase 4.3 regression tests — Today's recommendation response
// freshness across Vercel lambdas.
//
// today-data.ts used to call isRecSuppressed / getResponse / read
// `recommendationResponses` directly from the module-level array. Same
// cross-lambda staleness bug as Phase 4.2 fixed on /recommendations. A rec
// the operator dismissed on lambda B would reappear as Top Pick on lambda A
// whose `_dbSeeded=true` was already cached.
//
// Phase 4.3 adds pure `getResponseFromMap` / `isRecSuppressedFromMap`
// helpers in the response store, and today-data fetches responses fresh
// from the repository per render, builds a Map, and uses the pure helpers.
//
// 2026-07-01 (FINAL PREMIUM PLAN item 101): the legacy today-data.ts
// loader was deleted. 2026-07-21 (Lane S): the today-v2-data.ts section
// loaders (the structural-pin subject that replaced it) were dead code and
// were also deleted, so only the pure-helper unit pins remain here.
//
// These tests prove:
//   Pure helpers (unit):
//     (5) `isRecSuppressedFromMap` suppresses a dismissed rec
//     (6) `isRecSuppressedFromMap` suppresses a deferred rec while
//         `deferUntil` is in the future
//     (7) `isRecSuppressedFromMap` does NOT suppress a deferred rec after
//         `deferUntil` has passed
//     (8) `isRecSuppressedFromMap` does NOT suppress an accepted rec
//     (9) `isRecSuppressedFromMap` does NOT suppress a rec that has no
//         response in the map (fresh repo truth)
//    (10) `getResponseFromMap` returns the exact record stored in the map
//    (11) `getResponseFromMap` returns undefined when rec is absent —
//         meaning a stale module-level dismissal CANNOT bleed through the
//         fresh map (the helper only sees what was passed in)
// ---------------------------------------------------------------------------

describe("Sprint 4 / Phase 4.3 — Today fresh-read invariants", () => {
  describe("pure helpers (unit)", () => {
    const makeMap = (rows: RecommendationResponse[]) =>
      new Map(rows.map((r) => [r.recId, r]));

    const baseRow = (
      overrides: Partial<RecommendationResponse>,
    ): RecommendationResponse => ({
      recId: "rec-1",
      status: "accepted",
      respondedAt: "2026-04-24T10:00:00.000Z",
      deferUntil: null,
      targetPageUrl: null,
      patternId: null,
      ...overrides,
    });

    it("suppresses a dismissed rec", () => {
      const m = makeMap([baseRow({ status: "dismissed" })]);
      expect(isRecSuppressedFromMap("rec-1", m)).toBe(true);
    });

    it("suppresses a deferred rec while deferUntil is in the future", () => {
      const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const m = makeMap([
        baseRow({ status: "deferred", deferUntil: future }),
      ]);
      expect(isRecSuppressedFromMap("rec-1", m)).toBe(true);
    });

    it("does NOT suppress a deferred rec once deferUntil has passed", () => {
      const past = new Date(Date.now() - 86_400_000).toISOString();
      const m = makeMap([
        baseRow({ status: "deferred", deferUntil: past }),
      ]);
      expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
    });

    it("does NOT suppress an accepted rec (operator saw it; keeps visible in Today card with state)", () => {
      const m = makeMap([baseRow({ status: "accepted" })]);
      expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
    });

    it("does NOT suppress a rec that has no response in the map", () => {
      const m = makeMap([]);
      expect(isRecSuppressedFromMap("rec-1", m)).toBe(false);
    });

    it("getResponseFromMap returns the exact record stored in the map", () => {
      const row = baseRow({ status: "deferred", deferUntil: "2026-05-01T00:00:00.000Z" });
      const m = makeMap([row]);
      expect(getResponseFromMap("rec-1", m)).toEqual(row);
    });

    it("getResponseFromMap returns undefined when rec is absent — stale module memory cannot leak through", () => {
      // The key invariant: callers passing the fresh Map will ONLY see
      // what the fresh repo fetch returned. A stale module-level dismissal
      // cannot bleed into this call because the helper has no access to
      // that array.
      const m = makeMap([]);
      expect(getResponseFromMap("rec-1", m)).toBeUndefined();
    });

    it("suppresses a rec dismissed on /recommendations (stableKey key-space) — canonical-key alignment", () => {
      // Exact production scenario that hotfix addresses:
      //
      // Operator dismisses on /recommendations. /recommendations/actions.ts
      // writes `recommendation_responses.rec_id = payload.stableKey` which
      // has the shape `{type}:{clusterKind}:{clusterLabel}`.
      //
      // Today fetches fresh responses into a Map keyed by recId. When
      // Today's new-pipeline queue item is passed to suppression,
      // `rec.stableKey` must match. If Today used `rec.id` from the OLD
      // engine (different key space), the Map lookup would miss and
      // suppression would silently no-op.
      //
      // This test pins the canonical-key contract: a stableKey-formatted
      // key in the Map suppresses via the same stableKey lookup.
      const stableKey =
        "create_cluster_page:topic:Shield: Custom Home Builder Bay Area";
      const m = makeMap([
        baseRow({ recId: stableKey, status: "dismissed" }),
      ]);
      expect(isRecSuppressedFromMap(stableKey, m)).toBe(true);
      // And if Today were (wrongly) to call with a different key (e.g.
      // old-engine `rec.id` shape), suppression would NOT fire — the
      // helper only sees what you pass. This pins the mismatch failure
      // mode so a future regression (swapping rec.stableKey for rec.id)
      // would flip this assertion visibly.
      expect(
        isRecSuppressedFromMap("rec-strengthen-custom-home-builder", m),
      ).toBe(false);
    });
  });
});
