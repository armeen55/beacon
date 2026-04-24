import { describe, it, expect } from "vitest";
import {
  ELEMENT_TYPES,
  EXTRACTOR_REGISTRY,
  EXTRACTOR_SOURCE_CATEGORIES,
  getExtractorSpec,
  listActiveElementTypes,
  listElementTypesBySourceCategory,
  isValidElementType,
  type ElementType,
  type ExtractorSourceCategory,
} from "./registry";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 3 — extractor registry tests.
//
// Every invariant from the phase scope is pinned here. These are the exact
// tripwires that catch registry drift in PR review:
//   - 31 total element types
//   - Exactly 13 active in v1 (user-specified list, verbatim)
//   - 18 registered-but-inactive
//   - Every spec has active/version/operatorLabel/sourceCategory
//   - No duplicates in the enum
//   - Every enum value has a registry entry (no orphans)
//   - Registry data-only (no function references)
//   - Helpers work
// ---------------------------------------------------------------------------

const EXPECTED_TOTAL = 31;
const EXPECTED_ACTIVE_COUNT = 13;
const EXPECTED_INACTIVE_COUNT = 18;

// Pinned verbatim from Phase 6A.1.3 scope. If this list changes, the
// product decision needs to be in the PR description.
const EXPECTED_ACTIVE: ElementType[] = [
  "title",
  "meta",
  "canonical",
  "h1",
  "h2",
  "h3",
  "faq_question",
  "faq_answer",
  "schema_type",
  "schema_property",
  "internal_link",
  "city_mention",
  "service_mention",
];

const EXPECTED_ALL: ElementType[] = [
  "title",
  "meta",
  "canonical",
  "og_title",
  "og_desc",
  "h1",
  "h2",
  "h3",
  "faq_question",
  "faq_answer",
  "schema_type",
  "schema_property",
  "internal_link",
  "external_link",
  "city_mention",
  "service_mention",
  "entity_mention",
  "competitor_mention",
  "table",
  "table_row",
  "list",
  "cta",
  "testimonial",
  "proof",
  "project_card",
  "answer_block",
  "comparison_block",
  "cost_section",
  "timeline_section",
  "service_area_grid",
  "external_citation",
];

describe("Sprint 6A.1 Phase 3 — extractor registry", () => {
  describe("enum completeness", () => {
    it(`has exactly ${EXPECTED_TOTAL} element types`, () => {
      expect(ELEMENT_TYPES).toHaveLength(EXPECTED_TOTAL);
      expect(EXPECTED_ALL).toHaveLength(EXPECTED_TOTAL);
    });

    it("matches the phase scope verbatim (every planned type present, nothing extra)", () => {
      expect(new Set(ELEMENT_TYPES)).toEqual(new Set(EXPECTED_ALL));
    });

    it("has no duplicates", () => {
      expect(new Set(ELEMENT_TYPES).size).toBe(ELEMENT_TYPES.length);
    });
  });

  describe("registry completeness", () => {
    it("every enum value has a registry spec (no orphans in enum)", () => {
      for (const t of ELEMENT_TYPES) {
        expect(
          EXTRACTOR_REGISTRY[t],
          `missing spec for ${t}`,
        ).toBeDefined();
      }
    });

    it("every registry key is a valid enum member (no orphans in registry)", () => {
      const registryKeys = Object.keys(EXTRACTOR_REGISTRY);
      expect(registryKeys).toHaveLength(EXPECTED_TOTAL);
      for (const k of registryKeys) {
        expect(isValidElementType(k)).toBe(true);
      }
    });

    it("registry key equals spec.elementType field (no internal drift)", () => {
      for (const t of ELEMENT_TYPES) {
        expect(EXTRACTOR_REGISTRY[t].elementType).toBe(t);
      }
    });
  });

  describe("active count is explicit and intentional", () => {
    it(`exactly ${EXPECTED_ACTIVE_COUNT} element types are active=true`, () => {
      const active = ELEMENT_TYPES.filter(
        (t) => EXTRACTOR_REGISTRY[t].active,
      );
      expect(active).toHaveLength(EXPECTED_ACTIVE_COUNT);
    });

    it("active set matches the Phase 6A.1.3 scope list verbatim", () => {
      const active = ELEMENT_TYPES.filter(
        (t) => EXTRACTOR_REGISTRY[t].active,
      );
      expect(new Set(active)).toEqual(new Set(EXPECTED_ACTIVE));
    });

    it("listActiveElementTypes() returns the same 13", () => {
      expect(new Set(listActiveElementTypes())).toEqual(
        new Set(EXPECTED_ACTIVE),
      );
    });

    it(`exactly ${EXPECTED_INACTIVE_COUNT} element types are registered-but-inactive (Sprint 6A.2 flips them)`, () => {
      const inactive = ELEMENT_TYPES.filter(
        (t) => !EXTRACTOR_REGISTRY[t].active,
      );
      expect(inactive).toHaveLength(EXPECTED_INACTIVE_COUNT);
      for (const t of EXPECTED_ACTIVE) {
        expect(inactive).not.toContain(t);
      }
    });
  });

  describe("spec validity — every entry has the required fields", () => {
    const REQUIRED_FIELDS = new Set<keyof (typeof EXTRACTOR_REGISTRY)[ElementType]>([
      "elementType",
      "active",
      "version",
      "operatorLabel",
      "sourceCategory",
    ]);

    it("every spec has exactly the 5 required fields — no extras", () => {
      for (const t of ELEMENT_TYPES) {
        const spec = EXTRACTOR_REGISTRY[t];
        const fields = new Set(Object.keys(spec));
        expect(fields).toEqual(REQUIRED_FIELDS);
      }
    });

    it("every spec.active is a boolean", () => {
      for (const t of ELEMENT_TYPES) {
        expect(typeof EXTRACTOR_REGISTRY[t].active).toBe("boolean");
      }
    });

    it("every spec.version is a positive integer", () => {
      for (const t of ELEMENT_TYPES) {
        const v = EXTRACTOR_REGISTRY[t].version;
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    });

    it("every spec.operatorLabel is a non-empty string", () => {
      for (const t of ELEMENT_TYPES) {
        const label = EXTRACTOR_REGISTRY[t].operatorLabel;
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });

    it("every spec.sourceCategory is drawn from EXTRACTOR_SOURCE_CATEGORIES", () => {
      for (const t of ELEMENT_TYPES) {
        const cat = EXTRACTOR_REGISTRY[t].sourceCategory;
        expect(
          (EXTRACTOR_SOURCE_CATEGORIES as readonly string[]).includes(cat),
          `${t}.sourceCategory=${cat} not in EXTRACTOR_SOURCE_CATEGORIES`,
        ).toBe(true);
      }
    });
  });

  describe("source-category grouping sanity", () => {
    it("html_head sources: title, meta, canonical, og_title, og_desc", () => {
      const got = listElementTypesBySourceCategory("html_head");
      expect(new Set(got)).toEqual(
        new Set<ElementType>([
          "title",
          "meta",
          "canonical",
          "og_title",
          "og_desc",
        ]),
      );
    });

    it("html_headings sources: h1, h2, h3", () => {
      const got = listElementTypesBySourceCategory("html_headings");
      expect(new Set(got)).toEqual(
        new Set<ElementType>(["h1", "h2", "h3"]),
      );
    });

    it("html_faq sources: faq_question, faq_answer", () => {
      const got = listElementTypesBySourceCategory("html_faq");
      expect(new Set(got)).toEqual(
        new Set<ElementType>(["faq_question", "faq_answer"]),
      );
    });

    it("schema_jsonld sources: schema_type, schema_property", () => {
      const got = listElementTypesBySourceCategory("schema_jsonld");
      expect(new Set(got)).toEqual(
        new Set<ElementType>(["schema_type", "schema_property"]),
      );
    });

    it("html_links sources: internal_link, external_link", () => {
      const got = listElementTypesBySourceCategory("html_links");
      expect(new Set(got)).toEqual(
        new Set<ElementType>(["internal_link", "external_link"]),
      );
    });

    it("entity_mention sources: city_mention, service_mention, entity_mention, competitor_mention", () => {
      const got = listElementTypesBySourceCategory("entity_mention");
      expect(new Set(got)).toEqual(
        new Set<ElementType>([
          "city_mention",
          "service_mention",
          "entity_mention",
          "competitor_mention",
        ]),
      );
    });

    it("html_blocks sources: 12 block types", () => {
      const got = listElementTypesBySourceCategory("html_blocks");
      expect(new Set(got)).toEqual(
        new Set<ElementType>([
          "table",
          "table_row",
          "list",
          "cta",
          "testimonial",
          "proof",
          "project_card",
          "answer_block",
          "comparison_block",
          "cost_section",
          "timeline_section",
          "service_area_grid",
        ]),
      );
    });

    it("external sources: external_citation", () => {
      const got = listElementTypesBySourceCategory("external");
      expect(got).toEqual<ElementType[]>(["external_citation"]);
    });

    it("every element type belongs to exactly one source category", () => {
      // Sum across categories must equal the full enum count with no
      // overlap (a type could end up in two arrays if someone
      // accidentally changed filter semantics).
      let total = 0;
      const seen = new Set<ElementType>();
      for (const cat of EXTRACTOR_SOURCE_CATEGORIES) {
        const list = listElementTypesBySourceCategory(cat);
        for (const t of list) {
          expect(seen.has(t), `${t} appears in multiple categories`).toBe(
            false,
          );
          seen.add(t);
        }
        total += list.length;
      }
      expect(total).toBe(EXPECTED_TOTAL);
    });
  });

  describe("scope guardrails — 6A.1.3 is data-only", () => {
    it("no spec carries a function reference (no extract() binding here)", () => {
      // Phase 6A.1.5 will bind extractor functions in a separate module.
      // This registry must stay data-only so it can be imported from
      // both server and client with zero bundle risk.
      for (const t of ELEMENT_TYPES) {
        const spec = EXTRACTOR_REGISTRY[t];
        for (const key of Object.keys(spec)) {
          const value = (spec as unknown as Record<string, unknown>)[key];
          expect(
            typeof value === "function",
            `EXTRACTOR_REGISTRY.${t}.${key} is a function — registry must stay data-only`,
          ).toBe(false);
        }
      }
    });
  });

  describe("helpers", () => {
    it("getExtractorSpec round-trips for every element type", () => {
      for (const t of ELEMENT_TYPES) {
        const spec = getExtractorSpec(t);
        expect(spec.elementType).toBe(t);
        expect(spec).toEqual(EXTRACTOR_REGISTRY[t]);
      }
    });

    it("isValidElementType accepts every enum value", () => {
      for (const t of ELEMENT_TYPES) {
        expect(isValidElementType(t)).toBe(true);
      }
    });

    it("isValidElementType rejects non-enum inputs", () => {
      expect(isValidElementType("not_a_real_element")).toBe(false);
      expect(isValidElementType("")).toBe(false);
      expect(isValidElementType("H1")).toBe(false); // case-sensitive
      expect(isValidElementType("TITLE")).toBe(false);
      expect(isValidElementType(null)).toBe(false);
      expect(isValidElementType(undefined)).toBe(false);
      expect(isValidElementType(42)).toBe(false);
      expect(isValidElementType({})).toBe(false);
      expect(isValidElementType([])).toBe(false);
    });

    it("isValidElementType narrows the type (compile-time check)", () => {
      const s: unknown = "h2";
      if (isValidElementType(s)) {
        const narrowed: ElementType = s;
        expect(narrowed).toBe("h2");
      }
    });

    it("listElementTypesBySourceCategory accepts every category and returns ≥1 type", () => {
      for (const cat of EXTRACTOR_SOURCE_CATEGORIES) {
        const list = listElementTypesBySourceCategory(cat);
        expect(list.length).toBeGreaterThan(0);
      }
    });
  });

  // Silence unused-import warning on the ExtractorSourceCategory type
  // (it's used in the types above but referenced here for completeness).
  void (0 as unknown as ExtractorSourceCategory);
});
