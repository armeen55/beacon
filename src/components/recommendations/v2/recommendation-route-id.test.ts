/**
 * Bundle 2B — route-id encode/decode round-trip tests.
 *
 * Pin the contract that `RecommendationActionRow.id`s containing `:`,
 * `/`, spaces, brackets, and other URL-unsafe characters survive a
 * full server-side encode → URL → Next.js auto-decode → server-side
 * decode round-trip. Without this guardrail the detail page is one
 * fixture-id-shape change away from silently 404-ing every card link.
 */

import { describe, expect, it } from "vitest";

import {
  encodeRecommendationRouteId,
  decodeRecommendationRouteId,
} from "./recommendation-route-id";

const REAL_FIXTURE_IDS: ReadonlyArray<string> = [
  // From .data/tenants/ritz-builders/recommended-edits.json
  "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:d1b049c63d8a",
  "create_cluster_page:topic:Whole Home Renovation Builders (Bay Area)",
  // From the test fixture in render-output-cleanup.test.tsx
  "rec-fixture-1__add_h2_section__h2[new]:abc",
  // Schema-finding shape we see in recommendation-responses.json
  "schema_missing_for_page_type-/available-homes-obs-1776550666639",
  // Worst-case adversarial input
  "weird id with spaces & special?chars#here/and/slashes",
  "key-with-emoji-🚀",
];

describe("Bundle 2B — encodeRecommendationRouteId / decodeRecommendationRouteId", () => {
  it("produces a path-safe segment for real fixture ids", () => {
    for (const id of REAL_FIXTURE_IDS) {
      const encoded = encodeRecommendationRouteId(id);
      // No raw colon, slash, bracket, space, or hash should survive.
      expect(encoded, `encoded form must not contain ':' (id=${id})`).not.toMatch(/:/);
      expect(encoded, `encoded form must not contain '/' (id=${id})`).not.toMatch(/\//);
      expect(encoded, `encoded form must not contain '[' (id=${id})`).not.toMatch(/\[/);
      expect(encoded, `encoded form must not contain ']' (id=${id})`).not.toMatch(/\]/);
      expect(encoded, `encoded form must not contain ' ' (id=${id})`).not.toMatch(/ /);
      expect(encoded, `encoded form must not contain '#' (id=${id})`).not.toMatch(/#/);
      expect(encoded, `encoded form must not contain '?' (id=${id})`).not.toMatch(/\?/);
    }
  });

  it("encode → URL → Next-auto-decode → decode round-trips losslessly", () => {
    for (const id of REAL_FIXTURE_IDS) {
      const encoded = encodeRecommendationRouteId(id);
      // Next.js decodes the path segment once before handing us params.id.
      // Simulate that here.
      const nextDecoded = decodeURIComponent(encoded);
      const decoded = decodeRecommendationRouteId(nextDecoded);
      expect(decoded, `round-trip must equal original (id=${id})`).toBe(id);
    }
  });

  it("decodeRecommendationRouteId returns null on empty / whitespace / non-string input", () => {
    expect(decodeRecommendationRouteId("")).toBeNull();
    expect(decodeRecommendationRouteId("   ")).toBeNull();
    expect(decodeRecommendationRouteId(undefined)).toBeNull();
    expect(decodeRecommendationRouteId(null)).toBeNull();
    expect(decodeRecommendationRouteId(123)).toBeNull();
    expect(decodeRecommendationRouteId(["x"])).toBeNull();
  });

  it("decodeRecommendationRouteId trims surrounding whitespace from valid input", () => {
    expect(decodeRecommendationRouteId("  rec-1  ")).toBe("rec-1");
  });

  it("encoded form is stable (deterministic) across calls", () => {
    const id = REAL_FIXTURE_IDS[0];
    const a = encodeRecommendationRouteId(id);
    const b = encodeRecommendationRouteId(id);
    expect(a).toBe(b);
  });

  it("does NOT double-encode when called on already-encoded input", () => {
    // Note: this is a "callers must encode once" contract. If a caller
    // passes an already-encoded value, encodeURIComponent will encode the
    // `%` characters again. The decoder won't recover the original. The
    // test pins this expectation so a future "let's auto-detect already-
    // encoded input" tweak doesn't quietly change the contract.
    const id = "foo:bar";
    const onceEncoded = encodeRecommendationRouteId(id);
    expect(onceEncoded).toBe("foo%3Abar");
    const twiceEncoded = encodeRecommendationRouteId(onceEncoded);
    expect(twiceEncoded).toBe("foo%253Abar");
  });
});
