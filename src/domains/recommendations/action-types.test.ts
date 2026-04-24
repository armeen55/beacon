import { describe, it, expect } from "vitest";
import {
  SIGNAL_TYPES,
  ASSET_TYPES,
  type SignalType,
  type AssetType,
} from "@/lib/constants";
import {
  ACTION_TYPES,
  ACTION_TYPE_REGISTRY,
  getActionTypeSpec,
  listActiveActionTypes,
  isValidActionType,
  type ActionType,
} from "./action-types";
import {
  ELEMENT_TYPES,
  type ElementType,
} from "@/domains/pages/extractors/registry";

// ---------------------------------------------------------------------------
// Sprint 6A.1 Phase 2 — action-type registry tests.
//
// Contract-level invariants. These fail loudly if the registry drifts from
// the plan (e.g., someone adds a 23rd type without updating the enum, or
// flips the wrong type to generatorActive).
// ---------------------------------------------------------------------------

describe("Sprint 6A.1 Phase 2 — action-type registry", () => {
  describe("enum completeness", () => {
    it("has exactly 22 action types", () => {
      expect(ACTION_TYPES).toHaveLength(22);
    });

    it("contains every action type planned in Sprint 6A.1", () => {
      // Spelled out verbatim so the plan and the code stay pinned together.
      const expected: ActionType[] = [
        "edit_title",
        "edit_meta",
        "change_h1",
        "add_h2_section",
        "rewrite_h2",
        "add_faq",
        "rewrite_faq",
        "add_table",
        "edit_table_row",
        "add_answer_block",
        "add_proof_section",
        "add_comparison_section",
        "add_cost_section",
        "add_timeline_section",
        "add_internal_link",
        "add_schema",
        "fix_schema",
        "reorder_sections",
        "split_page",
        "merge_pages",
        "create_page",
        "watch",
      ];
      expect(new Set(ACTION_TYPES)).toEqual(new Set(expected));
    });

    it("has no duplicate action types", () => {
      expect(new Set(ACTION_TYPES).size).toBe(ACTION_TYPES.length);
    });
  });

  describe("registry completeness", () => {
    it("has a spec for every action type in the enum", () => {
      for (const t of ACTION_TYPES) {
        expect(
          ACTION_TYPE_REGISTRY[t],
          `missing spec for ${t}`,
        ).toBeDefined();
      }
    });

    it("registry key equals the spec's actionType field (no drift)", () => {
      for (const t of ACTION_TYPES) {
        expect(ACTION_TYPE_REGISTRY[t].actionType).toBe(t);
      }
    });

    it("registry has no entries outside the enum", () => {
      const registryKeys = Object.keys(ACTION_TYPE_REGISTRY);
      expect(registryKeys).toHaveLength(ACTION_TYPES.length);
      for (const k of registryKeys) {
        expect(isValidActionType(k)).toBe(true);
      }
    });
  });

  describe("generator activation — v1 floor is exactly 3", () => {
    const ACTIVE_V1: ActionType[] = [
      "edit_title",
      "add_h2_section",
      "add_faq",
    ];

    it("exactly 3 types are generatorActive=true", () => {
      const active = ACTION_TYPES.filter(
        (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
      );
      expect(active).toHaveLength(3);
      expect(new Set(active)).toEqual(new Set(ACTIVE_V1));
    });

    it("listActiveActionTypes() returns the same three", () => {
      expect(new Set(listActiveActionTypes())).toEqual(new Set(ACTIVE_V1));
    });

    it("every other type is generatorActive=false (Sprint 6A.2 flips them)", () => {
      const inactive = ACTION_TYPES.filter(
        (t) => !ACTION_TYPE_REGISTRY[t].generatorActive,
      );
      expect(inactive).toHaveLength(19);
      for (const t of ACTIVE_V1) {
        expect(inactive).not.toContain(t);
      }
    });
  });

  describe("changelog metadata validity", () => {
    it("every action type has a signalType drawn from SignalType", () => {
      for (const t of ACTION_TYPES) {
        const sig = ACTION_TYPE_REGISTRY[t].signalType;
        expect(
          (SIGNAL_TYPES as readonly string[]).includes(sig),
          `${t}.signalType=${sig} not in SIGNAL_TYPES`,
        ).toBe(true);
      }
    });

    it("every action type has a changelogAssetType drawn from AssetType", () => {
      for (const t of ACTION_TYPES) {
        const asset = ACTION_TYPE_REGISTRY[t].changelogAssetType;
        expect(
          (ASSET_TYPES as readonly string[]).includes(asset),
          `${t}.changelogAssetType=${asset} not in ASSET_TYPES`,
        ).toBe(true);
      }
    });

    it("every action type has a non-empty operatorLabel", () => {
      for (const t of ACTION_TYPES) {
        const label = ACTION_TYPE_REGISTRY[t].operatorLabel;
        expect(typeof label).toBe("string");
        expect(label.length).toBeGreaterThan(0);
      }
    });
  });

  describe("text-requirement coherence", () => {
    it("actions that imply an in-place rewrite also require current text", () => {
      // Pattern: rewrite-style actions need both current + proposed.
      const rewriteStyle: ActionType[] = [
        "edit_title",
        "edit_meta",
        "change_h1",
        "rewrite_h2",
        "rewrite_faq",
        "edit_table_row",
        "fix_schema",
      ];
      for (const t of rewriteStyle) {
        const spec = ACTION_TYPE_REGISTRY[t];
        expect(
          spec.requiresCurrentText,
          `${t} should require current_text`,
        ).toBe(true);
        expect(
          spec.requiresProposedText,
          `${t} should require proposed_text`,
        ).toBe(true);
      }
    });

    it("page-lifecycle actions (split/merge/create/watch) don't require either text field", () => {
      const pageLifecycle: ActionType[] = [
        "split_page",
        "merge_pages",
        "create_page",
        "watch",
      ];
      for (const t of pageLifecycle) {
        const spec = ACTION_TYPE_REGISTRY[t];
        expect(spec.requiresCurrentText).toBe(false);
        expect(spec.requiresProposedText).toBe(false);
      }
    });

    it("additive content actions require proposed_text but not current_text", () => {
      const additiveContent: ActionType[] = [
        "add_h2_section",
        "add_faq",
        "add_table",
        "add_answer_block",
        "add_proof_section",
        "add_comparison_section",
        "add_cost_section",
        "add_timeline_section",
        "add_internal_link",
        "add_schema",
        "reorder_sections",
      ];
      for (const t of additiveContent) {
        const spec = ACTION_TYPE_REGISTRY[t];
        expect(
          spec.requiresCurrentText,
          `${t} should NOT require current_text`,
        ).toBe(false);
        expect(
          spec.requiresProposedText,
          `${t} should require proposed_text`,
        ).toBe(true);
      }
    });
  });

  describe("signal_type semantic grouping", () => {
    it("FAQ actions carry signalType='faq'", () => {
      const faqActions: ActionType[] = ["add_faq", "rewrite_faq"];
      for (const t of faqActions) {
        expect(ACTION_TYPE_REGISTRY[t].signalType).toBe<SignalType>("faq");
      }
    });

    it("page-lifecycle actions carry signalType='page'", () => {
      const pageActions: ActionType[] = [
        "split_page",
        "merge_pages",
        "create_page",
        "watch",
      ];
      for (const t of pageActions) {
        expect(ACTION_TYPE_REGISTRY[t].signalType).toBe<SignalType>("page");
      }
    });

    it("schema/internal-link/reorder actions carry signalType='technical'", () => {
      const technicalActions: ActionType[] = [
        "add_internal_link",
        "add_schema",
        "fix_schema",
        "reorder_sections",
      ];
      for (const t of technicalActions) {
        expect(ACTION_TYPE_REGISTRY[t].signalType).toBe<SignalType>(
          "technical",
        );
      }
    });
  });

  describe("helper functions", () => {
    it("getActionTypeSpec returns the correct spec for each type", () => {
      for (const t of ACTION_TYPES) {
        const spec = getActionTypeSpec(t);
        expect(spec.actionType).toBe(t);
        expect(spec).toEqual(ACTION_TYPE_REGISTRY[t]);
      }
    });

    it("isValidActionType accepts every enum value", () => {
      for (const t of ACTION_TYPES) {
        expect(isValidActionType(t)).toBe(true);
      }
    });

    it("isValidActionType rejects non-enum strings", () => {
      expect(isValidActionType("not_a_real_action")).toBe(false);
      expect(isValidActionType("")).toBe(false);
      expect(isValidActionType("EDIT_TITLE")).toBe(false); // case-sensitive
      expect(isValidActionType(null)).toBe(false);
      expect(isValidActionType(undefined)).toBe(false);
      expect(isValidActionType(42)).toBe(false);
      expect(isValidActionType({})).toBe(false);
    });

    it("isValidActionType narrows the type (compile-time check)", () => {
      const s: unknown = "edit_title";
      if (isValidActionType(s)) {
        // inside the narrow, s is ActionType — pass through a helper
        // that only accepts ActionType to prove the narrowing compiles
        const spec: ActionType = s;
        expect(spec).toBe("edit_title");
      }
    });
  });

  describe("scope guardrails — 6A.1 did NOT ship generators", () => {
    it("the registry exposes NO generator function references", () => {
      // Prevents a sloppy future commit from binding a generator into
      // the spec (that belongs in the provider-adapter layer,
      // Phase 6A.1.8/9). This check catches the drift at import time.
      for (const t of ACTION_TYPES) {
        const spec = ACTION_TYPE_REGISTRY[t];
        const fields = Object.keys(spec);
        for (const field of fields) {
          const value = (spec as unknown as Record<string, unknown>)[field];
          expect(
            typeof value === "function",
            `ACTION_TYPE_REGISTRY.${t}.${field} is a function — registry must stay data-only`,
          ).toBe(false);
        }
      }
    });

    it("spec fields are exactly the 8 documented in the plan (data-only; elementTypeDomain wired in Phase 6A.1.4)", () => {
      const EXPECTED_FIELDS = new Set([
        "actionType",
        "elementTypeDomain",
        "signalType",
        "requiresCurrentText",
        "requiresProposedText",
        "changelogAssetType",
        "operatorLabel",
        "generatorActive",
      ]);
      for (const t of ACTION_TYPES) {
        const fields = new Set(Object.keys(ACTION_TYPE_REGISTRY[t]));
        expect(fields).toEqual(EXPECTED_FIELDS);
      }
    });
  });

  describe("elementTypeDomain (Phase 6A.1.4 wiring)", () => {
    it("every spec has an elementTypeDomain array", () => {
      for (const t of ACTION_TYPES) {
        expect(Array.isArray(ACTION_TYPE_REGISTRY[t].elementTypeDomain)).toBe(
          true,
        );
      }
    });

    it("every element type in every spec.elementTypeDomain is a valid ElementType", () => {
      for (const t of ACTION_TYPES) {
        const domain = ACTION_TYPE_REGISTRY[t].elementTypeDomain;
        for (const et of domain) {
          expect(
            ELEMENT_TYPES.includes(et),
            `ACTION_TYPE_REGISTRY.${t}.elementTypeDomain contains ${et}, which is not a valid ElementType`,
          ).toBe(true);
        }
      }
    });

    it("page-lifecycle actions have empty elementTypeDomain (no element target)", () => {
      const pageLifecycle: ActionType[] = [
        "split_page",
        "merge_pages",
        "create_page",
        "watch",
      ];
      for (const t of pageLifecycle) {
        expect(ACTION_TYPE_REGISTRY[t].elementTypeDomain).toEqual([]);
      }
    });

    it("element-specific actions have non-empty elementTypeDomain", () => {
      const elementScoped = ACTION_TYPES.filter(
        (t) =>
          !["split_page", "merge_pages", "create_page", "watch"].includes(t),
      );
      for (const t of elementScoped) {
        expect(ACTION_TYPE_REGISTRY[t].elementTypeDomain.length).toBeGreaterThan(0);
      }
    });

    it("title/meta/h1 actions each domain to a single matching element type", () => {
      expect(ACTION_TYPE_REGISTRY.edit_title.elementTypeDomain).toEqual(["title"]);
      expect(ACTION_TYPE_REGISTRY.edit_meta.elementTypeDomain).toEqual(["meta"]);
      expect(ACTION_TYPE_REGISTRY.change_h1.elementTypeDomain).toEqual(["h1"]);
    });

    it("add_h2_section + rewrite_h2 both domain to h2", () => {
      expect(ACTION_TYPE_REGISTRY.add_h2_section.elementTypeDomain).toEqual([
        "h2",
      ]);
      expect(ACTION_TYPE_REGISTRY.rewrite_h2.elementTypeDomain).toEqual([
        "h2",
      ]);
    });

    it("FAQ actions domain to both faq_question AND faq_answer (Q+A are paired)", () => {
      expect(new Set(ACTION_TYPE_REGISTRY.add_faq.elementTypeDomain)).toEqual(
        new Set<ElementType>(["faq_question", "faq_answer"]),
      );
      expect(new Set(ACTION_TYPE_REGISTRY.rewrite_faq.elementTypeDomain)).toEqual(
        new Set<ElementType>(["faq_question", "faq_answer"]),
      );
    });

    it("schema actions domain to both schema_type AND schema_property", () => {
      expect(new Set(ACTION_TYPE_REGISTRY.add_schema.elementTypeDomain)).toEqual(
        new Set<ElementType>(["schema_type", "schema_property"]),
      );
      expect(new Set(ACTION_TYPE_REGISTRY.fix_schema.elementTypeDomain)).toEqual(
        new Set<ElementType>(["schema_type", "schema_property"]),
      );
    });

    it("reorder_sections targets heading types (h2, h3)", () => {
      expect(new Set(ACTION_TYPE_REGISTRY.reorder_sections.elementTypeDomain)).toEqual(
        new Set<ElementType>(["h2", "h3"]),
      );
    });
  });
});

// Silence unused-import TS warning — AssetType is imported to tighten
// type tests above but not referenced at the value level.
void (0 as unknown as AssetType);
