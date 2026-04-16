import { describe, it, expect } from "vitest";
import {
  mergeById,
  mergeCitationLists,
  mergeChangelogEntries,
  rebuildProfoundImportRuns,
} from "@/adapters/profound/merge-ingest";
import type { CitationObservation } from "@/domains/citation-observations/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import type { ChangelogEntry } from "@/domains/changelog/types";

describe("mergeById", () => {
  it("last incoming wins on duplicate id", () => {
    const a = mergeById(
      [{ id: "1", x: 1 } as { id: string; x: number }],
      [{ id: "1", x: 2 }],
      true
    );
    expect(a).toHaveLength(1);
    expect(a[0].x).toBe(2);
  });
});

describe("mergeCitationLists", () => {
  it("dedupes by run + url", () => {
    const a: CitationObservation = {
      id: "cit-a-1",
      prompt_answer_id: "run-1",
      domain: "x.com",
      url: "https://x.com/a",
      title: null,
      citation_order: 1,
      source_category: "other",
      is_owned: false,
      tracked_entity_id: null,
      observed_at: "2026-04-01",
    };
    const b: CitationObservation = { ...a, id: "cit-b-1", citation_order: 2 };
    const merged = mergeCitationLists([a], [b]);
    expect(merged).toHaveLength(1);
  });
});

describe("rebuildProfoundImportRuns", () => {
  it("groups by observation run_id", () => {
    const obs: PromptAnswerObservation[] = [
      {
        id: "o1",
        prompt_id: "p1",
        run_id: "run-2026-04-01-chatgpt",
        answer_hash: null,
        position: null,
        tracked_brand_mentioned: null,
        tracked_brand_cited: null,
        citation_count: 0,
        owned_citation_count: 0,
        citation_domains: [],
        citation_categories: {},
        mentions: [],
        observed_at: "2026-04-01T00:00:00.000Z",
        platform: "ChatGPT",
        topic: "t",
        metadata: {},
      },
      {
        id: "o2",
        prompt_id: "p1",
        run_id: "run-2026-04-01-chatgpt",
        answer_hash: null,
        position: null,
        tracked_brand_mentioned: null,
        tracked_brand_cited: null,
        citation_count: 0,
        owned_citation_count: 0,
        citation_domains: [],
        citation_categories: {},
        mentions: [],
        observed_at: "2026-04-01T00:00:00.000Z",
        platform: "ChatGPT",
        topic: "t",
        metadata: {},
      },
    ];
    const runs = rebuildProfoundImportRuns(obs, "acct", "batch-1");
    expect(runs).toHaveLength(1);
    expect(runs[0].prompt_count).toBe(2);
  });
});

describe("mergeChangelogEntries", () => {
  it("skips duplicate content keys", () => {
    const a: ChangelogEntry = {
      id: "c1",
      timestamp: "2026-01-01T12:00:00.000Z",
      signal_type: "content",
      asset_type: "homepage",
      url: "https://x.com",
      asset_name: "Home",
      change_description: "d",
      topic_targeted: "t",
      city_targeted: null,
      hypothesis: null,
      expected_impact_window: null,
      brief_id: null,
      opportunity_id: null,
      notes: null,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      source_system: "x",
      import_batch_id: "b",
      tenant_id: "tenant-test",
    };
    const merged = mergeChangelogEntries([a], [a]);
    expect(merged).toHaveLength(1);
  });
});
