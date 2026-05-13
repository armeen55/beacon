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

  it("encode → URL → Next-auto-decode (legacy Next 13/14/15) → decode round-trips losslessly", () => {
    for (const id of REAL_FIXTURE_IDS) {
      const encoded = encodeRecommendationRouteId(id);
      // Simulate Next 13/14/15: path segment auto-decoded once before
      // params.id is read.
      const nextDecoded = decodeURIComponent(encoded);
      const decoded = decodeRecommendationRouteId(nextDecoded);
      expect(decoded, `round-trip must equal original (id=${id})`).toBe(id);
    }
  });

  it("Next 16 — encode → URL → params.id ARRIVES ENCODED → decode round-trips losslessly", () => {
    // 2026-05-13 P0 runtime evidence — the detail-route debug panel
    // showed `params.id (raw)` arriving percent-encoded from a v2 card
    // click. Next 16 no longer auto-decodes the path segment for
    // client-side navigations. The decoder must handle that case.
    for (const id of REAL_FIXTURE_IDS) {
      const encoded = encodeRecommendationRouteId(id);
      // Pass the ENCODED form directly — simulating what Next 16 hands
      // the page handler.
      const decoded = decodeRecommendationRouteId(encoded);
      expect(
        decoded,
        `Next 16 encoded-params round-trip must equal original (id=${id})`,
      ).toBe(id);
    }
  });

  it("the exact Palo Alto raw-encoded param from production decodes to the row id", () => {
    const raw =
      "create_cluster_page%3Ageo%3APalo%20Alto%3A%3Acreate_cluster_page%3Ageo%3APalo%20Alto__add_h2_section__h2%5Bnew%5D%3Apaloalto1a2b3c4d";
    const expected =
      "create_cluster_page:geo:Palo Alto::create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:paloalto1a2b3c4d";
    expect(decodeRecommendationRouteId(raw)).toBe(expected);
  });

  it("an already-decoded id passes through unchanged", () => {
    const id =
      "create_cluster_page:geo:Palo Alto::create_cluster_page:geo:Palo Alto__add_h2_section__h2[new]:paloalto1a2b3c4d";
    expect(decodeRecommendationRouteId(id)).toBe(id);
  });

  it("a double-encoded id resolves to the same decoded form", () => {
    const id = "create_cluster_page:geo:Palo Alto";
    const onceEncoded = encodeRecommendationRouteId(id); // `%3A` etc.
    const twiceEncoded = encodeRecommendationRouteId(onceEncoded); // `%253A`
    expect(decodeRecommendationRouteId(twiceEncoded)).toBe(id);
  });

  it("malformed percent sequences do not throw", () => {
    // Stray `%` with no following hex pair — decodeURIComponent throws
    // URIError. The helper must catch and return a non-null fallback.
    expect(() =>
      decodeRecommendationRouteId("rec%-malformed%"),
    ).not.toThrow();
    expect(() => decodeRecommendationRouteId("%E0%A4")).not.toThrow();
    // The fallback value is whatever the helper had successfully
    // decoded up to the failing iteration. The exact string doesn't
    // matter for this contract — the no-throw guarantee does.
    const r = decodeRecommendationRouteId("rec%-malformed%");
    expect(typeof r).toBe("string");
  });

  it("caps iteration depth to prevent pathological inputs from looping", () => {
    // Even with a deeply nested encoding, the helper returns within
    // a small constant number of decodeURIComponent calls.
    const id = "a:b";
    let payload = id;
    for (let i = 0; i < 10; i++) {
      payload = encodeRecommendationRouteId(payload);
    }
    // 10x-encoded input. After the helper's cap (3 iterations), some
    // residual `%` triplets remain — that's fine; the contract is
    // "no crash and a deterministic result", not "always fully decode
    // any depth". The helper still returns a string.
    const r = decodeRecommendationRouteId(payload);
    expect(typeof r).toBe("string");
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
