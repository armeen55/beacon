/**
 * Slice 4.5.B.α₀ — customer-copy-templates unit tests.
 *
 * Behavioral assertions on the operator-locked phrasing. The
 * vocab-safety scan lives in
 * `tests/architecture/recommendation-intelligence-customer-copy-vocab.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  missingMetaCopy,
  missingTitleCopy,
} from "@/domains/recommendation-intelligence/customer-copy-templates";

describe("customer-copy templates (α₀)", () => {
  it("missingTitleCopy returns the operator-locked phrasing", () => {
    expect(missingTitleCopy()).toBe(
      "Add a clear page title so AI search platforms can surface this page accurately.",
    );
  });

  it("missingMetaCopy returns the operator-locked phrasing", () => {
    expect(missingMetaCopy()).toBe(
      "Add a meta description so AI search platforms have a clean snippet to extract.",
    );
  });

  it("template outputs are pure (same call → same output)", () => {
    expect(missingTitleCopy()).toBe(missingTitleCopy());
    expect(missingMetaCopy()).toBe(missingMetaCopy());
  });
});
