import { describe, it, expect } from "vitest";
import {
  sanitizeOperatorCopy,
  sanitizeClusterLabel,
} from "@/domains/recommendations/copy-sanitize";

describe("sanitizeOperatorCopy", () => {
  it("strips Shield: prefix (case-insensitive)", () => {
    expect(sanitizeOperatorCopy("Shield: Luxury Home Builder Bay Area")).toBe(
      "Luxury Home Builder Bay Area",
    );
    expect(sanitizeOperatorCopy("shield:  Custom Home Builder Bay Area")).toBe(
      "Custom Home Builder Bay Area",
    );
  });

  it("strips multiple stacked internal prefixes", () => {
    expect(sanitizeOperatorCopy("Internal: Shield: Luxury Home Builder")).toBe(
      "Luxury Home Builder",
    );
  });

  it("leaves already-clean strings untouched", () => {
    expect(sanitizeOperatorCopy("Palo Alto")).toBe("Palo Alto");
    expect(sanitizeOperatorCopy("Luxury Home Builder Bay Area")).toBe(
      "Luxury Home Builder Bay Area",
    );
  });

  it("handles null / empty gracefully", () => {
    expect(sanitizeOperatorCopy(null)).toBe("");
    expect(sanitizeOperatorCopy(undefined)).toBe("");
    expect(sanitizeOperatorCopy("")).toBe("");
    expect(sanitizeOperatorCopy("   ")).toBe("");
  });

  it("sanitizeClusterLabel returns null when sanitized output is empty", () => {
    expect(sanitizeClusterLabel(null)).toBeNull();
    expect(sanitizeClusterLabel("")).toBeNull();
    expect(sanitizeClusterLabel("Shield:")).toBeNull();
    expect(sanitizeClusterLabel("Shield: Palo Alto")).toBe("Palo Alto");
  });

  it("does not hang on pathological input with only prefixes", () => {
    const input = "Shield: Shield: Shield: Shield: ";
    expect(sanitizeOperatorCopy(input)).toBe("");
  });
});
