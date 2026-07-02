import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
// loader was deleted. The live /today loader (today-v2-data.ts) reads
// responses fresh per render via the tenant-scoped repo, so the
// structural pins below now target that file.
//
// These tests prove:
//   Structural (today-v2-data.ts source):
//     (1) does NOT import the stale readers (`isRecSuppressed`,
//         `getResponse`, `recommendationResponses`) from the response store
//     (2) DOES read responses fresh via the tenant-scoped repo at render
//     (3) has no residual references to the stale module-level array
//         on the render path
//
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

const TODAY_DATA_PATH = resolve(
  __dirname,
  "../../src/app/(shell)/today-v2-data.ts",
);
const TODAY_DATA_SOURCE = readFileSync(TODAY_DATA_PATH, "utf8");

describe("Sprint 4 / Phase 4.3 — Today fresh-read invariants", () => {
  describe("structural invariants (today-v2-data.ts source)", () => {
    it("does NOT import stale readers from recommendation-response-store", () => {
      // Allowed imports: ensureRecommendationResponsesSeeded (the seed is
      // idempotent and still needed for non-render callers), type imports.
      // Forbidden: getResponse (stale reader), isRecSuppressed (stale
      // reader), recommendationResponses (module-level array).
      const importBlocks = TODAY_DATA_SOURCE.match(
        /import\s+\{[^}]+\}\s+from\s+["'][^"']*recommendation-response-store["']/g,
      );
      expect(importBlocks).not.toBeNull();
      for (const block of importBlocks!) {
        expect(block).not.toMatch(/\bisRecSuppressed\b(?!FromMap)/);
        expect(block).not.toMatch(/\bgetResponse\b(?!FromMap)/);
        expect(block).not.toMatch(/\brecommendationResponses\b/);
      }
    });

    it("DOES read responses fresh via the tenant-scoped repo at render", () => {
      // The V2 action-cards loader reads recommendation responses per
      // render from the tenant-bound repo (no module-level cache).
      expect(TODAY_DATA_SOURCE).toMatch(/getRepository\(\)\.forTenant\(/);
      expect(TODAY_DATA_SOURCE).toMatch(
        /\brepo\.getRecommendationResponses\(\)/,
      );
    });

    it("does NOT call unscoped `getRepository().getRecommendationResponses()` (or other Tier A reads) on the /today render path", () => {
      // Sprint 7 Phase 7.5b Commit 4 — every Tier A read on the /today path
      // must go through `.forTenant(tenantId)`. Catches future drift.
      expect(TODAY_DATA_SOURCE).not.toMatch(
        /getRepository\(\)\.getRecommendationResponses\(/,
      );
      expect(TODAY_DATA_SOURCE).not.toMatch(/getRepository\(\)\.getPageSnapshots\(/);
      expect(TODAY_DATA_SOURCE).not.toMatch(/getRepository\(\)\.getGuardrailAlerts\(/);
      expect(TODAY_DATA_SOURCE).not.toMatch(/getRepository\(\)\.getScanFindings\(/);
    });

    it("has NO residual references to the stale module array or stale readers", () => {
      // Explicit scan — any call site that still reads module-level state
      // means Today's render has a cross-lambda hole. Must return zero
      // matches.
      expect(TODAY_DATA_SOURCE).not.toMatch(/\bisRecSuppressed\b(?!FromMap)/);
      expect(TODAY_DATA_SOURCE).not.toMatch(/\bgetResponse\(/);
      // `recommendationResponses` as a bare identifier (not
      // `freshRecommendationResponses` and not `ensureRecommendationResponsesSeeded`).
      const residual = TODAY_DATA_SOURCE.match(
        /(?<!fresh)(?<!ensure)\brecommendationResponses\b(?!Seeded)/g,
      );
      expect(residual).toBeNull();
    });

    it("dismissals are honored from the FRESH per-render read (win cards + queue)", () => {
      // The legacy stableKey/unsuppressedQueue topPick path was deleted
      // with today-data.ts (2026-07-01, item 101). The V2 loader filters
      // dismissed items against the fresh `recResponses` repo read.
      expect(TODAY_DATA_SOURCE).toMatch(
        /recResponses\.some\(\s*\n?\s*\(r\)\s*=>\s*r\.recId\s*===\s*winCardId\s*&&\s*r\.status\s*===\s*"dismissed"/,
      );
    });
  });

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
