import { describe, expect, it } from "vitest";
import {
  STRUCTURE_LABEL,
  structureLabel,
  PLATFORM_LABEL,
  platformLabel,
} from "./structure-labels";

describe("structureLabel — W2 Step 2.3 enum→copy mapping", () => {
  it("maps every Schema v2 answer-structure enum to plain English", () => {
    expect(structureLabel("ranked_list")).toBe("Ranked list");
    expect(structureLabel("bullet_list")).toBe("Bullet points");
    expect(structureLabel("narrative")).toBe("Story");
    expect(structureLabel("comparison")).toBe("Side-by-side comparison");
    expect(structureLabel("qa_format")).toBe("Q&A");
    expect(structureLabel("mixed")).toBe("Mixed format");
  });

  it("never renders raw enum tokens like 'qa_format' or 'ranked_list' verbatim", () => {
    for (const key of Object.keys(STRUCTURE_LABEL)) {
      const label = structureLabel(key);
      expect(label).not.toBe(key);
      expect(label).not.toMatch(/_/);
    }
  });

  it("falls back to a humanized form for unmapped keys (no raw enum leak)", () => {
    expect(structureLabel("checklist_format")).toBe("Checklist Format");
    expect(structureLabel("future_shape")).toBe("Future Shape");
    expect(structureLabel("foo")).toBe("Foo");
  });
});

describe("platformLabel", () => {
  it("maps internal platform keys to operator-facing copy", () => {
    expect(platformLabel("perplexity")).toBe("Perplexity");
    expect(platformLabel("chatgpt")).toBe("ChatGPT");
    expect(platformLabel("openai")).toBe("ChatGPT");
    expect(platformLabel("google_aio")).toBe("Google AI");
    expect(platformLabel("claude")).toBe("Claude");
  });

  it("falls back to the raw value when no mapping exists", () => {
    expect(platformLabel("unknown")).toBe("unknown");
  });

  it("PLATFORM_LABEL covers every key the data layer currently emits", () => {
    expect(PLATFORM_LABEL.perplexity).toBeDefined();
    expect(PLATFORM_LABEL.chatgpt).toBeDefined();
    expect(PLATFORM_LABEL.openai).toBeDefined();
    expect(PLATFORM_LABEL.google_aio).toBeDefined();
  });
});
