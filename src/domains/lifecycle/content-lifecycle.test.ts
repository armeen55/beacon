import { describe, expect, it } from "vitest";

import {
  classifyContentLifecycle,
  classifyMerge,
  classifyPage,
  looksLikePassedEvent,
  pathOf,
  MEANINGFUL_DEMAND_IMPRESSIONS_90D,
  PRUNE_MAX_IMPRESSIONS_90D,
  PRUNE_MAX_WORD_COUNT,
  RETIRE_MAX_IMPRESSIONS_90D,
  MERGE_MIN_OWNER_SHARE,
  RECENTLY_PUBLISHED_DAYS,
  type LifecyclePageInput,
  type LifecycleMergeConflict,
} from "./content-lifecycle";

const NOW = new Date("2026-07-03T00:00:00Z");

function page(over: Partial<LifecyclePageInput> = {}): LifecyclePageInput {
  return {
    url: "https://x.com/a",
    impressions90d: 0,
    clicks90d: 0,
    wordCount: 50,
    httpStatus: 200,
    inboundCount: 0,
    lastmod: null,
    title: "A page",
    h1: "A page",
    demandCollapsed: null,
    ...over,
  };
}

describe("pathOf", () => {
  it("returns the path without trailing slash", () => {
    expect(pathOf("https://x.com/iran-visa/")).toBe("/iran-visa");
    expect(pathOf("https://x.com/")).toBe("/");
    expect(pathOf("not a url")).toBe("not a url");
  });
});

describe("looksLikePassedEvent", () => {
  it("true when a year older than 2 years ago appears in title/h1/url", () => {
    expect(looksLikePassedEvent({ title: "Nowruz 2021 Guide", h1: null, url: "https://x.com/n" }, NOW)).toBe(true);
    expect(looksLikePassedEvent({ title: null, h1: null, url: "https://x.com/event-2019" }, NOW)).toBe(true);
  });
  it("false for the current or a future year", () => {
    expect(looksLikePassedEvent({ title: "Nowruz 2026", h1: null, url: "https://x.com/n" }, NOW)).toBe(false);
    expect(looksLikePassedEvent({ title: "Guide 2027", h1: null, url: "https://x.com/n" }, NOW)).toBe(false);
    // 2025 is within the 2-year lookback (not yet passed), so not a passed event.
    expect(looksLikePassedEvent({ title: "Report 2025", h1: null, url: "https://x.com/n" }, NOW)).toBe(false);
  });
  it("a current year wins even when an older year also appears", () => {
    expect(
      looksLikePassedEvent({ title: "Comparing 2019 and 2026", h1: null, url: "https://x.com/n" }, NOW),
    ).toBe(false);
  });
  it("false when no year appears at all", () => {
    expect(looksLikePassedEvent({ title: "Persian Cats", h1: "Cats", url: "https://x.com/cats" }, NOW)).toBe(false);
  });
});

describe("classifyPage - prune", () => {
  it("prunes a near-zero-demand, thin, unlinked, non-recent page", () => {
    const v = classifyPage(
      page({ url: "https://x.com/dead", impressions90d: 3, wordCount: 80, inboundCount: 0, lastmod: null }),
      NOW,
    );
    expect(v.stage).toBe("prune");
    expect(v.reason).toContain("/dead");
    expect(v.reason).toContain("3 times shown in 90 days");
    expect(v.reason).toContain("removing it or folding it");
    expect(v.reason).not.toMatch(/[—–]/);
    expect(v.reason.toLowerCase()).not.toContain("prune");
    expect(v.reason.toLowerCase()).not.toContain("orphan");
    expect(v.redirectTarget).toBeNull();
  });

  it("does NOT prune when SOMETHING links to it (inbound > 0) -> improve", () => {
    const v = classifyPage(page({ impressions90d: 3, wordCount: 80, inboundCount: 2 }), NOW);
    expect(v.stage).toBe("improve");
  });

  it("ABSTAINS from prune when the link graph is unusable (inboundCount null)", () => {
    const v = classifyPage(page({ impressions90d: 3, wordCount: 80, inboundCount: null }), NOW);
    expect(v.stage).not.toBe("prune");
  });

  it("does NOT prune a recently published thin page (protected)", () => {
    const recent = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
    const v = classifyPage(page({ impressions90d: 3, wordCount: 80, inboundCount: 0, lastmod: recent }), NOW);
    expect(v.stage).not.toBe("prune");
  });

  it("DOES prune a thin page whose lastmod is older than the recent window", () => {
    const old = new Date(NOW.getTime() - (RECENTLY_PUBLISHED_DAYS + 30) * 86_400_000).toISOString();
    const v = classifyPage(page({ impressions90d: 3, wordCount: 80, inboundCount: 0, lastmod: old }), NOW);
    expect(v.stage).toBe("prune");
  });

  it("does NOT prune a page at/over the thin word ceiling", () => {
    const v = classifyPage(page({ impressions90d: 3, wordCount: PRUNE_MAX_WORD_COUNT, inboundCount: 0 }), NOW);
    expect(v.stage).not.toBe("prune");
  });

  it("does NOT prune a page at the prune impressions ceiling (boundary)", () => {
    const v = classifyPage(page({ impressions90d: PRUNE_MAX_IMPRESSIONS_90D, wordCount: 80, inboundCount: 0 }), NOW);
    expect(v.stage).not.toBe("prune");
  });
});

describe("classifyPage - NEVER prune/retire with meaningful demand (pinned floor)", () => {
  it("keeps a page with meaningful demand even if thin, unlinked, dated", () => {
    const v = classifyPage(
      page({
        url: "https://x.com/nowruz-2019",
        impressions90d: MEANINGFUL_DEMAND_IMPRESSIONS_90D,
        wordCount: 10,
        inboundCount: 0,
        demandCollapsed: true,
        title: "Nowruz 2019",
      }),
      NOW,
    );
    expect(v.stage).toBe("keep");
    expect(v.reason).toBe("");
  });

  it("keeps a page with demand well above the floor", () => {
    const v = classifyPage(page({ impressions90d: 5000, wordCount: 5, inboundCount: 0 }), NOW);
    expect(v.stage).toBe("keep");
  });
});

describe("classifyPage - retire", () => {
  it("retires a passed dated event with near-zero demand", () => {
    const v = classifyPage(
      page({
        url: "https://x.com/nowruz-2020",
        impressions90d: 4,
        wordCount: 300,
        inboundCount: 5,
        title: "Nowruz 2020 Celebration",
        demandCollapsed: null,
      }),
      NOW,
    );
    expect(v.stage).toBe("retire");
    expect(v.reason).toContain("/nowruz-2020");
    expect(v.reason).toContain("already happened");
    expect(v.reason).toContain("current year");
    expect(v.reason).not.toMatch(/[—–]/);
    expect(v.reason.toLowerCase()).not.toContain("retire:");
  });

  it("retires a passed event that had demand but collapsed (still <= retire ceiling)", () => {
    const v = classifyPage(
      page({
        url: "https://x.com/conf-2021",
        impressions90d: RETIRE_MAX_IMPRESSIONS_90D,
        wordCount: 500,
        inboundCount: 3,
        title: "The 2021 Conference",
        demandCollapsed: true,
      }),
      NOW,
    );
    expect(v.stage).toBe("retire");
  });

  it("does NOT retire a passed event that still has demand over the retire ceiling but under meaningful floor without collapse", () => {
    // impressions between RETIRE ceiling and meaningful floor, no collapse signal.
    const v = classifyPage(
      page({
        url: "https://x.com/conf-2021",
        impressions90d: RETIRE_MAX_IMPRESSIONS_90D + 5,
        wordCount: 500,
        inboundCount: 3,
        title: "The 2021 Conference",
        demandCollapsed: false,
      }),
      NOW,
    );
    expect(v.stage).not.toBe("retire");
  });

  it("does NOT retire a current-year page even at near-zero demand", () => {
    const v = classifyPage(
      page({ impressions90d: 2, wordCount: 500, inboundCount: 3, title: "Nowruz 2026", demandCollapsed: true }),
      NOW,
    );
    expect(v.stage).not.toBe("retire");
  });

  it("prune wins over retire when a dated page is ALSO thin+unlinked", () => {
    // A dated, thin, unlinked, near-zero page qualifies for both; prune is
    // checked first (precedence).
    const v = classifyPage(
      page({
        url: "https://x.com/nowruz-2019",
        impressions90d: 3,
        wordCount: 50,
        inboundCount: 0,
        title: "Nowruz 2019",
        demandCollapsed: true,
      }),
      NOW,
    );
    expect(v.stage).toBe("prune");
  });
});

describe("classifyPage - dead pages belong to the status fix, not lifecycle", () => {
  it("keeps a 404 page here (bad_http_status owns it)", () => {
    const v = classifyPage(page({ impressions90d: 3, wordCount: 50, inboundCount: 0, httpStatus: 404 }), NOW);
    expect(v.stage).toBe("keep");
  });
});

describe("classifyMerge", () => {
  const conflict = (over: Partial<LifecycleMergeConflict> = {}): LifecycleMergeConflict => ({
    ownerUrl: "https://x.com/persian-cats",
    foldUrl: "https://x.com/persian-cat",
    ownerShare: 0.9,
    topicLabel: "persian cats",
    ...over,
  });

  it("emits a merge with a redirect target when the owner clearly dominates", () => {
    const v = classifyMerge(conflict({ ownerShare: 0.9 }));
    expect(v).not.toBeNull();
    expect(v!.stage).toBe("merge");
    expect(v!.url).toBe("https://x.com/persian-cat");
    expect(v!.redirectTarget).toBe("https://x.com/persian-cats");
    expect(v!.reason).toContain("/persian-cats");
    expect(v!.reason).toContain("/persian-cat");
    expect(v!.reason).toContain("90 percent");
    expect(v!.reason).toContain("redirect it");
    expect(v!.reason).not.toMatch(/[—–]/);
  });

  it("returns null when the split is too close (below the 5:1 dominance gate)", () => {
    // 0.7 owner => 0.7 / 0.3 ~= 2.3:1, below 5:1.
    expect(classifyMerge(conflict({ ownerShare: 0.7 }))).toBeNull();
  });

  it("fires exactly at the dominance boundary", () => {
    expect(classifyMerge(conflict({ ownerShare: MERGE_MIN_OWNER_SHARE }))).not.toBeNull();
    expect(classifyMerge(conflict({ ownerShare: MERGE_MIN_OWNER_SHARE - 0.001 }))).toBeNull();
  });

  it("returns null when owner and fold are the same page", () => {
    expect(classifyMerge(conflict({ foldUrl: "https://x.com/persian-cats" }))).toBeNull();
  });
});

describe("classifyContentLifecycle - engine + counts + byte-identical-when-empty", () => {
  it("empty pages in -> empty verdicts out (byte-identical)", () => {
    const r = classifyContentLifecycle({ pages: [], now: NOW });
    expect(r.verdicts).toEqual([]);
    expect(r.counts).toEqual({ keep: 0, improve: 0, merge: 0, prune: 0, retire: 0 });
  });

  it("classifies a mixed set and reconciles counts", () => {
    const r = classifyContentLifecycle({
      pages: [
        page({ url: "https://x.com/keep", impressions90d: 5000 }),
        page({ url: "https://x.com/prune", impressions90d: 2, wordCount: 40, inboundCount: 0 }),
        page({ url: "https://x.com/retire", impressions90d: 3, wordCount: 400, inboundCount: 2, title: "Fest 2019" }),
      ],
      now: NOW,
    });
    expect(r.counts.keep).toBe(1);
    expect(r.counts.prune).toBe(1);
    expect(r.counts.retire).toBe(1);
    // counts sum to the number of pages (no double counting).
    const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(3);
  });

  it("merge claims a folded page - it is never also single-page classified", () => {
    const r = classifyContentLifecycle({
      pages: [
        // This page would otherwise prune (thin/unlinked/near-zero), but a merge
        // folds it, and merge (which preserves value via redirect) wins.
        page({ url: "https://x.com/persian-cat", impressions90d: 2, wordCount: 40, inboundCount: 0 }),
      ],
      mergeConflicts: [
        {
          ownerUrl: "https://x.com/persian-cats",
          foldUrl: "https://x.com/persian-cat",
          ownerShare: 0.9,
          topicLabel: "persian cats",
        },
      ],
      now: NOW,
    });
    const forFold = r.verdicts.filter((v) => v.url === "https://x.com/persian-cat");
    expect(forFold).toHaveLength(1);
    expect(forFold[0]!.stage).toBe("merge");
    expect(r.counts.merge).toBe(1);
    expect(r.counts.prune).toBe(0);
  });

  it("de-duplicates two merge conflicts folding the same page into one card", () => {
    const r = classifyContentLifecycle({
      pages: [],
      mergeConflicts: [
        { ownerUrl: "https://x.com/a", foldUrl: "https://x.com/dup", ownerShare: 0.9, topicLabel: "t1" },
        { ownerUrl: "https://x.com/b", foldUrl: "https://x.com/dup", ownerShare: 0.95, topicLabel: "t2" },
      ],
      now: NOW,
    });
    expect(r.verdicts.filter((v) => v.stage === "merge")).toHaveLength(1);
  });
});
