import { describe, it, expect } from "vitest";

import {
  computeCitationOutcome,
  citationLineFor,
  isCitationRelevantAction,
  matchCitationEvents,
  eventsInWindow,
  type CitationEvent,
  type CitationOutcomeInput,
  type CitationOutcome,
} from "./citation-outcome";

const ev = (date: string, over: Partial<CitationEvent> = {}): CitationEvent => ({
  date,
  platform: "chatgpt",
  promptText: null,
  count: 1,
  ...over,
});

const baseInput = (over: Partial<CitationOutcomeInput> = {}): CitationOutcomeInput => ({
  shippedAt: "2026-06-01",
  preWindowDays: 28,
  postWindowDays: 28,
  treatedPre: [],
  treatedPost: [],
  controls: [],
  sourceActiveInPre: true,
  sourceActiveInPost: true,
  ...over,
});

describe("computeCitationOutcome - insufficient_data honesty", () => {
  it("no post day elapsed yet is insufficient_data", () => {
    const out = computeCitationOutcome(
      baseInput({ postWindowDays: 0, treatedPre: [ev("2026-05-20")] }),
    );
    expect(out.verdict).toBe("insufficient_data");
  });

  it("an unmeasured post window is insufficient_data, never a fake loss", () => {
    const out = computeCitationOutcome(
      baseInput({
        sourceActiveInPost: false,
        treatedPre: [ev("2026-05-10"), ev("2026-05-12")],
      }),
    );
    expect(out.verdict).toBe("insufficient_data");
  });

  it("a page never observed in either window is insufficient_data (silent lane)", () => {
    const out = computeCitationOutcome(baseInput());
    expect(out.verdict).toBe("insufficient_data");
    expect(citationLineFor(out)).toBeNull();
  });

  it("cited post-ship but pre window unmeasured stays insufficient_data (no up-from-zero overclaim)", () => {
    const out = computeCitationOutcome(
      baseInput({
        sourceActiveInPre: false,
        treatedPost: [ev("2026-06-04"), ev("2026-06-06")],
      }),
    );
    expect(out.verdict).toBe("insufficient_data");
  });
});

describe("computeCitationOutcome - gained", () => {
  it("treated rose vs flat comparison pages: gained, with question names, first-citation day, sentence", () => {
    const out = computeCitationOutcome(
      baseInput({
        postWindowDays: 14, // scale = 0.5
        treatedPre: [ev("2026-05-20")],
        treatedPost: [
          ev("2026-06-12", { promptText: "best persian snacks" }),
          ev("2026-06-13", { promptText: "iranian sweets guide" }),
          ev("2026-06-14", { promptText: "Best Persian Snacks" }), // dup question, different case
        ],
        controls: [{ pre: [ev("2026-05-18")], post: [ev("2026-06-10")] }],
      }),
    );
    expect(out.verdict).toBe("gained");
    expect(out.treatedPreCount).toBe(1);
    expect(out.treatedPostCount).toBe(3);
    expect(out.daysToFirstCitation).toBe(11);
    expect(out.promptsNowCiting).toEqual(["best persian snacks", "iranian sweets guide"]);
    expect(out.sentence).toBe(
      "AI now recommends this page on 2 of the questions I check, starting 11 days after the change.",
    );
    expect(citationLineFor(out)).toBe(out.sentence);
  });

  it("same-day first citation reads plainly and daysToFirstCitation is 0", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPost: [
          ev("2026-06-01", { promptText: "kebab guide" }),
          ev("2026-06-03", { promptText: "kebab history" }),
        ],
      }),
    );
    expect(out.verdict).toBe("gained");
    expect(out.daysToFirstCitation).toBe(0);
    expect(out.sentence).toContain("starting the same day it shipped");
  });

  it("a single post-ship answer is an early signal, said plainly", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPost: [ev("2026-06-04", { promptText: "saffron rice recipe" })],
      }),
    );
    expect(out.verdict).toBe("gained");
    expect(out.sentence).toContain("1 of the questions I check");
    expect(out.sentence).toContain("One answer so far, I am watching for repeats.");
  });

  it("import-only evidence (no question identity) reports the count movement", () => {
    const out = computeCitationOutcome(
      baseInput({
        postWindowDays: 14,
        treatedPost: [ev("2026-06-05", { promptText: null, count: 2 })],
      }),
    );
    expect(out.verdict).toBe("gained");
    expect(out.promptsNowCiting).toEqual([]);
    expect(out.sentence).toBe(
      "AI answers mention this page more since the change: 2 mentions in the 14 days after, up from none in a typical stretch that long before.",
    );
  });
});

describe("computeCitationOutcome - comparison-page adjustment", () => {
  it("tide-lifted: treated rose but comparison pages rose about as much, so no credit", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-10")],
        treatedPost: [ev("2026-06-05"), ev("2026-06-07"), ev("2026-06-09")],
        controls: [
          { pre: [], post: [ev("2026-06-06"), ev("2026-06-08")] },
          { pre: [], post: [ev("2026-06-06"), ev("2026-06-10")] },
        ],
      }),
    );
    expect(out.verdict).toBe("no_change");
    expect(out.tideLifted).toBe(true);
    expect(out.controlDelta).toBe(2);
    expect(out.sentence).toContain("similar pages I did not touch rose about as much");
  });

  it("lost: dropped in raw terms AND versus comparison pages", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-08"), ev("2026-05-12"), ev("2026-05-20"), ev("2026-05-25")],
        treatedPost: [],
        controls: [{ pre: [ev("2026-05-10"), ev("2026-05-15")], post: [ev("2026-06-05"), ev("2026-06-09")] }],
      }),
    );
    expect(out.verdict).toBe("lost");
    expect(out.sentence).toBe(
      "AI answers mentioned this page 4 times in the 28 days before the change but none since. I am watching to see if it comes back.",
    );
  });

  it("tide receded: treated dropped but comparison pages dropped about as much, so no blame", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-08"), ev("2026-05-12"), ev("2026-05-20")],
        treatedPost: [],
        controls: [
          { pre: [ev("2026-05-09"), ev("2026-05-13"), ev("2026-05-21")], post: [] },
        ],
      }),
    );
    expect(out.verdict).toBe("no_change");
    expect(out.sentence).toContain("dipped about as much, so I am not blaming this change");
  });

  it("comparison pages with no events contribute a zero adjustment, not a skew", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPost: [ev("2026-06-03", { promptText: "q1" }), ev("2026-06-05", { promptText: "q2" })],
        controls: [
          { pre: [], post: [] },
          { pre: [], post: [] },
        ],
      }),
    );
    expect(out.controlDelta).toBe(0);
    expect(out.verdict).toBe("gained");
  });
});

describe("computeCitationOutcome - sparse data + pro-rating", () => {
  it("pro-rates the 28d pre window to a 7d post window (a steady page is no_change, not lost)", () => {
    const out = computeCitationOutcome(
      baseInput({
        postWindowDays: 7, // scale = 0.25
        treatedPre: [ev("2026-05-08"), ev("2026-05-14"), ev("2026-05-20"), ev("2026-05-27")],
        treatedPost: [ev("2026-06-03")],
      }),
    );
    // 4 pre citations pro-rate to 1 for a 7-day stretch; 1 post citation = steady.
    expect(out.verdict).toBe("no_change");
    expect(out.sentence).toContain("look about the same");
  });

  it("clamps negative event counts to zero", () => {
    const out = computeCitationOutcome(
      baseInput({
        treatedPost: [ev("2026-06-03", { count: -5 }), ev("2026-06-04", { count: 2, promptText: "q" })],
      }),
    );
    expect(out.treatedPostCount).toBe(2);
  });

  it("daysToFirstCitation is null when nothing cited the page post-ship", () => {
    const out = computeCitationOutcome(baseInput({ treatedPre: [ev("2026-05-20")] }));
    expect(out.daysToFirstCitation).toBeNull();
  });
});

describe("citationLineFor - the silence gate", () => {
  it("is silent for a missing outcome", () => {
    expect(citationLineFor(null)).toBeNull();
    expect(citationLineFor(undefined)).toBeNull();
  });

  it("is silent for insufficient_data", () => {
    const out = computeCitationOutcome(baseInput({ postWindowDays: 0 }));
    expect(citationLineFor(out)).toBeNull();
  });

  it("passes the sentence through for a judged outcome", () => {
    const out = computeCitationOutcome(
      baseInput({ treatedPost: [ev("2026-06-03", { promptText: "q" }), ev("2026-06-05", { promptText: "r" })] }),
    );
    expect(citationLineFor(out)).toBe(out.sentence);
  });
});

describe("isCitationRelevantAction", () => {
  it("matches the answer-block / FAQ / new-page / schema families, case-insensitively", () => {
    for (const a of [
      "add_answer_block",
      "answer_block",
      "intro_answer_block",
      "add_faq",
      "faq",
      "create_page",
      "add_schema",
      "fix_schema",
      "schema",
      "ADD_FAQ",
    ]) {
      expect(isCitationRelevantAction(a), a).toBe(true);
    }
  });

  it("leaves CTR/rank plays to the Search verdict alone", () => {
    for (const a of ["edit_title", "edit_meta", "change_h1", "internal_link", "section_reorder", "", "unknown"]) {
      expect(isCitationRelevantAction(a), a || "(empty)").toBe(false);
    }
  });
});

describe("matchCitationEvents - canonical URL joining", () => {
  const PAGE = "https://iranopedia.com/persian-snacks";

  it("matches www / trailing-slash / query / http variants and dedupes within one answer", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [
        {
          prompt_id: "p1",
          observed_at: "2026-06-03T04:00:00Z",
          platform: "ChatGPT",
          citation_urls: [
            "https://www.iranopedia.com/persian-snacks/",
            "https://iranopedia.com/persian-snacks?utm_source=x",
            "http://iranopedia.com/persian-snacks#top",
            "https://iranopedia.com/other-page",
          ],
        },
      ],
      importedRows: [],
      promptTextById: new Map([["p1", "best persian snacks"]]),
    });
    const got = events.get(PAGE)!;
    expect(got).toHaveLength(1); // per-answer dedupe: 3 variants = ONE event
    expect(got[0]).toEqual({
      date: "2026-06-03",
      platform: "chatgpt",
      promptText: "best persian snacks",
      count: 1,
    });
  });

  it("never credits an external lookalike path on another host", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [
        {
          prompt_id: "p1",
          observed_at: "2026-06-03T04:00:00Z",
          platform: "perplexity",
          citation_urls: ["https://wikipedia.org/persian-snacks"],
        },
      ],
      importedRows: [{ date: "2026-06-04", model: "gpt-4o", url: "https://competitor.com/persian-snacks", citation_count: 5 }],
    });
    expect(events.get(PAGE)).toEqual([]);
  });

  it("keeps per-engine rows (gemini/claude) - the join is platform-agnostic", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [
        { prompt_id: "p1", observed_at: "2026-06-03T04:00:00Z", platform: "gemini", citation_urls: [PAGE] },
        { prompt_id: "p2", observed_at: "2026-06-04T04:00:00Z", platform: "claude", citation_urls: [`${PAGE}/`] },
      ],
      importedRows: [],
    });
    expect(events.get(PAGE)!.map((e) => e.platform).sort()).toEqual(["claude", "gemini"]);
  });

  it("matches scheme-less imported URLs and rounds fractional shares up to one presence event (real prod shape)", () => {
    // 2026-07-02 probe: profound_citation_rows stores "iranopedia.com/appetizers"
    // (no scheme) with a fractional citation share (0.0007) - both must still join.
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [],
      importedRows: [
        { date: "2026-06-23", model: "ChatGPT", url: "iranopedia.com/persian-snacks", citation_count: 0.000675 },
        { date: "2026-06-26", model: "Google Gemini", url: "www.iranopedia.com/persian-snacks/", citation_count: 0.0666 },
      ],
    });
    const got = events.get(PAGE)!;
    expect(got).toHaveLength(2);
    expect(got.every((e) => e.count === 1)).toBe(true);
  });

  it("a bare path never matches via the loose canonicalizer (still no cross-host credit)", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [],
      importedRows: [{ date: "2026-06-23", model: "m", url: "/persian-snacks", citation_count: 0.5 }],
    });
    expect(events.get(PAGE)).toEqual([]);
  });

  it("maps imported day-count rows (count kept, no question identity) and drops zero counts", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [],
      importedRows: [
        { date: "2026-06-05", model: "Perplexity", url: `http://www.iranopedia.com/persian-snacks/`, citation_count: 3 },
        { date: "2026-06-06", model: null, url: PAGE, citation_count: 0 },
      ],
    });
    const got = events.get(PAGE)!;
    expect(got).toHaveLength(1);
    expect(got[0]).toEqual({ date: "2026-06-05", platform: "Perplexity", promptText: null, count: 3 });
  });

  it("a missing prompt text degrades to null (import-style sentence downstream), never throws", () => {
    const events = matchCitationEvents({
      pages: [PAGE],
      observations: [
        { prompt_id: "unknown-prompt", observed_at: "2026-06-03T04:00:00Z", platform: "chatgpt", citation_urls: [PAGE] },
      ],
      importedRows: [],
      promptTextById: new Map(),
    });
    expect(events.get(PAGE)![0]!.promptText).toBeNull();
  });

  it("a bare-path page cannot canonicalize and matches nothing (strict, honest silence)", () => {
    const events = matchCitationEvents({
      pages: ["/persian-snacks"],
      observations: [
        { prompt_id: "p1", observed_at: "2026-06-03T04:00:00Z", platform: "chatgpt", citation_urls: [PAGE] },
      ],
      importedRows: [{ date: "2026-06-05", model: "m", url: PAGE, citation_count: 2 }],
    });
    expect(events.get("/persian-snacks")).toEqual([]);
  });

  it("returns an (empty) entry for every page passed in, including comparison pages", () => {
    const events = matchCitationEvents({
      pages: [PAGE, "https://iranopedia.com/tehran-guide"],
      observations: [],
      importedRows: [],
    });
    expect([...events.keys()]).toEqual([PAGE, "https://iranopedia.com/tehran-guide"]);
  });
});

describe("eventsInWindow", () => {
  it("keeps start <= date < end", () => {
    const all = [ev("2026-05-31"), ev("2026-06-01"), ev("2026-06-14"), ev("2026-06-15")];
    expect(eventsInWindow(all, "2026-06-01", "2026-06-15").map((e) => e.date)).toEqual([
      "2026-06-01",
      "2026-06-14",
    ]);
  });
});

describe("copy guard - plain first-person business language, no em or en dashes", () => {
  /** Every reachable verdict/sentence shape. */
  const OUTCOMES: CitationOutcome[] = [
    computeCitationOutcome(baseInput({ postWindowDays: 0 })),
    computeCitationOutcome(baseInput({ sourceActiveInPost: false, treatedPre: [ev("2026-05-10")] })),
    computeCitationOutcome(baseInput()),
    computeCitationOutcome(baseInput({ sourceActiveInPre: false, treatedPost: [ev("2026-06-04")] })),
    computeCitationOutcome(
      baseInput({ treatedPost: [ev("2026-06-04", { promptText: "q1" }), ev("2026-06-06", { promptText: "q2" })] }),
    ),
    computeCitationOutcome(baseInput({ treatedPost: [ev("2026-06-04", { promptText: "q1" })] })),
    computeCitationOutcome(baseInput({ postWindowDays: 14, treatedPost: [ev("2026-06-05", { count: 2 })] })),
    computeCitationOutcome(baseInput({ postWindowDays: 14, treatedPost: [ev("2026-06-05")] })),
    computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-10")],
        treatedPost: [ev("2026-06-05"), ev("2026-06-07"), ev("2026-06-09")],
        controls: [
          { pre: [], post: [ev("2026-06-06"), ev("2026-06-08")] },
          { pre: [], post: [ev("2026-06-06"), ev("2026-06-10")] },
        ],
      }),
    ),
    computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-08"), ev("2026-05-12"), ev("2026-05-20"), ev("2026-05-25")],
        treatedPost: [],
      }),
    ),
    computeCitationOutcome(
      baseInput({
        treatedPre: [ev("2026-05-08"), ev("2026-05-12"), ev("2026-05-20")],
        treatedPost: [],
        controls: [{ pre: [ev("2026-05-09"), ev("2026-05-13"), ev("2026-05-21")], post: [] }],
      }),
    ),
    computeCitationOutcome(baseInput({ treatedPre: [ev("2026-05-20")], treatedPost: [ev("2026-06-04")] })),
  ];

  it("covers every verdict", () => {
    const verdicts = new Set(OUTCOMES.map((o) => o.verdict));
    expect(verdicts).toEqual(new Set(["gained", "lost", "no_change", "insufficient_data"]));
  });

  it("no sentence contains an em or en dash", () => {
    for (const o of OUTCOMES) {
      expect(o.sentence, o.sentence).not.toMatch(/[–—]/);
    }
  });

  it("no sentence leaks a lab word", () => {
    const banned = /\b(baselines?|treatments?|reservations?|experiments?|controls?|SERP)\b/i;
    for (const o of OUTCOMES) {
      expect(o.sentence, o.sentence).not.toMatch(banned);
    }
  });
});
