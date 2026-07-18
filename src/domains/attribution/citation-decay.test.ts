import { describe, expect, it } from "vitest";
import { computeCitationDecayFromShards } from "./citation-decay";
import type { CitationObservation } from "@/domains/citation-observations/types";

function citation(date: string): CitationObservation {
  return {
    id: date,
    observed_at: `${date}T00:00:00.000Z`,
    url: "https://example.com/page",
    domain: "example.com",
    is_owned: true,
  } as CitationObservation;
}

describe("computeCitationDecayFromShards", () => {
  it("abstains when cold shards predate the native polling regime", () => {
    const result = computeCitationDecayFromShards(
      ["2026-04-18", "2026-04-19", "2026-04-20", "2026-04-21"].map((date) => ({
        date,
        citations: [citation(date)],
      })),
      "example.com",
      { min_periods: 4, min_citations: 2, soft_decline_threshold: -0.2, meaningful_decline_threshold: -0.5 },
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("insufficient_history");
    expect(result[0]?.explanation).toContain("before native AI polling began");
  });
});
