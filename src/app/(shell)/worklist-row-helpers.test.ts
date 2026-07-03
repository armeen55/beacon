/**
 * worklist-row-helpers (R23 P13) - unit pins for the four pure Changes-list helpers:
 * rank explanation, honest minute math, word-level diff, and not-now snooze durations.
 * These are the load-bearing logic; the component wiring is render-pinned in
 * worklist-row-render.test.tsx and source-pinned in changes-list-client-ux3.test.ts.
 */
import { describe, expect, it } from "vitest";
import { hasBannedDash } from "@/lib/copy/strip-dashes";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import {
  rankReasonAt,
  honestMinutesLabel,
  sessionMinutesLine,
  wordDiff,
  isDiffableFamily,
  resolveDiffPair,
  SNOOZE_DURATIONS,
  DEFAULT_SNOOZE_LABEL,
} from "./worklist-row-helpers";

// A minimal CanonicalChange factory - only the fields the helpers read.
function change(over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id: "t::/p::title",
    tenantId: "t",
    pagePath: "/p",
    pageUrl: "https://x/p",
    pageLabel: "Persian restaurants",
    opportunityType: "Capture clicks",
    changeType: "edit_title",
    changeFamily: "title",
    status: "suggested",
    recommendation: "Sharpen the title",
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "",
    estimatedEffortMinutes: 5,
    impactScore: 10,
    upside: null,
    expectedOutcome: null,
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "",
    selectedForToday: false,
    activeExperiment: false,
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: null,
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    sourceIds: [],
    alternateOpportunities: [],
    ...over,
  };
}

describe("rankReasonAt - one plain reason a row sits where it does", () => {
  it("names first + demand + winnability from move.demand", () => {
    const r = rankReasonAt(change({ evidenceStrength: "strong" }), { demand: 1200, demandBasis: "gsc" }, 1);
    expect(r).toBe("This is first because it has real demand (1.2k times shown on Google a month) and you can win it now.");
  });

  it("says 'near the top' for ranks 2-3 and 'on the list' beyond", () => {
    expect(rankReasonAt(change(), { demand: 1200 }, 2)).toContain("This is near the top because");
    expect(rankReasonAt(change(), { demand: 1200 }, 8)).toContain("This is on the list because");
  });

  it("uses AI mentions language when the demand basis is ai_attention", () => {
    const r = rankReasonAt(change(), { demand: 340, demandBasis: "ai_attention" }, 1);
    expect(r).toContain("340 AI mentions a month");
  });

  it("falls back to the change's own upside when the move carries no demand", () => {
    const r = rankReasonAt(change({ upside: 900 }), undefined, 1);
    expect(r).toContain("900 times shown on Google a month");
  });

  it("drops the winnability clause when the change is flagged", () => {
    const r = rankReasonAt(change({ qualityDecision: "flagged" }), { demand: 1200 }, 1);
    expect(r).not.toContain("you can win it now");
    expect(r).toContain("This is first because it has real demand");
  });

  it("self-hides (null) when there is no concrete number to stand on", () => {
    expect(rankReasonAt(change({ upside: null }), { demand: null }, 1)).toBeNull();
    expect(rankReasonAt(change({ upside: 0 }), undefined, 1)).toBeNull();
  });

  it("never emits a banned dash", () => {
    const r = rankReasonAt(change({ evidenceStrength: "strong" }), { demand: 12000 }, 1);
    expect(hasBannedDash(r)).toBe(false);
  });
});

describe("honestMinutesLabel - truthful bucket, no fake precision", () => {
  it("buckets a title tweak to about 5 minutes", () => {
    expect(honestMinutesLabel(change({ estimatedEffortMinutes: 5 }))).toBe("about 5 minutes");
    expect(honestMinutesLabel(change({ estimatedEffortMinutes: 1 }))).toBe("about 2 minutes");
  });

  it("buckets a new page to about an hour", () => {
    expect(honestMinutesLabel(change({ estimatedEffortMinutes: 60 }))).toBe("about an hour");
  });

  it("self-hides when there is no honest figure", () => {
    expect(honestMinutesLabel(change({ estimatedEffortMinutes: 0 }))).toBeNull();
    expect(honestMinutesLabel(change({ estimatedEffortMinutes: Number.NaN }))).toBeNull();
  });
});

describe("sessionMinutesLine - honest session total", () => {
  it("sums three 5-minute changes into 'about 15 minutes'", () => {
    const line = sessionMinutesLine([change(), change(), change()]);
    expect(line).toBe("Today's 3 changes: about 15 minutes.");
  });

  it("uses the 5-minute fallback for a change with no effort figure, matching the tonight budget", () => {
    const line = sessionMinutesLine([change({ estimatedEffortMinutes: Number.NaN })]);
    expect(line).toBe("Today's 1 change: about 5 minutes.");
  });

  it("rolls into hours past 60 minutes", () => {
    const line = sessionMinutesLine([change({ estimatedEffortMinutes: 60 }), change({ estimatedEffortMinutes: 30 })]);
    expect(line).toBe("Today's 2 changes: about 1 hour 30 minutes.");
  });

  it("returns null for an empty set and never emits a banned dash", () => {
    expect(sessionMinutesLine([])).toBeNull();
    expect(hasBannedDash(sessionMinutesLine([change(), change()]))).toBe(false);
  });
});

describe("wordDiff - deterministic word-level before -> after", () => {
  it("keeps unchanged words 'same', marks removed 'del' and added 'add'", () => {
    const segs = wordDiff("Best Persian food in LA", "Best Persian restaurants in LA");
    expect(segs).not.toBeNull();
    const dels = segs!.filter((s) => s.type === "del").map((s) => s.text.trim());
    const adds = segs!.filter((s) => s.type === "add").map((s) => s.text.trim());
    expect(dels).toContain("food");
    expect(adds).toContain("restaurants");
    // The reconstructed 'before' (same + del) and 'after' (same + add) round-trip exactly.
    expect(segs!.filter((s) => s.type !== "add").map((s) => s.text).join("")).toBe("Best Persian food in LA");
    expect(segs!.filter((s) => s.type !== "del").map((s) => s.text).join("")).toBe("Best Persian restaurants in LA");
  });

  it("is deterministic - identical inputs give identical output", () => {
    const a = wordDiff("one two three", "one four three");
    const b = wordDiff("one two three", "one four three");
    expect(a).toEqual(b);
  });

  it("returns a single all-added segment when there is no prior value", () => {
    expect(wordDiff("", "A brand new title")).toEqual([{ type: "add", text: "A brand new title" }]);
  });

  it("self-hides (null) for identical text or a missing proposed value", () => {
    expect(wordDiff("same", "same")).toBeNull();
    expect(wordDiff("something", "")).toBeNull();
    expect(wordDiff("something", null)).toBeNull();
  });

  it("merges adjacent runs of the same type so old words render as one run", () => {
    const segs = wordDiff("keep this old phrase here", "keep a fresh phrase here");
    const runs = segs!.map((s) => s.type);
    // No two adjacent segments share a type.
    for (let i = 1; i < runs.length; i++) expect(runs[i]).not.toBe(runs[i - 1]);
  });
});

describe("isDiffableFamily / resolveDiffPair - only edit rows diff", () => {
  it("diffs title/description/headline/answer, not new pages or links", () => {
    for (const f of ["title", "title_meta", "meta", "h1", "answer"]) expect(isDiffableFamily(f)).toBe(true);
    for (const f of ["new_page", "link", "schema", "cro", "other"]) expect(isDiffableFamily(f)).toBe(false);
  });

  it("prefers a prepared atomic title over the change's own after", () => {
    const pair = resolveDiffPair(
      change({ changeFamily: "title", before: "Old title", after: "Stale after" }),
      { preparedDraftKind: "atomic_edit", draftTitle: "New prepared title" },
    );
    expect(pair).toEqual({ before: "Old title", after: "New prepared title" });
  });

  it("self-hides for a non-diffable family or when there is no change to show", () => {
    expect(resolveDiffPair(change({ changeFamily: "new_page", before: "a", after: "b" }), undefined)).toBeNull();
    expect(resolveDiffPair(change({ changeFamily: "title", before: "same", after: "same" }), undefined)).toBeNull();
  });
});

describe("SNOOZE_DURATIONS - honest not-now framing, byte-identical default", () => {
  it("the default (index 0) is the honest 7-day 'in a week' label, matching the store's DEFER_DAYS", () => {
    expect(SNOOZE_DURATIONS[0]!.id).toBe("week");
    expect(DEFAULT_SNOOZE_LABEL).toBe("Not now: remind me in a week");
  });

  it("offers a small set of durations, each first-person and dash-free", () => {
    expect(SNOOZE_DURATIONS.length).toBeGreaterThanOrEqual(2);
    for (const d of SNOOZE_DURATIONS) {
      expect(d.label.startsWith("Not now: remind me")).toBe(true);
      expect(hasBannedDash(d.label)).toBe(false);
      expect(hasBannedDash(d.menuLabel)).toBe(false);
    }
  });
});
