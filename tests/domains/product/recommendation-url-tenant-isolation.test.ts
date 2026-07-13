import { describe, expect, it } from "vitest";
import { resolveRecommendationUrl } from "@/domains/product/recommendation-engine";

describe("recommendation target URLs use explicit tenant identity", () => {
  it("is stable across A → B → A in one process", () => {
    const a1 = resolveRecommendationUrl("/topic", "https://tenant-a.example");
    const b = resolveRecommendationUrl("/topic", "https://tenant-b.example");
    const none = resolveRecommendationUrl("/topic");
    const a2 = resolveRecommendationUrl("/topic", "https://tenant-a.example");

    expect(a1).toBe("https://tenant-a.example/topic");
    expect(b).toBe("https://tenant-b.example/topic");
    expect(none).toBeNull();
    expect(a2).toBe(a1);
  });

  it("leaves an already absolute target unchanged", () => {
    expect(
      resolveRecommendationUrl(
        "https://external.example/topic",
        "https://tenant-a.example",
      ),
    ).toBe("https://external.example/topic");
  });
});
