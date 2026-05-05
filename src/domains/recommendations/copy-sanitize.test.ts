/**
 * M2 (operator audit, 2026-05-05) — sanitizer tests for raw prompt
 * UUIDs in operator-visible copy.
 *
 * Operator contract:
 *   • UUID with mapping → "prompt: \"<snippet up to 50 chars>\""
 *   • UUID without mapping → "prompt evidence"
 *   • Non-UUID text → unchanged (idempotent)
 *   • Null / undefined / empty → returned unchanged
 *   • Both Map<string, string> and Record<string, string> are accepted.
 */

import { describe, expect, it } from "vitest";
import {
  containsUuid,
  sanitizeOperatorEvidenceText,
  sanitizeOperatorCopyFields,
} from "./copy-sanitize";

const KNOWN_UUID = "7ee3216b-327c-4de9-9efb-3a92f8a2ad11";
const UNKNOWN_UUID = "deadbeef-1234-5678-9abc-deadbeef0001";

describe("containsUuid", () => {
  it("detects a UUID in text", () => {
    expect(containsUuid(`drawn from prompt ${KNOWN_UUID}`)).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(containsUuid("no uuids here at all")).toBe(false);
  });

  it("returns false for null / undefined / empty", () => {
    expect(containsUuid(null)).toBe(false);
    expect(containsUuid(undefined)).toBe(false);
    expect(containsUuid("")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(containsUuid(`PROMPT ${KNOWN_UUID.toUpperCase()}`)).toBe(true);
  });
});

describe("sanitizeOperatorEvidenceText — Map lookup", () => {
  const map = new Map<string, string>([
    [KNOWN_UUID, "best whole home remodel builders bay area"],
  ]);

  it("replaces UUID with prompt-text snippet when mapping exists", () => {
    const out = sanitizeOperatorEvidenceText(
      `Drawn from actualSearchQueries on prompt ${KNOWN_UUID}: 'foo'`,
      map,
    );
    expect(out).toContain(
      `prompt: "best whole home remodel builders bay area"`,
    );
    expect(out).not.toContain(KNOWN_UUID);
  });

  it("uses 'prompt evidence' fallback for unknown UUID", () => {
    const out = sanitizeOperatorEvidenceText(
      `Inferred from ${UNKNOWN_UUID} signal`,
      map,
    );
    expect(out).toContain("prompt evidence");
    expect(out).not.toContain(UNKNOWN_UUID);
  });

  it("truncates long prompt text to 50 chars + ellipsis", () => {
    const longText =
      "this is an exceptionally long prompt that definitely exceeds the fifty character limit and needs trimming";
    const m = new Map<string, string>([[KNOWN_UUID, longText]]);
    const out = sanitizeOperatorEvidenceText(`See ${KNOWN_UUID}`, m);
    expect(out).toMatch(/prompt: "[^"]{1,50}…"/);
    expect(out).not.toContain(longText);
  });

  it("handles UUID followed by '...' truncation marker", () => {
    const out = sanitizeOperatorEvidenceText(
      `prompt ${KNOWN_UUID}...: x`,
      map,
    );
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("handles multiple UUIDs in one string", () => {
    const out = sanitizeOperatorEvidenceText(
      `From ${KNOWN_UUID} and ${UNKNOWN_UUID} together`,
      map,
    );
    expect(out).toContain(
      `prompt: "best whole home remodel builders bay area"`,
    );
    expect(out).toContain("prompt evidence");
    expect(out).not.toContain(KNOWN_UUID);
    expect(out).not.toContain(UNKNOWN_UUID);
  });
});

describe("sanitizeOperatorEvidenceText — Record lookup", () => {
  const rec: Record<string, string> = {
    [KNOWN_UUID]: "best whole home remodel builders bay area",
  };

  it("works with Record<string, string> just like Map", () => {
    const out = sanitizeOperatorEvidenceText(
      `Drawn from prompt ${KNOWN_UUID}: 'foo'`,
      rec,
    );
    expect(out).toContain(
      `prompt: "best whole home remodel builders bay area"`,
    );
  });

  it("falls back to 'prompt evidence' on unknown key in Record", () => {
    const out = sanitizeOperatorEvidenceText(
      `From ${UNKNOWN_UUID}`,
      rec,
    );
    expect(out).toContain("prompt evidence");
    expect(out).not.toContain(UNKNOWN_UUID);
  });
});

describe("sanitizeOperatorEvidenceText — pass-through", () => {
  it("returns null / undefined / empty unchanged", () => {
    expect(sanitizeOperatorEvidenceText(null, undefined)).toBe(null);
    expect(sanitizeOperatorEvidenceText(undefined, undefined)).toBe(undefined);
    expect(sanitizeOperatorEvidenceText("", undefined)).toBe("");
  });

  it("returns text unchanged when no UUID is present", () => {
    const text = "Add an architect-led design-build H2 to /services/whole-home-remodel";
    expect(sanitizeOperatorEvidenceText(text, new Map())).toBe(text);
  });

  it("is idempotent — running twice is a no-op once UUIDs are gone", () => {
    const text = `Drawn from prompt ${KNOWN_UUID}`;
    const map = new Map<string, string>([[KNOWN_UUID, "snippet here"]]);
    const once = sanitizeOperatorEvidenceText(text, map);
    const twice = sanitizeOperatorEvidenceText(once, map);
    expect(twice).toBe(once);
  });

  it("preserves surrounding text exactly (whitespace + punctuation)", () => {
    const map = new Map<string, string>([[KNOWN_UUID, "snippet"]]);
    const out = sanitizeOperatorEvidenceText(
      `Drawn from "${KNOWN_UUID}", continuing.`,
      map,
    );
    // Only the UUID is replaced; everything else stays.
    expect(out).toContain(`Drawn from "prompt: "snippet""`);
    expect(out).toContain(", continuing.");
  });
});

describe("sanitizeOperatorCopyFields", () => {
  const map = new Map<string, string>([
    [KNOWN_UUID, "best whole home remodel builders bay area"],
  ]);

  it("sanitizes named string fields and leaves the rest", () => {
    const obj = {
      why: `Drawn from prompt ${KNOWN_UUID}`,
      expectedImpact: "Reach more local searchers",
      measurementPlan: `Watch prompt ${UNKNOWN_UUID}`,
      confidence: 0.8, // non-string — must not be touched
      evidence: [{ type: "prompt", promptId: KNOWN_UUID }], // internal — must not be touched
    };
    const out = sanitizeOperatorCopyFields(
      obj,
      ["why", "expectedImpact", "measurementPlan"] as const,
      map,
    );
    expect(out.why).not.toContain(KNOWN_UUID);
    expect(out.why).toContain("prompt: ");
    expect(out.expectedImpact).toBe("Reach more local searchers");
    expect(out.measurementPlan).toContain("prompt evidence");
    expect(out.confidence).toBe(0.8);
    expect(out.evidence[0].promptId).toBe(KNOWN_UUID); // raw IDs preserved internally
  });

  it("returns the SAME object reference when nothing changed", () => {
    const obj = { why: "Add a cost section", expectedImpact: "More mentions" };
    const out = sanitizeOperatorCopyFields(
      obj,
      ["why", "expectedImpact"] as const,
      map,
    );
    expect(out).toBe(obj);
  });

  it("works without a lookup map (treats every UUID as unknown)", () => {
    const obj = { why: `From prompt ${KNOWN_UUID}` };
    const out = sanitizeOperatorCopyFields(obj, ["why"] as const, undefined);
    expect(out.why).toContain("prompt evidence");
    expect(out.why).not.toContain(KNOWN_UUID);
  });
});
