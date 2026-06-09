/**
 * 2026-05-26 Phase A.2 (Section 3.4 / E4) — cross-tenant pattern-
 * description privacy scrubber tests.
 *
 * Exhaustive contract pins for the single most safety-critical brain
 * primitive. Privacy-first: over-redaction is the SAFE failure; a leak
 * is product-killing. These tests pin both behaviors.
 */

import { describe, it, expect } from "vitest";
import {
  scrubPatternDescription,
  containsBlocklistedTerm,
  normalizeBlocklist,
  REDACTION_TOKEN,
} from "@/domains/recommendations/cross-tenant-brain/privacy";

describe("scrubPatternDescription — core redaction", () => {
  it("redacts a single occurrence (case as-given)", () => {
    expect(
      scrubPatternDescription("add_h2 helped Ritz Builders a lot", [
        "Ritz Builders",
      ]),
    ).toBe(`add_h2 helped ${REDACTION_TOKEN} a lot`);
  });

  it("redacts ALL occurrences (global)", () => {
    expect(
      scrubPatternDescription("Acme vs Acme vs Acme", ["Acme"]),
    ).toBe(`${REDACTION_TOKEN} vs ${REDACTION_TOKEN} vs ${REDACTION_TOKEN}`);
  });

  it("is case-insensitive (RITZ / ritz / Ritz all redacted)", () => {
    expect(
      scrubPatternDescription("RITZ and ritz and Ritz", ["Ritz"]),
    ).toBe(`${REDACTION_TOKEN} and ${REDACTION_TOKEN} and ${REDACTION_TOKEN}`);
  });

  it("redacts a domain containing regex metachars literally", () => {
    expect(
      scrubPatternDescription("see ritzbuilders.com today", [
        "ritzbuilders.com",
      ]),
    ).toBe(`see ${REDACTION_TOKEN} today`);
  });

  it("does NOT treat a blocklist term as a regex pattern", () => {
    // "a.b" must match the literal "a.b", NOT "axb" (which `.` would
    // match if unescaped).
    expect(scrubPatternDescription("axb stays", ["a.b"])).toBe("axb stays");
    expect(scrubPatternDescription("a.b goes", ["a.b"])).toBe(
      `${REDACTION_TOKEN} goes`,
    );
  });
});

describe("scrubPatternDescription — longest-first (no fragmentation)", () => {
  it("redacts the full domain as a unit when both domain + short brand are blocklisted", () => {
    // Both "ritzbuilders.com" and "ritz" present. Longest-first must
    // redact the domain whole, not leave "[redacted]builders.com".
    const out = scrubPatternDescription(
      "visit ritzbuilders.com now",
      ["ritz", "ritzbuilders.com"],
    );
    expect(out).toBe(`visit ${REDACTION_TOKEN} now`);
    expect(out).not.toContain("builders.com");
  });

  it("over-redacts (SAFE) when a short term is a substring of a legit longer word", () => {
    // Only "Ritz" blocklisted; "Ritzbuilders" appears. Substring match
    // redacts the "Ritz" prefix — over-redaction is the safe failure.
    expect(scrubPatternDescription("Ritzbuilders rocks", ["Ritz"])).toBe(
      `${REDACTION_TOKEN}builders rocks`,
    );
  });
});

describe("scrubPatternDescription — no-op cases", () => {
  it("empty blocklist → unchanged", () => {
    expect(scrubPatternDescription("nothing to scrub", [])).toBe(
      "nothing to scrub",
    );
  });

  it("blocklist matches nothing → unchanged", () => {
    expect(scrubPatternDescription("clean text", ["Zzz Corp"])).toBe(
      "clean text",
    );
  });

  it("empty description → empty string", () => {
    expect(scrubPatternDescription("", ["Ritz"])).toBe("");
  });

  it("non-string description → empty string (defensive)", () => {
    // @ts-expect-error — exercising the runtime guard.
    expect(scrubPatternDescription(null, ["Ritz"])).toBe("");
    // @ts-expect-error — exercising the runtime guard.
    expect(scrubPatternDescription(undefined, ["Ritz"])).toBe("");
  });
});

describe("normalizeBlocklist — hygiene", () => {
  it("drops empty / whitespace-only / single-char terms", () => {
    expect(normalizeBlocklist(["", "  ", "a", "Ok"])).toEqual(["Ok"]);
  });

  it("trims whitespace around terms", () => {
    expect(normalizeBlocklist(["  Ritz  "])).toEqual(["Ritz"]);
  });

  it("de-duplicates case-insensitively (keeps first spelling)", () => {
    expect(normalizeBlocklist(["Ritz", "ritz", "RITZ"])).toEqual(["Ritz"]);
  });

  it("sorts longest-first", () => {
    expect(normalizeBlocklist(["ab", "abcd", "abc"])).toEqual([
      "abcd",
      "abc",
      "ab",
    ]);
  });

  it("ignores non-string entries defensively", () => {
    // @ts-expect-error — exercising the runtime guard.
    expect(normalizeBlocklist(["Ritz", 42, null, undefined])).toEqual(["Ritz"]);
  });
});

describe("scrubPatternDescription — single-char terms never shred text", () => {
  it("a 1-char blocklist term is dropped (would otherwise redact every occurrence)", () => {
    expect(scrubPatternDescription("a cat sat on a mat", ["a"])).toBe(
      "a cat sat on a mat",
    );
  });
});

describe("containsBlocklistedTerm — post-scrub guard", () => {
  it("true when a term is present (case-insensitive)", () => {
    expect(containsBlocklistedTerm("has RITZ in it", ["ritz"])).toBe(true);
  });

  it("false when clean", () => {
    expect(containsBlocklistedTerm("totally clean", ["Ritz"])).toBe(false);
  });

  it("false for empty text / empty blocklist", () => {
    expect(containsBlocklistedTerm("", ["Ritz"])).toBe(false);
    expect(containsBlocklistedTerm("text", [])).toBe(false);
  });

  it("a scrubbed description no longer contains its blocklist terms", () => {
    const blocklist = ["Ritz Builders", "ritzbuilders.com", "Acme"];
    const raw =
      "Ritz Builders (ritzbuilders.com) outranked Acme on this pattern";
    const scrubbed = scrubPatternDescription(raw, blocklist);
    expect(containsBlocklistedTerm(scrubbed, blocklist)).toBe(false);
  });
});

describe("scrubPatternDescription — determinism", () => {
  it("same inputs → identical output across calls", () => {
    const desc = "pattern from Ritz and Acme and globex.io";
    const bl = ["Ritz", "Acme", "globex.io"];
    expect(scrubPatternDescription(desc, bl)).toBe(
      scrubPatternDescription(desc, bl),
    );
  });

  it("blocklist order does not change the result (normalized internally)", () => {
    const desc = "visit ritzbuilders.com / ritz";
    const a = scrubPatternDescription(desc, ["ritz", "ritzbuilders.com"]);
    const b = scrubPatternDescription(desc, ["ritzbuilders.com", "ritz"]);
    expect(a).toBe(b);
  });
});
