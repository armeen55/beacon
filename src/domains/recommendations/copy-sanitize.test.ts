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
  scrubInternalLeakagePatterns,
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

// ---------------------------------------------------------------------------
// Slice 4.5.G-B.2 — write-time prevention scrubbers (2026-05-21)
// ---------------------------------------------------------------------------
//
// Mirrors the B.1 render-guard's blocklist exactly: long 32+ hex/hash
// strings + 12 locked internal taxonomy tokens. Does NOT cover
// `unsupported_claim` / `architect_overclaim` — those defer to B.4.
//
// All cases below are pure string-in / string-out — no Supabase, no LLM,
// no production mutation.

describe("scrubInternalLeakagePatterns — long hex hash", () => {
  it("scrubs a 32-char hex (MD5-shape) hash with 'prompt evidence'", () => {
    const text = `evidence ${"a".repeat(32)} drawn from polling`;
    const out = scrubInternalLeakagePatterns(text);
    expect(out).not.toContain("a".repeat(32));
    expect(out).toContain("prompt evidence");
  });

  it("scrubs a 40-char hex (SHA-1-shape) hash", () => {
    const text = `hash: ${"e3b0c442".repeat(5)} flagged`;
    const out = scrubInternalLeakagePatterns(text);
    expect(out).not.toMatch(/[0-9a-f]{32,}/i);
    expect(out).toContain("prompt evidence");
  });

  it("scrubs a 64-char hex (SHA-256-shape) hash", () => {
    const text =
      "result e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 token";
    const out = scrubInternalLeakagePatterns(text);
    expect(out).not.toContain(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(out).toContain("prompt evidence");
  });

  it("leaves short hex strings (≤31 chars) unchanged", () => {
    const text = "color: abc123def456 used in styling";
    const out = scrubInternalLeakagePatterns(text);
    expect(out).toBe(text);
  });
});

describe("scrubInternalLeakagePatterns — ai/search signal tokens", () => {
  it("scrubs 'aiSearchSignal' with operator-locked neutral wording", () => {
    const out = scrubInternalLeakagePatterns(
      "Reasoning relies on aiSearchSignal data from prior polls.",
    );
    expect(out).not.toContain("aiSearchSignal");
    expect(out).toContain("search-intent signals");
  });

  it("scrubs 'actualSearchQueries' distinctly from aiSearchSignal", () => {
    const out = scrubInternalLeakagePatterns(
      "Drawn from actualSearchQueries observed on this prompt.",
    );
    expect(out).not.toContain("actualSearchQueries");
    expect(out).toContain("observed search-intent signals");
  });

  it("scrubs both signals in one string", () => {
    const out = scrubInternalLeakagePatterns(
      "Top descriptors from aiSearchSignal and actualSearchQueries combined.",
    );
    expect(out).not.toContain("aiSearchSignal");
    expect(out).not.toContain("actualSearchQueries");
    expect(out).toContain("search-intent signals");
    expect(out).toContain("observed search-intent signals");
  });
});

describe("scrubInternalLeakagePatterns — taxonomy tokens", () => {
  it("scrubs 'action_type' to plain English", () => {
    const out = scrubInternalLeakagePatterns(
      "The action_type was add_h2_section.",
    );
    expect(out).not.toContain("action_type");
    expect(out).toContain("action type");
  });

  it("scrubs 'trigger_signal'", () => {
    const out = scrubInternalLeakagePatterns(
      "trigger_signal: weak_h1 was raised.",
    );
    expect(out).not.toContain("trigger_signal");
    expect(out).toContain("signal");
  });

  it("scrubs 'evidence_tier'", () => {
    const out = scrubInternalLeakagePatterns(
      "evidence_tier: high → eligible for queue.",
    );
    expect(out).not.toContain("evidence_tier");
    expect(out).toContain("evidence");
  });
});

describe("scrubInternalLeakagePatterns — mode labels", () => {
  it("scrubs 'Mode A' with operator-neutral wording", () => {
    const out = scrubInternalLeakagePatterns("Tested in Mode A first.");
    expect(out).not.toContain("Mode A");
    expect(out).toContain("Beacon's evaluation mode");
  });

  it("scrubs 'Mode B'", () => {
    const out = scrubInternalLeakagePatterns("Re-tested in Mode B.");
    expect(out).not.toContain("Mode B");
    expect(out).toContain("Beacon's evaluation mode");
  });

  it("scrubs 'Mode C'", () => {
    const out = scrubInternalLeakagePatterns("Mode C applied to the row.");
    expect(out).not.toContain("Mode C");
    expect(out).toContain("Beacon's evaluation mode");
  });

  it("does NOT scrub legitimate 'Mode' usages without the locked suffix", () => {
    const out = scrubInternalLeakagePatterns(
      "Use legitimate Mode of operation here.",
    );
    expect(out).toBe("Use legitimate Mode of operation here.");
  });
});

describe("scrubInternalLeakagePatterns — recommendation IDs", () => {
  it("scrubs 'rec_id' to 'recommendation'", () => {
    const out = scrubInternalLeakagePatterns(
      "Linked to rec_id from yesterday.",
    );
    expect(out).not.toContain("rec_id");
    expect(out).toContain("recommendation");
  });

  it("scrubs 'source_rec_id' (more-specific wins over rec_id)", () => {
    const out = scrubInternalLeakagePatterns(
      "Forked from source_rec_id of prior queue.",
    );
    expect(out).not.toContain("source_rec_id");
    expect(out).not.toContain("rec_id");
    expect(out).toContain("source recommendation");
  });
});

describe("scrubInternalLeakagePatterns — bucket labels", () => {
  it("scrubs 'diagnostic_only'", () => {
    const out = scrubInternalLeakagePatterns(
      "Routed to diagnostic_only bucket.",
    );
    expect(out).not.toContain("diagnostic_only");
    expect(out).toContain("diagnostic");
  });

  it("scrubs 'customer-queue-ready'", () => {
    const out = scrubInternalLeakagePatterns(
      "Promoted to customer-queue-ready status.",
    );
    expect(out).not.toContain("customer-queue-ready");
    expect(out).toContain("customer queue");
  });
});

describe("scrubInternalLeakagePatterns — pass-through (intentional non-blocking per B.1 scope discipline)", () => {
  it("does NOT scrub 'architect-led' (architect_overclaim deferred to B.4)", () => {
    const text = "Ritz is an architect-led design-build firm.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });

  it("does NOT scrub 'architect-designed' (architect_overclaim deferred to B.4)", () => {
    const text = "Architect-designed homes in Atherton.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });

  it("does NOT scrub 'best' (unsupported_claim deferred to B.4)", () => {
    const text = "Users search for the best builders in Palo Alto.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });

  it("returns clean text unchanged (idempotent on clean input)", () => {
    const text =
      "Add an H2 section to the page so AI search platforms find it.";
    expect(scrubInternalLeakagePatterns(text)).toBe(text);
  });

  it("is idempotent — running twice on dirty input is a no-op after the first pass", () => {
    const dirty = "Top aiSearchSignal · action_type · Mode A scored.";
    const once = scrubInternalLeakagePatterns(dirty);
    const twice = scrubInternalLeakagePatterns(once);
    expect(twice).toBe(once);
  });
});

describe("scrubInternalLeakagePatterns — multi-token rows", () => {
  it("scrubs all tokens in one string and leaves none raw", () => {
    const dirty =
      "Drawn from aiSearchSignal + actualSearchQueries; action_type=add_h2; trigger_signal=weak_h1; evidence_tier=high; Mode A + Mode B reviewed; rec_id linked; source_rec_id traced; routed diagnostic_only then promoted customer-queue-ready.";
    const out = scrubInternalLeakagePatterns(dirty);
    expect(out).not.toContain("aiSearchSignal");
    expect(out).not.toContain("actualSearchQueries");
    expect(out).not.toContain("action_type");
    expect(out).not.toContain("trigger_signal");
    expect(out).not.toContain("evidence_tier");
    expect(out).not.toContain("Mode A");
    expect(out).not.toContain("Mode B");
    expect(out).not.toContain("rec_id");
    expect(out).not.toContain("source_rec_id");
    expect(out).not.toContain("diagnostic_only");
    expect(out).not.toContain("customer-queue-ready");
  });

  it("scrubs hash + token combined", () => {
    const dirty = `Hash ${"f".repeat(40)} from aiSearchSignal pipeline.`;
    const out = scrubInternalLeakagePatterns(dirty);
    expect(out).not.toMatch(/[0-9a-f]{32,}/i);
    expect(out).not.toContain("aiSearchSignal");
    expect(out).toContain("prompt evidence");
    expect(out).toContain("search-intent signals");
  });
});

describe("sanitizeOperatorEvidenceText — B.2 integration", () => {
  it("scrubs internal tokens even when no UUID present", () => {
    const out = sanitizeOperatorEvidenceText(
      "aiSearchSignal flagged this page.",
      undefined,
    );
    expect(out).not.toContain("aiSearchSignal");
    expect(out).toContain("search-intent signals");
  });

  it("scrubs long hex hash even when no UUID present", () => {
    const out = sanitizeOperatorEvidenceText(
      `cited under ${"abc12345".repeat(5)} token`,
      undefined,
    );
    expect(out).not.toMatch(/[0-9a-f]{32,}/i);
    expect(out).toContain("prompt evidence");
  });

  it("runs UUID pass + token pass in one call", () => {
    const out = sanitizeOperatorEvidenceText(
      `Drawn from prompt ${KNOWN_UUID} via aiSearchSignal.`,
      undefined,
    );
    expect(out).not.toContain(KNOWN_UUID);
    expect(out).not.toContain("aiSearchSignal");
    expect(out).toContain("prompt evidence");
    expect(out).toContain("search-intent signals");
  });

  it("returns clean text unchanged (B.2 patterns absent)", () => {
    const text = "Add an architect-led H2 to /services/whole-home-remodel";
    expect(sanitizeOperatorEvidenceText(text, undefined)).toBe(text);
  });

  it("is idempotent after first pass", () => {
    const text = `From prompt ${KNOWN_UUID}; aiSearchSignal; Mode A.`;
    const once = sanitizeOperatorEvidenceText(text, undefined);
    const twice = sanitizeOperatorEvidenceText(once, undefined);
    expect(twice).toBe(once);
  });
});

describe("sanitizeOperatorCopyFields — B.2 integration on write-time fields", () => {
  it("scrubs new B.2 patterns across why / expectedImpact / measurementPlan", () => {
    const obj = {
      why: "Drawn from aiSearchSignal data.",
      expectedImpact: "Higher action_type coverage.",
      measurementPlan: `Compare ${"a".repeat(40)} hash before / after.`,
    };
    const out = sanitizeOperatorCopyFields(
      obj,
      ["why", "expectedImpact", "measurementPlan"] as const,
      undefined,
    );
    expect(out.why).not.toContain("aiSearchSignal");
    expect(out.expectedImpact).not.toContain("action_type");
    expect(out.measurementPlan).not.toMatch(/[0-9a-f]{32,}/i);
    expect(out.why).toContain("search-intent signals");
    expect(out.expectedImpact).toContain("action type");
    expect(out.measurementPlan).toContain("prompt evidence");
  });
});
