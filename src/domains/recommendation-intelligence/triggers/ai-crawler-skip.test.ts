import { describe, expect, it } from "vitest";

import { aiCrawlerSkip } from "./ai-crawler-skip";
import type { CrawlerSkipGap } from "@/domains/aeo-traffic/load-crawler-skip-gaps";

const SIGNAL_AT = "2026-07-06T10:00:00Z";

function gap(over: Partial<CrawlerSkipGap> = {}): CrawlerSkipGap {
  return {
    path: "https://iranopedia.com/iran-visa",
    demand: 340,
    botHits: 0,
    crawledPageCount: 58,
    ...over,
  };
}

describe("aiCrawlerSkip", () => {
  it("emits an add_internal_link Move for a high-demand page AI crawlers skipped", () => {
    const rows = aiCrawlerSkip({ tenantId: "t", gaps: [gap()], signalAt: SIGNAL_AT });
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.trigger_signal).toBe("ai_crawler_skip");
    expect(r.action_type).toBe("add_internal_link");
    expect(r.target_url).toBe("https://iranopedia.com/iran-visa");
    expect(r.confidence).toBe("medium");
    expect(r.impact_estimate).toBe("high");
    expect(r.generator_kind).toBe("deterministic");
  });

  it("customer copy names AI assistants, the demand number, and the coverage number, with a next step", () => {
    const rows = aiCrawlerSkip({
      tenantId: "t",
      gaps: [gap({ path: "/iran-visa", demand: 340, crawledPageCount: 58 })],
      signalAt: SIGNAL_AT,
    });
    const copy = rows[0]!.customer_copy;
    expect(copy).toContain("AI assistants");
    expect(copy).toContain("/iran-visa");
    expect(copy).toContain("340");
    expect(copy).toContain("58");
    expect(copy).toContain("add links to it");
    // No lab jargon, no em/en dash, no dollar sign.
    expect(copy.toLowerCase()).not.toContain("crawler");
    expect(copy.toLowerCase()).not.toContain("bot");
    expect(copy.toLowerCase()).not.toContain("crawlability");
    expect(copy).not.toMatch(/[—–]/);
    expect(copy).not.toContain("$");
  });

  it("BYTE-IDENTICAL EMPTY: no gaps yields [] (empty crawler feed / all crawled)", () => {
    expect(aiCrawlerSkip({ tenantId: "t", gaps: [], signalAt: SIGNAL_AT })).toEqual([]);
  });

  it("ranks highest-demand first and caps emissions", () => {
    const gaps: CrawlerSkipGap[] = Array.from({ length: 8 }, (_, i) =>
      gap({ path: `https://x.com/p${i}`, demand: 200 + i }),
    );
    const rows = aiCrawlerSkip({ tenantId: "t", gaps, signalAt: SIGNAL_AT, maxEmissions: 3 });
    expect(rows).toHaveLength(3);
    // p7 has the most demand (200+7) -> first.
    expect(rows[0]!.target_url).toBe("https://x.com/p7");
    expect(rows[1]!.target_url).toBe("https://x.com/p6");
    expect(rows[2]!.target_url).toBe("https://x.com/p5");
  });

  it("collapses duplicate paths to one card", () => {
    const rows = aiCrawlerSkip({
      tenantId: "t",
      gaps: [gap({ path: "/dup", demand: 300 }), gap({ path: "/dup", demand: 300 })],
      signalAt: SIGNAL_AT,
    });
    expect(rows).toHaveLength(1);
  });

  it("uses the shared add_internal_link cooldown key so the loader can dedupe against buried_page / orphan_page", () => {
    const rows = aiCrawlerSkip({ tenantId: "t", gaps: [gap()], signalAt: SIGNAL_AT });
    expect(rows[0]!.cooldown_key).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0]!.dedupe_key).toMatch(/^[0-9a-f]{40}$/);
    // The topic cluster is "Internal linking" (same family as buried_page).
    expect(rows[0]!.topic_cluster_label).toBe("Internal linking");
  });

  it("operator evidence carries the raw signal trace (bot hits, demand, coverage)", () => {
    const rows = aiCrawlerSkip({
      tenantId: "t",
      gaps: [gap({ botHits: 0, demand: 340, crawledPageCount: 58 })],
      signalAt: SIGNAL_AT,
    });
    expect(rows[0]!.operator_evidence).toContain("signal=ai_crawler_skip");
    expect(rows[0]!.operator_evidence).toContain("bot_hits=0");
    expect(rows[0]!.operator_evidence).toContain("impressions_90d=340");
    expect(rows[0]!.operator_evidence).toContain("crawled_page_count=58");
  });
});
