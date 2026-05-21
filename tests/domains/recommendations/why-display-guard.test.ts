/**
 * Slice 4.5.G-B.1 (2026-05-21) — why-display-guard unit tests.
 *
 * Pure function, no mocks. Verifies the 4 locked blocked reasons +
 * fallback shape + null/empty handling + competitor-context
 * activation + intentional NON-blocking of architect/unsupported
 * tokens (deferred to 4.5.G-B.4).
 */

import { describe, it, expect } from "vitest";

import {
  WHY_DISPLAY_GUARD_FALLBACK,
  checkWhyDisplaySafe,
} from "@/domains/recommendations/why-display-guard";

describe("checkWhyDisplaySafe / clean input", () => {
  it("clean why passes through", () => {
    const result = checkWhyDisplaySafe(
      "Beacon recommends this because the page is missing a clear service-area heading.",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("missing a clear service-area heading");
    }
  });

  it("null input returns ok with empty text", () => {
    const result = checkWhyDisplaySafe(null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("");
    }
  });

  it("undefined input returns ok with empty text", () => {
    const result = checkWhyDisplaySafe(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("");
    }
  });

  it("empty-string input returns ok with empty text", () => {
    const result = checkWhyDisplaySafe("");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("");
    }
  });
});

describe("checkWhyDisplaySafe / uuid_leak", () => {
  it("blocks canonical UUID", () => {
    const result = checkWhyDisplaySafe(
      "See rec abc12345-de67-89ab-cdef-0123456789ab for details.",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("uuid_leak");
      expect(result.fallback).toBe(WHY_DISPLAY_GUARD_FALLBACK);
    }
  });

  it("blocks canonical UUID even when alongside clean copy", () => {
    const result = checkWhyDisplaySafe(
      "Page is missing a heading (rec abc12345-de67-89ab-cdef-0123456789ab).",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("uuid_leak");
    }
  });
});

describe("checkWhyDisplaySafe / long_hex_hash", () => {
  it("blocks 32+ char hex string", () => {
    const result = checkWhyDisplaySafe(`Hash: ${"a".repeat(40)} found here.`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("long_hex_hash");
    }
  });

  it("blocks 32+ char hex string distinct from canonical UUID", () => {
    const result = checkWhyDisplaySafe(`See e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 token.`);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either long_hex_hash or uuid_leak is acceptable; the guard
      // collapses to one reason to avoid double-counting.
      const matched =
        result.reasons.includes("long_hex_hash") ||
        result.reasons.includes("uuid_leak");
      expect(matched).toBe(true);
    }
  });
});

describe("checkWhyDisplaySafe / internal_token", () => {
  const tokens = [
    "aiSearchSignal",
    "actualSearchQueries",
    "action_type",
    "trigger_signal",
    "evidence_tier",
    "Mode A",
    "Mode B",
    "Mode C",
    "rec_id",
    "source_rec_id",
    "diagnostic_only",
    "customer-queue-ready",
  ];
  for (const tok of tokens) {
    it(`blocks internal token: ${tok}`, () => {
      const result = checkWhyDisplaySafe(`Reference: ${tok} found here.`);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reasons).toContain("internal_token");
        expect(result.fallback).toBe(WHY_DISPLAY_GUARD_FALLBACK);
      }
    });
  }
});

describe("checkWhyDisplaySafe / competitor_name", () => {
  it("blocks competitor name case-insensitively", () => {
    const result = checkWhyDisplaySafe(
      "We beat Greenberg Construction on this.",
      { competitorNames: ["Greenberg Construction"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("competitor_name");
    }
  });

  it("blocks competitor name in lowercase", () => {
    const result = checkWhyDisplaySafe(
      "we beat greenberg construction on this.",
      { competitorNames: ["Greenberg Construction"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons).toContain("competitor_name");
    }
  });

  it("does nothing when competitorNames is empty", () => {
    const result = checkWhyDisplaySafe(
      "We beat Greenberg Construction on this.",
      { competitorNames: [] },
    );
    expect(result.ok).toBe(true);
  });

  it("does nothing when competitorNames is omitted", () => {
    const result = checkWhyDisplaySafe(
      "We beat Greenberg Construction on this.",
    );
    expect(result.ok).toBe(true);
  });
});

describe("checkWhyDisplaySafe / multi-reason", () => {
  it("returns multiple reasons when multiple violations exist", () => {
    const result = checkWhyDisplaySafe(
      "rec abc12345-de67-89ab-cdef-0123456789ab and action_type and Greenberg Construction.",
      { competitorNames: ["Greenberg Construction"] },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const reasonSet = new Set(result.reasons);
      expect(reasonSet.has("uuid_leak")).toBe(true);
      expect(reasonSet.has("internal_token")).toBe(true);
      expect(reasonSet.has("competitor_name")).toBe(true);
    }
  });

  it("fallback is rendered exactly once even with multiple reasons", () => {
    const result = checkWhyDisplaySafe(
      "rec abc12345-de67-89ab-cdef-0123456789ab and aiSearchSignal here.",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fallback).toBe(WHY_DISPLAY_GUARD_FALLBACK);
    }
  });
});

describe("checkWhyDisplaySafe / intentional non-blocking (B.1 scope discipline)", () => {
  it("does NOT block 'best' (unsupported_claim deferred to B.4)", () => {
    const result = checkWhyDisplaySafe(
      "Users search for the best builders in Atherton.",
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT block 'architect-led' (architect_overclaim deferred to B.4)", () => {
    const result = checkWhyDisplaySafe(
      "The architect-led design-build positioning matches the prompt cluster.",
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT block 'architect-designed' (architect_overclaim deferred to B.4)", () => {
    const result = checkWhyDisplaySafe(
      "The architect-designed kitchen showcases craft.",
    );
    expect(result.ok).toBe(true);
  });

  it("does NOT block em-dash (low severity; not in B.1 scope)", () => {
    const result = checkWhyDisplaySafe("Modern home — designed by Beacon.");
    expect(result.ok).toBe(true);
  });

  it("does NOT block leading 'Best ' (low severity; not in B.1 scope)", () => {
    const result = checkWhyDisplaySafe(
      "Best service in the area for whole-home remodels.",
    );
    expect(result.ok).toBe(true);
  });
});

describe("checkWhyDisplaySafe / fallback shape", () => {
  it("blocked result carries the locked fallback string verbatim", () => {
    const result = checkWhyDisplaySafe("rec abc12345-de67-89ab-cdef-0123456789ab.");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fallback).toBe(
        "Beacon has additional context for this recommendation, but it needs review before showing here.",
      );
    }
  });

  it("reasons array is non-empty when blocked", () => {
    const result = checkWhyDisplaySafe("aiSearchSignal here.");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});
