import { describe, expect, it } from "vitest";

import { buildQueryKeywordIndex } from "./query-index";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";

function observation(searchQueries: string): PromptAnswerObservation {
  return {
    id: "obs-1",
    tenant_id: "tenant-a",
    topic: "builders",
    metadata: { search_queries: searchQueries },
  } as unknown as PromptAnswerObservation;
}

describe("buildQueryKeywordIndex search-query parsing", () => {
  it("uses the canonical conservative parser instead of emitting short comma shards", () => {
    const index = buildQueryKeywordIndex(
      null,
      [observation("Brookstone, best luxury home builders in Atherton")],
    );
    expect(index.by_topic.builders?.top_queries).toEqual([
      "best luxury home builders in Atherton",
    ]);
    expect(index.total_unique_queries).toBe(1);
  });

  it("preserves a single coarse query when conservative splitting would discard every fragment", () => {
    const raw = "Ritz, Supple";
    const index = buildQueryKeywordIndex(null, [observation(raw)]);
    expect(index.by_topic.builders?.top_queries).toEqual([raw]);
  });
});
