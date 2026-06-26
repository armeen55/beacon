import { describe, it, expect } from "vitest";

import { classifyRecProvenance } from "./rec-provenance";

describe("classifyRecProvenance", () => {
  it("signal-led sources are evidence-backed, not basic", () => {
    for (const s of ["gsc_led", "clarity_friction", "aeo_readiness"]) {
      const p = classifyRecProvenance(s);
      expect(p.kind).toBe("signal_backed");
      expect(p.isBasic).toBe(false);
    }
  });

  it("openai/anthropic are AI-drafted", () => {
    expect(classifyRecProvenance("openai").kind).toBe("ai_drafted");
    expect(classifyRecProvenance("anthropic").kind).toBe("ai_drafted");
  });

  it("deterministic / promotion / null are the legacy basic class", () => {
    expect(classifyRecProvenance("deterministic").isBasic).toBe(true);
    expect(classifyRecProvenance("deterministic_promotion").isBasic).toBe(true);
    expect(classifyRecProvenance(null).isBasic).toBe(true);
    expect(classifyRecProvenance(undefined).kind).toBe("basic");
  });

  it("operator-edited is its own (non-basic) class", () => {
    const p = classifyRecProvenance("operator_edited");
    expect(p.kind).toBe("operator");
    expect(p.isBasic).toBe(false);
  });

  it("an unknown named source is treated as signal-backed, not basic", () => {
    expect(classifyRecProvenance("some_new_trigger").isBasic).toBe(false);
  });
});
