import { describe, it, expect } from "vitest";
import {
  normalizeText,
  contentHash,
  positionalKey,
  singletonKey,
  newElementKey,
  schemaTypeKey,
  schemaPropertyKey,
  displayLabel,
} from "./element-key";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 4 — element_key helpers + display label tests.
//
// Every invariant from the phase scope is pinned here:
//   - same text = same key
//   - whitespace-normalized text = same key
//   - different text = different key
//   - positional heading key works
//   - singleton title/meta key works
//   - schema path key works
//   - new element key works
//   - display labels are readable
//   - collision-resistant across distinct element texts
// ---------------------------------------------------------------------------

describe("Sprint 6A.1 Phase 4 — element-key utilities", () => {
  // ── normalizeText + contentHash ─────────────────────────────────────────
  describe("normalizeText", () => {
    it("trims leading and trailing whitespace", () => {
      expect(normalizeText("  hello  ")).toBe("hello");
    });

    it("collapses internal whitespace runs to single ASCII space", () => {
      expect(normalizeText("hello    world")).toBe("hello world");
      expect(normalizeText("hello\tworld")).toBe("hello world");
      expect(normalizeText("hello\nworld")).toBe("hello world");
      expect(normalizeText("hello\r\n\tworld")).toBe("hello world");
    });

    it("collapses non-breaking spaces to single space", () => {
      expect(normalizeText("hello\u00a0world")).toBe("hello world");
    });

    it("preserves case (case is semantically meaningful)", () => {
      expect(normalizeText("Custom Home Builder")).toBe(
        "Custom Home Builder",
      );
      expect(normalizeText("Custom Home Builder")).not.toBe(
        normalizeText("custom home builder"),
      );
    });

    it("normalizes Unicode composition (NFC)", () => {
      // "é" can be encoded as a single codepoint (U+00E9) OR as
      // "e" + combining acute (U+0065 U+0301). After NFC they match.
      const composed = "caf\u00e9";
      const decomposed = "cafe\u0301";
      expect(normalizeText(composed)).toBe(normalizeText(decomposed));
    });

    it("returns empty string for empty / whitespace-only input", () => {
      expect(normalizeText("")).toBe("");
      expect(normalizeText("   \t\n  ")).toBe("");
    });
  });

  describe("contentHash", () => {
    it("returns a 12-character lowercase hex string", () => {
      const h = contentHash("hello");
      expect(h).toMatch(/^[0-9a-f]{12}$/);
    });

    it("is deterministic: same input = same hash", () => {
      expect(contentHash("hello")).toBe(contentHash("hello"));
    });

    it("is whitespace-invariant: trivial reformats do not change the hash", () => {
      // The product rule — a reformat-only edit must not burn attribution
      // windows. Tests covering the key invariant from the phase scope.
      expect(contentHash("hello world")).toBe(contentHash("  hello   world  "));
      expect(contentHash("hello world")).toBe(contentHash("hello\tworld"));
      expect(contentHash("hello world")).toBe(contentHash("hello\nworld"));
      expect(contentHash("hello world")).toBe(contentHash("hello\u00a0world"));
    });

    it("is case-sensitive: case change produces a different hash", () => {
      expect(contentHash("Custom Home Builder")).not.toBe(
        contentHash("custom home builder"),
      );
    });

    it("distinct inputs produce distinct hashes across a sample corpus", () => {
      // Collision resistance smoke test. 12 hex chars = 48 bits; expected
      // collision probability in ~200 distinct strings ≈ 200²/2⁴⁹ ≈ 7×10⁻¹¹.
      const samples = [
        "Custom Home Builder Bay Area",
        "Architect-Led Design-Build",
        "How long does a custom home take?",
        "Architect-Provided Plans",
        "Whole Home Remodel",
        "Teardown + Rebuild",
        "Palo Alto",
        "Menlo Park",
        "Atherton",
        "Luxury Home Builder",
        "FAQPage",
        "Service",
        "LocalBusiness",
        "https://ritzbuilders.com/services/design-build",
        "https://ritzbuilders.com/locations/palo-alto",
        ...Array.from({ length: 200 }, (_, i) => `test-input-${i}`),
      ];
      const hashes = new Set(samples.map(contentHash));
      expect(hashes.size).toBe(samples.length);
    });

    it("hashes empty string deterministically (sha256 of empty)", () => {
      // Empty element text is valid — the hash should still be stable.
      const h = contentHash("");
      expect(h).toMatch(/^[0-9a-f]{12}$/);
      expect(contentHash("")).toBe(h);
    });
  });

  // ── positionalKey ────────────────────────────────────────────────────────
  describe("positionalKey", () => {
    it("produces keys of the form `<type>[<index>]:<12-hex-hash>`", () => {
      const k = positionalKey("h2", 3, "Architect-Led Design-Build");
      expect(k).toMatch(/^h2\[3\]:[0-9a-f]{12}$/);
    });

    it("same (type, index, content) → same key (attribution-stable)", () => {
      const a = positionalKey("h2", 3, "About Us");
      const b = positionalKey("h2", 3, "About Us");
      expect(a).toBe(b);
    });

    it("different content at same position → different key (rename semantics)", () => {
      const a = positionalKey("h2", 3, "About Us");
      const b = positionalKey("h2", 3, "Why Choose Us");
      expect(a).not.toBe(b);
    });

    it("same content at different positions → different key", () => {
      const a = positionalKey("h2", 3, "About Us");
      const b = positionalKey("h2", 4, "About Us");
      expect(a).not.toBe(b);
    });

    it("whitespace reformat is invariant (attribution window preserved)", () => {
      const a = positionalKey("h2", 3, "About Us");
      const b = positionalKey("h2", 3, "  About   Us  ");
      expect(a).toBe(b);
    });

    it("rejects non-integer or negative index", () => {
      expect(() => positionalKey("h2", -1, "x")).toThrow();
      expect(() => positionalKey("h2", 1.5, "x")).toThrow();
      expect(() => positionalKey("h2", NaN, "x")).toThrow();
    });
  });

  // ── singletonKey ─────────────────────────────────────────────────────────
  describe("singletonKey", () => {
    it("always fixes index to 0", () => {
      const k = singletonKey("title", "Ritz Builders");
      expect(k).toMatch(/^title\[0\]:[0-9a-f]{12}$/);
    });

    it("delegates to positionalKey: singletonKey(type, c) === positionalKey(type, 0, c)", () => {
      expect(singletonKey("meta", "some description")).toBe(
        positionalKey("meta", 0, "some description"),
      );
    });

    it("same content → same key (deterministic across extractor runs)", () => {
      expect(singletonKey("canonical", "https://example.com/x/")).toBe(
        singletonKey("canonical", "https://example.com/x/"),
      );
    });
  });

  // ── newElementKey ────────────────────────────────────────────────────────
  describe("newElementKey", () => {
    it("produces keys of the form `<type>[new]:<12-hex-hash>`", () => {
      const k = newElementKey("h2", "Architect-Led Design-Build");
      expect(k).toMatch(/^h2\[new\]:[0-9a-f]{12}$/);
    });

    it("proposed adds of the same elementType with DIFFERENT content don't collide", () => {
      const a = newElementKey("h2", "A");
      const b = newElementKey("h2", "B");
      expect(a).not.toBe(b);
    });

    it("proposed adds of the SAME elementType+content produce the same key (deterministic)", () => {
      const a = newElementKey("faq_question", "How long?");
      const b = newElementKey("faq_question", "How long?");
      expect(a).toBe(b);
    });
  });

  // ── schema keys ──────────────────────────────────────────────────────────
  describe("schemaTypeKey", () => {
    it("uses the @type literal as identity (no hash)", () => {
      expect(schemaTypeKey("FAQPage")).toBe("schema[FAQPage]");
      expect(schemaTypeKey("LocalBusiness")).toBe("schema[LocalBusiness]");
      expect(schemaTypeKey("HomeAndConstructionBusiness")).toBe(
        "schema[HomeAndConstructionBusiness]",
      );
    });

    it("identity is stable across calls", () => {
      expect(schemaTypeKey("FAQPage")).toBe(schemaTypeKey("FAQPage"));
    });
  });

  describe("schemaPropertyKey", () => {
    it("encodes object properties with `.segment` and array indices with `[N]`", () => {
      const k = schemaPropertyKey(
        "FAQPage",
        ["mainEntity", 2, "name"],
        "How long does a custom home take?",
      );
      expect(k).toMatch(
        /^schema\[FAQPage\]\.mainEntity\[2\]\.name:[0-9a-f]{12}$/,
      );
    });

    it("nested paths encode correctly", () => {
      const k = schemaPropertyKey(
        "LocalBusiness",
        ["address", "streetAddress"],
        "456 Main St",
      );
      expect(k).toMatch(
        /^schema\[LocalBusiness\]\.address\.streetAddress:[0-9a-f]{12}$/,
      );
    });

    it("same (type, path, value) → same key", () => {
      const a = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q1");
      const b = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q1");
      expect(a).toBe(b);
    });

    it("value edit → different key (rename semantics match positional)", () => {
      const a = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q1");
      const b = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q1 rewritten");
      expect(a).not.toBe(b);
    });

    it("same value at different paths → different key (position is identity)", () => {
      const a = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q");
      const b = schemaPropertyKey("FAQPage", ["mainEntity", 1, "name"], "Q");
      expect(a).not.toBe(b);
    });

    it("rejects empty path segments", () => {
      expect(() => schemaPropertyKey("FAQPage", [], "x")).toThrow();
    });

    it("whitespace reformat of the VALUE is invariant", () => {
      const a = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "Q1");
      const b = schemaPropertyKey("FAQPage", ["mainEntity", 0, "name"], "  Q1  ");
      expect(a).toBe(b);
    });
  });

  // ── Key-shape cross-contamination guard ─────────────────────────────────
  describe("key-shape collisions across builders", () => {
    it("positional, new, and schema keys produce structurally distinct strings", () => {
      // Positional has `[<int>]`, new has `[new]`, schema paths start
      // with `schema[`. These must not collide.
      const p = positionalKey("h2", 0, "same content");
      const n = newElementKey("h2", "same content");
      const s = schemaTypeKey("FAQPage");

      expect(p).not.toBe(n); // [0] vs [new]
      expect(p).not.toContain("schema[");
      expect(n).not.toContain("schema[");
      expect(s).not.toMatch(/h2\[/);
    });
  });

  // ── displayLabel ─────────────────────────────────────────────────────────
  describe("displayLabel", () => {
    it("title with content renders a readable label", () => {
      expect(
        displayLabel({
          elementType: "title",
          content: "Ritz Builders — Custom Home Builder Bay Area",
        }),
      ).toBe(
        'Title tag: "Ritz Builders — Custom Home Builder Bay Area"',
      );
    });

    it("heading with position shows 1-indexed humans-count", () => {
      expect(
        displayLabel({
          elementType: "h2",
          position: 3,
          content: "What Defines a Custom Home Builder",
        }),
      ).toBe('H2 heading #4: "What Defines a Custom Home Builder"');
    });

    it("proposed/new element uses ` (new)` marker", () => {
      expect(
        displayLabel({
          elementType: "h2",
          position: "new",
          content: "Architect-Led Design-Build",
        }),
      ).toBe('H2 heading (new): "Architect-Led Design-Build"');
    });

    it("schema type with content = the @type literal", () => {
      expect(
        displayLabel({
          elementType: "schema_type",
          content: "FAQPage",
        }),
      ).toBe('Schema @type: "FAQPage"');
    });

    it("faq_question with position renders cleanly", () => {
      expect(
        displayLabel({
          elementType: "faq_question",
          position: 0,
          content: "How long does a custom home take?",
        }),
      ).toBe('FAQ question #1: "How long does a custom home take?"');
    });

    it("internal_link with no content falls back to the registry label only", () => {
      expect(
        displayLabel({
          elementType: "internal_link",
          position: 5,
        }),
      ).toBe("Internal link #6");
    });

    it("truncates long content with an ellipsis (60 chars)", () => {
      const long = "a".repeat(100);
      const label = displayLabel({
        elementType: "h2",
        position: 0,
        content: long,
      });
      // 60-char limit includes the ellipsis; label should end with "…"
      // and the quoted content segment's inner length is ≤ 60.
      expect(label).toMatch(/…"$/);
      const quoted = label.match(/"(.*)"$/)![1];
      expect(quoted.length).toBeLessThanOrEqual(60);
    });

    it("null content yields a label with no content segment", () => {
      // `create_page` is an ActionType, not an ElementType — this test
      // asserts null-content handling for ANY element type. Using
      // `title` keeps the test well-typed.
      expect(
        displayLabel({
          elementType: "title",
          content: null,
        }),
      ).toBe("Title tag");
    });

    it("undefined content (omitted) behaves identically to null", () => {
      expect(displayLabel({ elementType: "h3", position: 2 })).toBe(
        "H3 heading #3",
      );
    });

    it("empty-string content yields a label with no content segment", () => {
      expect(displayLabel({ elementType: "title", content: "" })).toBe(
        "Title tag",
      );
    });

    it("whitespace-only content is treated as empty", () => {
      expect(
        displayLabel({ elementType: "meta", content: "   \t  " }),
      ).toBe("Meta description");
    });
  });
});
