import { describe, it, expect } from "vitest";
import { classifyQueryIntent } from "@/domains/demand-graph/query-intent";

describe("query-intent (deterministic, no LLM)", () => {
  it("classifies the four intents from generic cues", () => {
    expect(classifyQueryIntent("buy persian rug online").intent).toBe("transactional");
    expect(classifyQueryIntent("persian rug for sale").intent).toBe("transactional");
    expect(classifyQueryIntent("custom home builder cost").intent).toBe("commercial"); // researching cost
    expect(classifyQueryIntent("best persian restaurants").intent).toBe("commercial");
    expect(classifyQueryIntent("iphone 15 vs samsung").intent).toBe("commercial");
    expect(classifyQueryIntent("iranopedia login").intent).toBe("navigational");
    expect(classifyQueryIntent("what is nowruz").intent).toBe("informational");
    expect(classifyQueryIntent("history of the persian empire").intent).toBe("informational");
  });

  it("each intent carries a plain-language asset-shape hint", () => {
    const c = classifyQueryIntent("best adu builders");
    expect(c.hint.length).toBeGreaterThan(10);
    expect(c.hint.toLowerCase()).toContain("comparison");
    expect(classifyQueryIntent("what is nowruz").hint.toLowerCase()).toContain("concise answer");
  });

  it("is deterministic", () => {
    expect(classifyQueryIntent("adu cost calculator")).toEqual(classifyQueryIntent("adu cost calculator"));
  });
});
