/**
 * Keyword-gap slice (2026-06-12) — trigger tests. Guide thresholds:
 * competitor top-10, KD ≤49, volume floor; capped; root-targeted
 * (queue rules forbid the needs_new_page sentinel for candidates).
 */

import { describe, expect, it } from "vitest";

import { semrushKeywordGap } from "@/domains/recommendation-intelligence/triggers/semrush-keyword-gap";

const gap = (over: Partial<{
  keyword: string;
  competitor_domain: string;
  competitor_position: number;
  volume: number;
  difficulty: number | null;
}> = {}) => ({
  keyword: "nowruz gifts",
  competitor_domain: "rival.com",
  competitor_position: 4,
  volume: 880,
  difficulty: 30,
  ...over,
});

describe("semrushKeywordGap", () => {
  it("emits a root-targeted create_page brief for an eligible gap", () => {
    const out = semrushKeywordGap({
      tenantId: "tenant-a",
      gaps: [gap()],
      siteRootUrl: "https://example.com/",
      signalAt: "2026-06-12T00:00:00Z",
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.trigger_signal).toBe("semrush_keyword_gap");
    expect(out[0]!.action_type).toBe("create_page");
    expect(out[0]!.target_url).toBe("https://example.com/");
    expect(out[0]!.topic_cluster_label).toBe("nowruz gifts");
    expect(out[0]!.customer_copy).toContain("nowruz gifts");
  });

  it("filters by the guide thresholds (position, difficulty, volume) and caps emissions", () => {
    const out = semrushKeywordGap({
      tenantId: "tenant-a",
      gaps: [
        gap({ keyword: "deep", competitor_position: 15 }),
        gap({ keyword: "hard", difficulty: 70 }),
        gap({ keyword: "thin", volume: 3 }),
        gap({ keyword: "a", volume: 900 }),
        gap({ keyword: "b", volume: 800 }),
        gap({ keyword: "c", volume: 700 }),
        gap({ keyword: "d", volume: 600 }),
      ],
      siteRootUrl: "https://example.com/",
      signalAt: "2026-06-12T00:00:00Z",
    });
    expect(out.map((c) => c.topic_cluster_label)).toEqual(["a", "b", "c"]);
  });
});

// ── Originality guard (audit #13, 2026-06-12) ─────────────────────────
import { findTopicalDuplicate } from "@/domains/recommendation-intelligence/triggers/semrush-keyword-gap";

describe("originality guard — expand existing pages instead of duplicating", () => {
  const gap = {
    keyword: "persian tea ceremony",
    competitor_domain: "rival.com",
    competitor_position: 4,
    volume: 500,
    difficulty: 20,
  };
  const base = {
    tenantId: "tenant-a",
    siteRootUrl: "https://iranopedia.com/",
    gaps: [gap],
    signalAt: "2026-06-12T00:00:00Z",
  };

  it("findTopicalDuplicate: full token containment in title+h1 matches; partial does not", () => {
    const pages = [
      { url: "https://iranopedia.com/tea", title: "The Persian Tea Ceremony Explained", h1: null },
      { url: "https://iranopedia.com/other", title: "Persian Poetry", h1: "Hafez" },
    ];
    expect(findTopicalDuplicate("persian tea ceremony", pages)?.url).toBe(
      "https://iranopedia.com/tea",
    );
    expect(findTopicalDuplicate("persian tea house design", pages)).toBeNull();
    expect(findTopicalDuplicate("", pages)).toBeNull();
  });

  it("flips to add_h2_section targeting the matched page when the topic is covered", () => {
    const out = semrushKeywordGap({
      ...base,
      existingPages: [
        { url: "https://iranopedia.com/tea", title: "Persian Tea Ceremony", h1: "Tea in Iran" },
      ],
    });
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.action_type).toBe("add_h2_section");
    expect(c.target_url).toBe("https://iranopedia.com/tea");
    expect(c.trigger_signal).toBe("semrush_keyword_gap");
    expect(c.operator_evidence).toContain("expand_existing_page");
    expect(c.operator_evidence).toContain("https://iranopedia.com/tea");
    expect(c.customer_copy).toContain("persian tea ceremony");
    expect(c.customer_copy).toContain("already have a page");
  });

  it("stays create_page when no existing page covers the topic (and without existingPages)", () => {
    const noMatch = semrushKeywordGap({
      ...base,
      existingPages: [
        { url: "https://iranopedia.com/poets", title: "Famous Iranian Poets", h1: null },
      ],
    });
    expect(noMatch[0]!.action_type).toBe("create_page");
    expect(noMatch[0]!.target_url).toBe("https://iranopedia.com/");

    const legacy = semrushKeywordGap(base);
    expect(legacy[0]!.action_type).toBe("create_page");
  });
});
