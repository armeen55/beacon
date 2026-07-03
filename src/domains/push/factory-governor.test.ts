import { describe, it, expect } from "vitest";

import {
  governFactoryBatch,
  summarizeRefusals,
  countInWeekOf,
  countInMonthOf,
  mondayOfWeekUtc,
  MAX_NEW_PAGES_PER_WEEK,
  type GovernorCandidate,
} from "./factory-governor";

function cand(slug: string, title: string, over: Partial<GovernorCandidate> = {}): GovernorCandidate {
  return { slug, title, ...over };
}

const DISTINCT = [
  cand("haft-seen-symbols", "Haft Seen Symbols"),
  cand("yalda-night-customs", "Yalda Night Customs"),
  cand("chaharshanbe-suri-rituals", "Chaharshanbe Suri Rituals"),
  cand("tahdig-rice-crust", "Tahdig Rice Crust"),
  cand("ghormeh-sabzi-stew", "Ghormeh Sabzi Stew"),
  cand("fesenjan-walnut-pomegranate", "Fesenjan Walnut Pomegranate"),
];

const OPEN = { newPagesThisWeek: 0, newPagesThisMonth: 0, indexedPageCount: null };

describe("governFactoryBatch - weekly pace", () => {
  it("allows at most MAX_NEW_PAGES_PER_WEEK minus what the week already produced", () => {
    const r = governFactoryBatch({ candidates: DISTINCT, ...OPEN, newPagesThisWeek: 3 });
    expect(r.allowed).toHaveLength(MAX_NEW_PAGES_PER_WEEK - 3);
    expect(r.refusals).toHaveLength(DISTINCT.length - 2);
    for (const ref of r.refusals) {
      expect(ref.category).toBe("weekly_pace");
      expect(ref.plainReason).toContain("a steady pace beats a flood");
    }
  });

  it("boundary: exactly at the cap refuses everything; one below allows exactly one", () => {
    const atCap = governFactoryBatch({ candidates: DISTINCT, ...OPEN, newPagesThisWeek: MAX_NEW_PAGES_PER_WEEK });
    expect(atCap.allowed).toHaveLength(0);
    const oneLeft = governFactoryBatch({ candidates: DISTINCT, ...OPEN, newPagesThisWeek: MAX_NEW_PAGES_PER_WEEK - 1 });
    expect(oneLeft.allowed).toHaveLength(1);
    expect(oneLeft.allowed[0]!.slug).toBe("haft-seen-symbols"); // ranked order wins the slot
  });
});

describe("governFactoryBatch - info gain (N5)", () => {
  it("refuses duplicate_of_serp and thin_addition, passes adds_something and unchecked", () => {
    const r = governFactoryBatch({
      candidates: [
        cand("a-haft-seen", "Haft Seen Symbols", { infoGainVerdict: "duplicate_of_serp", infoGainSentence: "This would mostly repeat what wikipedia.org already says about Haft Seen." }),
        cand("b-yalda", "Yalda Night Customs", { infoGainVerdict: "thin_addition" }),
        cand("c-tahdig", "Tahdig Rice Crust", { infoGainVerdict: "adds_something" }),
        cand("d-fesenjan", "Fesenjan Walnut Pomegranate"),
      ],
      ...OPEN,
    });
    expect(r.allowed.map((c) => c.slug)).toEqual(["c-tahdig", "d-fesenjan"]);
    expect(r.refusals[0]!.plainReason).toBe("This would mostly repeat what wikipedia.org already says about Haft Seen.");
    expect(r.refusals[0]!.category).toBe("repeats_winners");
    expect(r.refusals[1]!.category).toBe("too_little_new");
    expect(r.refusals[1]!.plainReason).toContain("adds too little beyond what the winning pages already say");
  });
});

describe("governFactoryBatch - batch overlap", () => {
  it("refuses a second page on the SAME topic (token subset), names the clash", () => {
    const r = governFactoryBatch({
      candidates: [
        cand("nowruz-traditions", "Nowruz Traditions"),
        cand("nowruz-traditions-guide", "Nowruz Traditions Guide"),
      ],
      ...OPEN,
    });
    expect(r.allowed).toHaveLength(1);
    expect(r.refusals).toHaveLength(1);
    expect(r.refusals[0]!.category).toBe("overlaps_batch");
    expect(r.refusals[0]!.plainReason).toContain('covers the same ground as "Nowruz Traditions" in this batch');
  });

  it("allows sibling pages sharing ONE attribute word (entity-attribute batches live)", () => {
    const r = governFactoryBatch({
      candidates: [cand("tahdig-recipe", "Tahdig Recipe"), cand("ash-reshteh-recipe", "Ash Reshteh Recipe")],
      ...OPEN,
    });
    expect(r.allowed).toHaveLength(2);
    expect(r.refusals).toHaveLength(0);
  });
});

describe("governFactoryBatch - monthly growth ratio", () => {
  it("refuses pages past 10 percent of the indexed page count", () => {
    // 40 indexed pages -> monthly ceiling floor(4). 3 already this month -> 1 slot left.
    const r = governFactoryBatch({
      candidates: DISTINCT.slice(0, 3),
      newPagesThisWeek: 0,
      newPagesThisMonth: 3,
      indexedPageCount: 40,
    });
    expect(r.allowed).toHaveLength(1);
    expect(r.refusals).toHaveLength(2);
    for (const ref of r.refusals) {
      expect(ref.category).toBe("monthly_growth");
      expect(ref.plainReason).toContain("10 percent of your 40 indexed pages");
    }
  });

  it("skips the growth guard honestly when the page count is unknown or zero", () => {
    for (const indexedPageCount of [null, 0]) {
      const r = governFactoryBatch({
        candidates: DISTINCT.slice(0, 2),
        newPagesThisWeek: 0,
        newPagesThisMonth: 999,
        indexedPageCount,
      });
      expect(r.allowed).toHaveLength(2); // never block on missing data
    }
  });
});

describe("summary sentence", () => {
  it("builds the batch-card sentence from refusal categories", () => {
    const r = governFactoryBatch({
      candidates: [
        cand("a-haft-seen", "Haft Seen Symbols", { infoGainVerdict: "duplicate_of_serp" }),
        cand("b-yalda", "Yalda Night Customs", { infoGainVerdict: "thin_addition" }),
        cand("c-tahdig", "Tahdig Rice Crust"),
        cand("d-fesenjan", "Fesenjan Walnut Pomegranate"),
      ],
      newPagesThisWeek: 4,
      newPagesThisMonth: 4,
      indexedPageCount: null,
    });
    // a+b repeat winners; c fills the last weekly slot; d hits the pace cap.
    expect(r.summary).toBe(
      "I skipped three of four: two would repeat what the winners already say, one would push this week's new pages past a healthy pace.",
    );
  });

  it("is null when nothing was refused, and never carries an em or en dash", () => {
    expect(summarizeRefusals([], 5)).toBeNull();
    const r = governFactoryBatch({ candidates: DISTINCT, ...OPEN, newPagesThisWeek: 3, newPagesThisMonth: 0, indexedPageCount: 10 });
    for (const ref of r.refusals) expect(ref.plainReason).not.toMatch(/[–—]/);
    if (r.summary) expect(r.summary).not.toMatch(/[–—]/);
  });
});

describe("date-window counters", () => {
  it("mondayOfWeekUtc matches the production line's weekOf key", () => {
    expect(mondayOfWeekUtc(new Date("2026-07-08T12:00:00Z"))).toBe("2026-07-06");
    expect(mondayOfWeekUtc(new Date("2026-07-05T12:00:00Z"))).toBe("2026-06-29"); // Sunday belongs to the prior Monday week
  });

  it("countInWeekOf counts only the Monday-to-Sunday window around now", () => {
    const now = new Date("2026-07-08T12:00:00Z"); // week of 2026-07-06
    const dates = [
      "2026-07-06T00:00:00Z", // Monday boundary, in
      "2026-07-12T23:59:59Z", // Sunday, in
      "2026-07-13T00:00:00Z", // next Monday, out
      "2026-07-05T12:00:00Z", // prior Sunday, out
      "not-a-date",
      null,
    ];
    expect(countInWeekOf(dates, now)).toBe(2);
  });

  it("countInMonthOf counts only the UTC calendar month", () => {
    const now = new Date("2026-07-08T12:00:00Z");
    expect(countInMonthOf(["2026-07-01T00:00:00Z", "2026-07-31T23:59:00Z", "2026-06-30T23:59:00Z", "2025-07-10T00:00:00Z"], now)).toBe(2);
  });
});
