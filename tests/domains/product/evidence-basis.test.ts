import { describe, it, expect } from "vitest";
import {
  classifyEvidenceBasis,
  type EvidenceBasisInput,
} from "@/domains/product/evidence-basis";

function base(overrides: Partial<EvidenceBasisInput> = {}): EvidenceBasisInput {
  return {
    recType: "strengthen_structure",
    hasPriorSuccess: false,
    patternTrackRecord: null,
    minedPatternStrength: null,
    baselineCitations: null,
    brainPatternStrength: null,
    ...overrides,
  };
}

describe("classifyEvidenceBasis", () => {
  // ── shared_pattern ──────────────────────────────────────────────────────
  it("returns shared_pattern when brain pattern is emerging_signal", () => {
    expect(
      classifyEvidenceBasis(base({ brainPatternStrength: "emerging_signal" })),
    ).toBe("shared_pattern");
  });

  it("returns shared_pattern when brain pattern is strong_signal", () => {
    expect(
      classifyEvidenceBasis(base({ brainPatternStrength: "strong_signal" })),
    ).toBe("shared_pattern");
  });

  it("does not promote weak_signal brain pattern to shared_pattern", () => {
    expect(
      classifyEvidenceBasis(base({ brainPatternStrength: "weak_signal" })),
    ).toBe("heuristic");
  });

  it("does not promote not_enough_evidence brain pattern to shared_pattern", () => {
    expect(
      classifyEvidenceBasis(
        base({ brainPatternStrength: "not_enough_evidence" }),
      ),
    ).toBe("heuristic");
  });

  it("never fabricates shared_pattern when brainPatternStrength is null", () => {
    expect(classifyEvidenceBasis(base({ brainPatternStrength: null }))).toBe(
      "heuristic",
    );
  });

  // ── tenant_history ──────────────────────────────────────────────────────
  it("returns tenant_history for hurting_verdict cards", () => {
    expect(classifyEvidenceBasis(base({ recType: "hurting_verdict" }))).toBe(
      "tenant_history",
    );
  });

  it("returns tenant_history for helping_verdict cards", () => {
    expect(classifyEvidenceBasis(base({ recType: "helping_verdict" }))).toBe(
      "tenant_history",
    );
  });

  it("returns tenant_history when priorSuccess is set", () => {
    expect(classifyEvidenceBasis(base({ hasPriorSuccess: true }))).toBe(
      "tenant_history",
    );
  });

  it("returns tenant_history for a pattern track record with successRate ≥ 0.6 and actedOn ≥ 2", () => {
    expect(
      classifyEvidenceBasis(
        base({
          patternTrackRecord: { successRate: 0.75, actedOn: 4 },
        }),
      ),
    ).toBe("tenant_history");
  });

  it("does not return tenant_history for a pattern track record that only met one threshold", () => {
    // successRate below threshold, even if actedOn high
    expect(
      classifyEvidenceBasis(
        base({ patternTrackRecord: { successRate: 0.4, actedOn: 10 } }),
      ),
    ).toBe("heuristic");
    // actedOn below threshold, even if successRate high
    expect(
      classifyEvidenceBasis(
        base({ patternTrackRecord: { successRate: 1.0, actedOn: 1 } }),
      ),
    ).toBe("heuristic");
  });

  // ── current_dataset ─────────────────────────────────────────────────────
  it("returns current_dataset for a validated mined pattern", () => {
    expect(
      classifyEvidenceBasis(base({ minedPatternStrength: "validated" })),
    ).toBe("current_dataset");
  });

  it("returns current_dataset for a probable mined pattern", () => {
    expect(
      classifyEvidenceBasis(base({ minedPatternStrength: "probable" })),
    ).toBe("current_dataset");
  });

  it("does not promote a speculative mined pattern to current_dataset", () => {
    expect(
      classifyEvidenceBasis(base({ minedPatternStrength: "speculative" })),
    ).toBe("heuristic");
  });

  it("returns current_dataset when baseline citations ≥ 50", () => {
    expect(classifyEvidenceBasis(base({ baselineCitations: 50 }))).toBe(
      "current_dataset",
    );
    expect(classifyEvidenceBasis(base({ baselineCitations: 1481 }))).toBe(
      "current_dataset",
    );
  });

  it("does not promote baseline citations below 50 to current_dataset", () => {
    expect(classifyEvidenceBasis(base({ baselineCitations: 49 }))).toBe(
      "heuristic",
    );
    expect(classifyEvidenceBasis(base({ baselineCitations: 0 }))).toBe(
      "heuristic",
    );
  });

  // ── heuristic fallback ──────────────────────────────────────────────────
  it("returns heuristic when no signal is present", () => {
    expect(classifyEvidenceBasis(base())).toBe("heuristic");
  });

  it("returns heuristic for a scan-finding-style rec with no citations", () => {
    expect(
      classifyEvidenceBasis(
        base({ recType: "schema_parity", baselineCitations: null }),
      ),
    ).toBe("heuristic");
  });

  // ── precedence ──────────────────────────────────────────────────────────
  it("picks the strongest tier when multiple signals are present", () => {
    // shared_pattern wins over tenant_history and current_dataset
    expect(
      classifyEvidenceBasis(
        base({
          brainPatternStrength: "strong_signal",
          hasPriorSuccess: true,
          minedPatternStrength: "validated",
          baselineCitations: 500,
        }),
      ),
    ).toBe("shared_pattern");

    // tenant_history wins over current_dataset
    expect(
      classifyEvidenceBasis(
        base({
          hasPriorSuccess: true,
          minedPatternStrength: "validated",
          baselineCitations: 500,
        }),
      ),
    ).toBe("tenant_history");

    // current_dataset wins over heuristic
    expect(
      classifyEvidenceBasis(
        base({ minedPatternStrength: "validated", baselineCitations: 10 }),
      ),
    ).toBe("current_dataset");
  });
});
