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
