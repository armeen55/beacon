import { describe, it, expect } from "vitest";

import { buildNativeCitationEvidenceIndex } from "@/domains/pages/citation-index";

const OWNED = {
  name: "Ritz Builders",
  domain: "ritzbuilders.com",
  is_owned: true,
  is_active: true,
};
const COMPETITOR = {
  name: "Homestead",
  domain: "homestead.com",
  is_owned: false,
  is_active: true,
};
const DIRECTORY = {
  name: "Houzz",
  domain: "houzz.com",
  is_owned: false,
  is_active: true,
};
const ENTITIES = [OWNED, COMPETITOR, DIRECTORY];

const BOUNDARY = "2026-04-22";

function obs(
  id: string,
  date: string,
  topic: string,
  platform: string,
  urls: string[],
) {
  return {
    id,
    prompt_id: `prompt-${id}`,
    observed_at: `${date}T12:00:00Z`,
    topic,
    platform,
    citation_urls: urls,
  };
}

describe("buildNativeCitationEvidenceIndex — dedup invariant", () => {
  it("invariant: duplicate URL inside one observation counts once per (page, topic)", () => {
    const observations = [
      obs(
        "obs-dup",
        "2026-04-23",
        "Best Modern Home Builder (Bay Area)",
        "perplexity",
        [
          "https://ritzbuilders.com/locations/palo-alto",
          "https://ritzbuilders.com/locations/palo-alto/",
          "https://ritzbuilders.com/locations/palo-alto?utm=x",
        ],
      ),
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    // Exactly one page+topic row for Ritz's palo-alto page.
    const paRows = index.by_page_and_topic.filter(
      (r) =>
        r.is_owned &&
        r.page_url.endsWith("/locations/palo-alto") &&
        r.topic === "Best Modern Home Builder (Bay Area)",
    );
    expect(paRows).toHaveLength(1);
    expect(paRows[0].total_citations).toBe(1);
    expect(paRows[0].distinct_answers).toBe(1);
    expect(index.total_citations_processed).toBe(1);
  });

  it("invariant: same URL in two DIFFERENT observations on the same day → count = 2", () => {
    const observations = [
      obs(
        "obs-A",
        "2026-04-23",
        "Best Modern Home Builder (Bay Area)",
        "perplexity",
        ["https://ritzbuilders.com/locations/palo-alto"],
      ),
      obs(
        "obs-B",
        "2026-04-23",
        "Best Modern Home Builder (Bay Area)",
        "chatgpt",
        ["https://ritzbuilders.com/locations/palo-alto/"],
      ),
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    const paRow = index.by_page_and_topic.find(
      (r) =>
        r.is_owned &&
        r.page_url.endsWith("/locations/palo-alto") &&
        r.topic === "Best Modern Home Builder (Bay Area)",
    );
    expect(paRow).toBeDefined();
    expect(paRow!.total_citations).toBe(2);
    expect(paRow!.distinct_answers).toBe(2);
    expect(paRow!.by_platform.perplexity?.citation_count).toBe(1);
    expect(paRow!.by_platform.chatgpt?.citation_count).toBe(1);
  });

  it("skips observations before NATIVE_REGIME_START", () => {
    const observations = [
      obs("obs-pre", "2026-04-21", "x", "perplexity", [
        "https://ritzbuilders.com/home",
      ]),
      obs("obs-post", "2026-04-22", "x", "perplexity", [
        "https://ritzbuilders.com/home",
      ]),
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    expect(index.total_citations_processed).toBe(1);
    // Only the post-boundary observation should appear.
    expect(index.by_page_and_topic).toHaveLength(1);
    expect(index.by_page_and_topic[0].first_observed_at).toMatch(/^2026-04-22/);
  });

  it("skips observations with null citation_urls (pre-Commit-7 rows)", () => {
    const observations = [
      {
        id: "obs-null",
        prompt_id: "p",
        observed_at: "2026-04-23T12:00:00Z",
        topic: "x",
        platform: "perplexity",
        citation_urls: null,
      },
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    expect(index.total_citations_processed).toBe(0);
    expect(index.by_page_and_topic).toHaveLength(0);
  });

  it("classifies owned/competitor/directory correctly in the topic summary", () => {
    const observations = [
      obs(
        "obs-mix",
        "2026-04-23",
        "Best Modern Home Builder (Bay Area)",
        "perplexity",
        [
          "https://ritzbuilders.com/home",
          "https://homestead.com/projects",
          "https://houzz.com/pro/homestead",
        ],
      ),
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    const topic = index.by_topic.find(
      (t) => t.topic === "Best Modern Home Builder (Bay Area)",
    );
    expect(topic).toBeDefined();
    expect(topic!.owned_citations).toBe(1);
    expect(topic!.competitor_citations).toBe(1);
    expect(topic!.directory_citations).toBe(1);
  });

  it("preserves citation_order as the 1-indexed position in citation_urls", () => {
    const observations = [
      obs("obs-order", "2026-04-23", "topic-A", "perplexity", [
        "https://homestead.com/a",
        "https://houzz.com/b",
        "https://ritzbuilders.com/home",
      ]),
    ];
    const index = buildNativeCitationEvidenceIndex({
      observations,
      entities: ENTITIES,
      nativeRegimeStart: BOUNDARY,
    });
    const ritzRow = index.by_page_and_topic.find((r) => r.is_owned);
    expect(ritzRow).toBeDefined();
    expect(ritzRow!.by_platform.perplexity?.avg_citation_order).toBe(3);
  });
});
