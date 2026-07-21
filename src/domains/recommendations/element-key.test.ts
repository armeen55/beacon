/**
 * Pins the shared element-key hash-suffix extractor (element-key.ts), the
 * pairing identity FAQ bundles use (moved out of the deleted
 * recommendation-action-rows table builder; coverage carried over from
 * recommendation-action-rows-faq-grouping.test.ts).
 */

import { describe, it, expect } from "vitest";
import { extractElementKeyHashSuffix } from "./element-key";

describe("extractElementKeyHashSuffix", () => {
  it("extracts the hash from additive keys", () => {
    expect(extractElementKeyHashSuffix("faq_question[new]:abc12345")).toBe(
      "abc12345",
    );
    expect(extractElementKeyHashSuffix("faq_answer[new]:lux01")).toBe("lux01");
    expect(extractElementKeyHashSuffix("h2[new]:section-hash")).toBe(
      "section-hash",
    );
  });

  it("extracts the suffix from positional keys via the colon fallback", () => {
    expect(extractElementKeyHashSuffix("title[0]:abc")).toBe("abc");
    expect(extractElementKeyHashSuffix("h2[3]:def")).toBe("def");
  });

  it("returns null for null / undefined / malformed keys", () => {
    expect(extractElementKeyHashSuffix(null)).toBeNull();
    expect(extractElementKeyHashSuffix(undefined)).toBeNull();
    expect(extractElementKeyHashSuffix("")).toBeNull();
    expect(extractElementKeyHashSuffix("h2[new]")).toBeNull();
    expect(extractElementKeyHashSuffix("no-colon-key")).toBeNull();
    expect(extractElementKeyHashSuffix(":leading-colon")).toBeNull();
  });
});
