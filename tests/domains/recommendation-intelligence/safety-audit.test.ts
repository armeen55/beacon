/**
 * Slice 4.5.G-A (2026-05-21) — safety-audit scanner unit tests.
 *
 * Pure function, no mocks. Verifies each of the 9 locked violation
 * kinds + severity band assignment + multi-violation behavior +
 * context excerpts + field selection + null/empty handling.
 */

import { describe, it, expect } from "vitest";

import {
  ARCHITECT_OVERCLAIM_TOKENS,
  CAUSAL_LANGUAGE_TOKENS,
  auditRecommendedEditRow,
  type SafetyAuditContext,
} from "@/domains/recommendation-intelligence/safety-audit";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const FIXED_NOW = new Date("2026-05-21T12:00:00.000Z");

function makeContext(
  overrides: Partial<SafetyAuditContext> = {},
): SafetyAuditContext {
  return {
    competitorNames: [],
    tenantId: "tenant-a",
    now: FIXED_NOW,
    ...overrides,
  };
}

function makeRow(
  overrides: Partial<RecommendedEditRow> = {},
): RecommendedEditRow {
  return {
    id: "edit-1",
    tenant_id: "tenant-a",
    rec_id: "rec-1",
    action_type: "edit_title",
    target_url: "https://test.example/services/kitchen",
    target_element_key: null,
    display_label: null,
    current_text: null,
    proposed_text: null,
    why: "",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "medium",
    measurement_plan: null,
    risks: [],
    source: "deterministic",
    provider_name: null,
    evidence_hash: null,
    model: null,
    cost_usd: null,
    created_at: "2026-05-21T00:00:00.000Z",
    updated_at: "2026-05-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("safety-audit / clean row", () => {
  it("returns no violations on a clean row", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text: "Add a clear page title that names the service.",
        why: "Helps AI search platforms surface the page.",
      }),
      makeContext(),
    );
    expect(result.violations).toEqual([]);
    expect(result.rec_id).toBe("rec-1");
    expect(result.target_url).toBe("https://test.example/services/kitchen");
    expect(result.scanned_at).toBe(FIXED_NOW.toISOString());
  });

  it("handles null/empty fields without crashing", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text: null,
        why: "",
        display_label: null,
        expected_impact: null,
        measurement_plan: null,
      }),
      makeContext(),
    );
    expect(result.violations).toEqual([]);
  });
});

describe("safety-audit / placeholder", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["TODO marker", "Page title TODO: rewrite later"],
    ["FIXME marker", "FIXME: this needs work"],
    ["lorem ipsum", "Lorem ipsum dolor sit amet"],
    ["literal 'placeholder'", "This is a placeholder line"],
    ["TBD marker", "Service area: TBD"],
    ["{{handlebars}}", "Hello {{name}} welcome"],
    ["[insert ...]", "Sample copy [insert tagline here] end"],
    ["<placeholder> tag", "Use <placeholder name='x'/> until ready"],
  ];
  for (const [label, text] of cases) {
    it(`detects placeholder for: ${label}`, () => {
      const result = auditRecommendedEditRow(
        makeRow({ proposed_text: text }),
        makeContext(),
      );
      const placeholderVios = result.violations.filter(
        (v) => v.kind === "placeholder",
      );
      expect(placeholderVios.length).toBeGreaterThan(0);
      expect(placeholderVios[0]!.severity).toBe("high");
      expect(placeholderVios[0]!.context_excerpt.length).toBeGreaterThan(0);
    });
  }
});

describe("safety-audit / competitor_name", () => {
  it("detects competitor name when present in competitorNames context", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "We beat Supple Homes on quality" }),
      makeContext({ competitorNames: ["Supple Homes"] }),
    );
    const vios = result.violations.filter(
      (v) => v.kind === "competitor_name",
    );
    expect(vios.length).toBe(1);
    expect(vios[0]!.matched_text).toBe("Supple Homes");
    expect(vios[0]!.severity).toBe("high");
  });

  it("does NOT detect when competitorNames is empty", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "We beat Supple Homes on quality" }),
      makeContext({ competitorNames: [] }),
    );
    expect(
      result.violations.filter((v) => v.kind === "competitor_name").length,
    ).toBe(0);
  });

  it("matches case-insensitively + whole-word", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "supple HOMES is mentioned" }),
      makeContext({ competitorNames: ["Supple Homes"] }),
    );
    expect(
      result.violations.filter((v) => v.kind === "competitor_name").length,
    ).toBeGreaterThan(0);
  });
});

describe("safety-audit / unsupported_claim", () => {
  it("detects each unsupported-claim token", () => {
    const tokens = [
      "best",
      "leading",
      "premier",
      "guaranteed",
      "proven",
      "#1",
      "number one",
    ];
    for (const tok of tokens) {
      const result = auditRecommendedEditRow(
        makeRow({ proposed_text: `Our service is ${tok} in the area.` }),
        makeContext(),
      );
      const vios = result.violations.filter(
        (v) => v.kind === "unsupported_claim",
      );
      expect(
        vios.length,
        `expected unsupported_claim for "${tok}"`,
      ).toBeGreaterThan(0);
      expect(vios[0]!.severity).toBe("medium");
    }
  });
});

describe("safety-audit / architect_overclaim", () => {
  it("detects each locked architect/licensing term", () => {
    for (const tok of ARCHITECT_OVERCLAIM_TOKENS) {
      const result = auditRecommendedEditRow(
        makeRow({ proposed_text: `We are ${tok} in this region.` }),
        makeContext(),
      );
      const vios = result.violations.filter(
        (v) => v.kind === "architect_overclaim",
      );
      expect(
        vios.length,
        `expected architect_overclaim for "${tok}"`,
      ).toBeGreaterThan(0);
      expect(vios[0]!.severity).toBe("medium");
    }
  });
});

describe("safety-audit / causal_language", () => {
  it("detects each causal-language token", () => {
    for (const tok of CAUSAL_LANGUAGE_TOKENS) {
      const result = auditRecommendedEditRow(
        makeRow({ proposed_text: `This change ${tok} significantly.` }),
        makeContext(),
      );
      const vios = result.violations.filter(
        (v) => v.kind === "causal_language",
      );
      expect(
        vios.length,
        `expected causal_language for "${tok}"`,
      ).toBeGreaterThan(0);
      expect(vios[0]!.severity).toBe("medium");
    }
  });
});

describe("safety-audit / em_dash", () => {
  it("detects em-dash U+2014", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "Modern home — designed by Beacon" }),
      makeContext(),
    );
    const vios = result.violations.filter((v) => v.kind === "em_dash");
    expect(vios.length).toBe(1);
    expect(vios[0]!.matched_text).toBe("—");
    expect(vios[0]!.severity).toBe("low");
  });
});

describe("safety-audit / leading_superlative", () => {
  const prefixes = ["Best ", "The best ", "#1 ", "Leading "];
  for (const prefix of prefixes) {
    it(`detects leading-superlative prefix: ${prefix}`, () => {
      const result = auditRecommendedEditRow(
        makeRow({
          proposed_text: `${prefix}choice in the area for kitchens.`,
        }),
        makeContext(),
      );
      const vios = result.violations.filter(
        (v) => v.kind === "leading_superlative",
      );
      expect(vios.length).toBeGreaterThan(0);
      expect(vios[0]!.severity).toBe("low");
    });
  }

  it("does NOT trigger leading-superlative mid-string", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "Our service: the best in town." }),
      makeContext(),
    );
    expect(
      result.violations.filter((v) => v.kind === "leading_superlative")
        .length,
    ).toBe(0);
  });
});

describe("safety-audit / internal_token", () => {
  it("detects each locked internal token", () => {
    const tokens = [
      "action_type",
      "trigger_signal",
      "evidence_tier",
      "Mode A",
      "Mode B",
      "Mode C",
      "aiSearchSignal",
      "primary recommendation",
      "diagnostic_only",
      "customer-queue-ready",
    ];
    for (const tok of tokens) {
      const result = auditRecommendedEditRow(
        makeRow({ proposed_text: `Reference: ${tok} found here.` }),
        makeContext(),
      );
      const vios = result.violations.filter(
        (v) => v.kind === "internal_token",
      );
      expect(
        vios.length,
        `expected internal_token for "${tok}"`,
      ).toBeGreaterThan(0);
      expect(vios[0]!.severity).toBe("low");
    }
  });
});

describe("safety-audit / uuid_leak", () => {
  it("detects a UUID-shaped token", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text:
          "See rec abc12345-de67-89ab-cdef-0123456789ab for details.",
      }),
      makeContext(),
    );
    const vios = result.violations.filter((v) => v.kind === "uuid_leak");
    expect(vios.length).toBeGreaterThan(0);
    expect(vios[0]!.severity).toBe("high");
  });

  it("detects a long hex hash (32+ chars)", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text: "Hash: " + "a".repeat(40),
      }),
      makeContext(),
    );
    const vios = result.violations.filter((v) => v.kind === "uuid_leak");
    expect(vios.length).toBeGreaterThan(0);
    expect(vios[0]!.severity).toBe("high");
  });
});

describe("safety-audit / multi-violation", () => {
  it("returns multiple violations for one row carrying several issues", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text:
          "Best service — TODO finish. action_type: edit_title.",
      }),
      makeContext(),
    );
    const kinds = new Set(result.violations.map((v) => v.kind));
    expect(kinds.has("leading_superlative")).toBe(true);
    expect(kinds.has("em_dash")).toBe(true);
    expect(kinds.has("placeholder")).toBe(true);
    expect(kinds.has("internal_token")).toBe(true);
  });
});

describe("safety-audit / context excerpt", () => {
  it("includes ±30 char excerpt around the match", () => {
    const padding = "x".repeat(40);
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: `${padding} TODO ${padding}` }),
      makeContext(),
    );
    const vios = result.violations.filter((v) => v.kind === "placeholder");
    expect(vios.length).toBeGreaterThan(0);
    expect(vios[0]!.context_excerpt).toContain("TODO");
    expect(vios[0]!.context_excerpt.startsWith("…")).toBe(true);
    expect(vios[0]!.context_excerpt.endsWith("…")).toBe(true);
  });
});

describe("safety-audit / scanned fields", () => {
  it("scans proposed_text", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "TODO marker", why: "clean" }),
      makeContext(),
    );
    const fields = new Set(result.violations.map((v) => v.field));
    expect(fields.has("proposed_text")).toBe(true);
  });

  it("scans why", () => {
    const result = auditRecommendedEditRow(
      makeRow({ proposed_text: "clean", why: "TODO marker" }),
      makeContext(),
    );
    const fields = new Set(result.violations.map((v) => v.field));
    expect(fields.has("why")).toBe(true);
  });

  it("scans display_label as operator_evidence", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text: "clean",
        why: "clean",
        display_label: "TODO label",
      }),
      makeContext(),
    );
    const fields = new Set(result.violations.map((v) => v.field));
    expect(fields.has("operator_evidence")).toBe(true);
  });

  it("scans expected_impact + measurement_plan as customer_copy", () => {
    const result = auditRecommendedEditRow(
      makeRow({
        proposed_text: "clean",
        why: "clean",
        expected_impact: "TODO impact",
        measurement_plan: "TODO plan",
      }),
      makeContext(),
    );
    const customerCopyVios = result.violations.filter(
      (v) => v.field === "customer_copy",
    );
    expect(customerCopyVios.length).toBe(2);
  });
});
