/**
 * rank-causes (2026-07-02, master plan item 53; revised 2026-07-09 for
 * operator spec B-10) - the diagnosis ranker matrix: noindex trumps
 * everything, recent-change proximity picks the closest change, and the
 * honest "no cause found" default when every source is empty. A sitewide
 * weather shock is NEVER a claimed per-item cause (never "algorithm_weather"
 * in `causes`, never the word "Google shift") - it surfaces only as
 * `weatherContext`, one shared hedge. The headline states the drop and stops;
 * it never repeats a cause sentence that also lives in `causes`. No-dash hard
 * rule pinned across every generated sentence.
 */
import { describe, expect, it } from "vitest";

import { rankCauses, CHANGE_PROXIMITY_DAYS, type InvestigationFindings } from "@/domains/investigation/rank-causes";

const COLLAPSE_DATE = "2026-06-20";

function baseFindings(over: Partial<InvestigationFindings> = {}): InvestigationFindings {
  return {
    familyLabel: "cheetah",
    collapseDate: COLLAPSE_DATE,
    clicksDropPct: -0.6,
    indexability: [],
    serp: [],
    recentChanges: [],
    weather: [],
    ...over,
  };
}

describe("rankCauses - noindex trumps all", () => {
  it("ranks a noindex finding first even with weather + recent changes also present", () => {
    const findings = baseFindings({
      indexability: [
        {
          url: "https://example.com/cheetah",
          noindexNow: true,
          badStatusNow: false,
          liveStatus: 200,
          blockedByRobots: false,
          canonicalMismatch: false,
          checkedAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      recentChanges: [
        { url: "https://example.com/cheetah", description: "meta description", pushedAt: "2026-06-19T00:00:00.000Z", daysBeforeCollapse: 1 },
      ],
      weather: [{ label: "a Google update", start: "2026-06-18", end: "2026-06-25", kind: "confirmed" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(true);
    expect(diagnosis.causes[0]!.kind).toBe("noindex");
    expect(diagnosis.causes[0]!.confidence).toBe("high");
    // B-10 (2026-07-09): the headline states only the drop; the cause lives
    // exactly once, in `causes`, never duplicated into the headline too.
    expect(diagnosis.headline).not.toContain("Most likely cause");
    expect(diagnosis.headline.toLowerCase()).not.toContain("noindex");
    expect(diagnosis.causes[0]!.sentence.toLowerCase()).toContain("noindex");
  });

  it("noindex outranks a bad status code on a different page in the same family", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah/b", noindexNow: false, badStatusNow: true, liveStatus: 500, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
        { url: "https://example.com/cheetah/a", noindexNow: true, badStatusNow: false, liveStatus: 200, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes[0]!.kind).toBe("noindex");
  });

  it("gives the noindex cause a concrete remove-the-tag action", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: true, badStatusNow: false, liveStatus: 200, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes[0]!.actionSentence).toMatch(/remove the noindex tag/i);
  });

  it("a page with a bad status and no noindex ranks bad_status, not noindex", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: false, badStatusNow: true, liveStatus: 404, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes[0]!.kind).toBe("bad_status");
    expect(diagnosis.causes[0]!.sentence).toContain("404");
  });
});

describe("rankCauses - weather is shared context, never a per-item cause (operator spec 2026-07-09 B-10)", () => {
  it("keeps a weather shock out of page-specific causes even alongside a structural break (noindex still wins)", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: true, badStatusNow: false, liveStatus: 200, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
      weather: [{ label: "the June 2026 Google core update", start: "2026-06-18", end: "2026-06-28", kind: "confirmed" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes).toHaveLength(1);
    expect(diagnosis.causes[0]!.kind).toBe("noindex");
    expect(diagnosis.weatherContext).not.toBeNull();
  });

  it("a weather shock alone (nothing else found) is NOT a claimed cause - hasCause stays false, headline states only the drop", () => {
    const findings = baseFindings({
      weather: [{ label: "a site-wide shift I detected", start: "2026-06-17", end: "2026-06-30", kind: "suspected" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(false);
    expect(diagnosis.causes).toEqual([]);
    expect(diagnosis.weatherContext).not.toBeNull();
    expect(diagnosis.weatherContext!.sentence).not.toMatch(/google shift/i);
    expect(diagnosis.weatherContext!.sentence).toContain("The whole site moved together");
    // no invented "most likely cause" narrative, no second copy of the same sentence
    expect(diagnosis.headline).not.toContain("Most likely cause");
    expect(diagnosis.headline).not.toContain(diagnosis.weatherContext!.sentence);
  });

  it("a confirmed update's window takes priority over a merely suspected one when both are passed", () => {
    const findings = baseFindings({
      weather: [
        { label: "a site-wide shift I detected", start: "2026-06-17", end: "2026-06-30", kind: "suspected" },
        { label: "the June 2026 core update", start: "2026-06-18", end: "2026-06-28", kind: "confirmed" },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.weatherContext!.windowStart).toBe("2026-06-18");
  });

  it("a genuine recent-change cause is unaffected by an overlapping weather shock (both surface, weather never joins causes)", () => {
    const findings = baseFindings({
      recentChanges: [{ url: "https://example.com/cheetah", description: "answer block", pushedAt: "2026-06-18T00:00:00.000Z", daysBeforeCollapse: 2 }],
      weather: [{ label: "a site-wide shift I detected", start: "2026-06-17", end: "2026-06-30", kind: "suspected" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes).toHaveLength(1);
    expect(diagnosis.causes[0]!.kind).toBe("recent_change");
    expect(diagnosis.weatherContext).not.toBeNull();
  });

  it("never states the same sentence twice: the headline and the top cause never repeat each other (operator: two render spots read the same field)", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: true, badStatusNow: false, liveStatus: 200, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.headline).not.toContain(diagnosis.causes[0]!.sentence);
    expect(diagnosis.headline).toMatch(/lost about 60 percent of its clicks starting/i);
  });
});

describe("rankCauses - recent-change proximity", () => {
  it("picks the CLOSEST change to the collapse date when several are in range", () => {
    const findings = baseFindings({
      recentChanges: [
        { url: "https://example.com/cheetah", description: "title tag", pushedAt: "2026-06-12T00:00:00.000Z", daysBeforeCollapse: 8 },
        { url: "https://example.com/cheetah", description: "meta description", pushedAt: "2026-06-19T00:00:00.000Z", daysBeforeCollapse: 1 },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes[0]!.kind).toBe("recent_change");
    expect(diagnosis.causes[0]!.sentence).toContain("meta description");
  });

  it(`ignores a change further back than CHANGE_PROXIMITY_DAYS (${CHANGE_PROXIMITY_DAYS} days)`, () => {
    const findings = baseFindings({
      recentChanges: [
        { url: "https://example.com/cheetah", description: "schema", pushedAt: "2026-05-01T00:00:00.000Z", daysBeforeCollapse: CHANGE_PROXIMITY_DAYS + 5 },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(false);
  });

  it("ignores a change that landed AFTER the collapse date (negative daysBeforeCollapse)", () => {
    const findings = baseFindings({
      recentChanges: [
        { url: "https://example.com/cheetah", description: "internal links", pushedAt: "2026-06-25T00:00:00.000Z", daysBeforeCollapse: -5 },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(false);
  });

  it("includes the plain-language day count and the shipped date in the sentence", () => {
    const findings = baseFindings({
      recentChanges: [
        { url: "https://example.com/cheetah", description: "meta description", pushedAt: "2026-06-19T00:00:00.000Z", daysBeforeCollapse: 1 },
      ],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.causes[0]!.sentence).toMatch(/the day before/i);
    expect(diagnosis.causes[0]!.actionSentence).toMatch(/meta description/);
  });
});

describe("rankCauses - SERP drop corroboration only", () => {
  it("ranks a SERP drop alone at low confidence, never above medium/high causes", () => {
    const findings = baseFindings({
      serp: [{ query: "cheetah speed", fromRank: 3, toRank: 9, direction: "down" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(true);
    expect(diagnosis.causes[0]!.kind).toBe("serp_drop");
    expect(diagnosis.causes[0]!.confidence).toBe("low");
  });

  it("a rank that moved up or stayed flat produces no SERP cause", () => {
    const findings = baseFindings({
      serp: [{ query: "cheetah speed", fromRank: 9, toRank: 3, direction: "up" }],
    });
    const diagnosis = rankCauses(findings);
    expect(diagnosis.hasCause).toBe(false);
  });
});

describe("rankCauses - no-cause-found honesty", () => {
  it("every source empty produces an honest no-cause diagnosis, not a guess", () => {
    const diagnosis = rankCauses(baseFindings());
    expect(diagnosis.hasCause).toBe(false);
    expect(diagnosis.causes).toEqual([]);
    expect(diagnosis.headline.toLowerCase()).toContain("no clear cause");
  });

  it("still names the family and the drop percentage in the honest headline", () => {
    const diagnosis = rankCauses(baseFindings({ clicksDropPct: -0.72 }));
    expect(diagnosis.headline).toContain("cheetah");
    expect(diagnosis.headline).toContain("72 percent");
  });

  it("handles a null clicksDropPct (sitewide-changepoint trigger) without crashing", () => {
    const diagnosis = rankCauses(baseFindings({ clicksDropPct: null }));
    expect(diagnosis.hasCause).toBe(false);
    expect(diagnosis.headline).toContain("cheetah");
  });
});

describe("rankCauses - copy hard rules", () => {
  it("never emits an em or en dash in any generated sentence", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: true, badStatusNow: false, liveStatus: 200, blockedByRobots: true, canonicalMismatch: true, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
      serp: [{ query: "cheetah speed", fromRank: 3, toRank: 9, direction: "down" }],
      recentChanges: [{ url: "https://example.com/cheetah", description: "meta description", pushedAt: "2026-06-19T00:00:00.000Z", daysBeforeCollapse: 1 }],
      weather: [{ label: "the June 2026 core update", start: "2026-06-18", end: "2026-06-28", kind: "confirmed" }],
    });
    const diagnosis = rankCauses(findings);
    const all = [
      diagnosis.headline,
      diagnosis.weatherContext?.sentence ?? "",
      ...diagnosis.causes.flatMap((c) => [c.sentence, c.actionSentence ?? ""]),
    ].join(" ");
    expect(all).not.toMatch(/[–—]/);
  });

  it("the no-cause headline also contains no dashes", () => {
    const diagnosis = rankCauses(baseFindings());
    expect(diagnosis.headline).not.toMatch(/[–—]/);
  });
});

describe("rankCauses - determinism", () => {
  it("same input twice produces byte-identical output", () => {
    const findings = baseFindings({
      indexability: [
        { url: "https://example.com/cheetah", noindexNow: false, badStatusNow: false, liveStatus: 200, blockedByRobots: false, canonicalMismatch: false, checkedAt: "2026-06-21T00:00:00.000Z" },
      ],
      recentChanges: [{ url: "https://example.com/cheetah", description: "title tag", pushedAt: "2026-06-19T00:00:00.000Z", daysBeforeCollapse: 1 }],
    });
    expect(rankCauses(findings)).toEqual(rankCauses(findings));
  });
});
