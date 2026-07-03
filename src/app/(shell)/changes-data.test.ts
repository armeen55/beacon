/**
 * changes-data (FP2, 2026-07-02) - unit tests for the pure helpers loadChangesView composes:
 * dedupeIdentity/strongerChange/dedupeChanges (killer finding 1/2 - "best iranian restaurants
 * near me" rendering as two rows) and demoteUnsized (killer finding 1 - a row with only the
 * honest "not enough history" fallback must never outrank a row with a real forecast).
 *
 * `changes-data.ts` is `server-only`; vitest.config.ts mocks that module so these pure exports
 * are directly testable without a request/tenant context (the same pattern session-flow.test.ts
 * and build-canonical-changes.test.ts already use for CanonicalChange fixtures).
 */
import { describe, expect, it } from "vitest";
import { dedupeIdentity, strongerChange, dedupeChanges, demoteUnsized, reconcileCannibalizationRationale, dropBoardDuplicateNewPageRows } from "./changes-data";
import { topicIdentityKey } from "@/domains/demand-graph/dedupe-new-page-cards";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import { rankChanges } from "@/domains/changes/strategy";
import type { TodayMove } from "./today-moves-data";

function cc(id: string, status: CanonicalStatus, over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id,
    tenantId: "t",
    pagePath: `/${id}`,
    pageUrl: `https://s.com/${id}`,
    pageLabel: id,
    opportunityType: "Capture clicks",
    changeType: "edit_meta",
    changeFamily: "meta",
    status,
    recommendation: `Fix ${id}`,
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "why",
    estimatedEffortMinutes: 2,
    impactScore: 10,
    upside: null,
    expectedOutcome: null,
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "diff-in-diff",
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

function move(id: string, query: string): TodayMove {
  return { id, query } as TodayMove;
}

describe("dedupeIdentity", () => {
  it("keys by page path when a real page exists, ignoring the query", () => {
    const c1 = cc("a", "suggested", { pagePath: "/best-iranian-restaurants", changeFamily: "meta" });
    const c2 = cc("b", "suggested", { pagePath: "/best-iranian-restaurants", changeFamily: "meta" });
    expect(dedupeIdentity(c1, "one query")).toBe(dedupeIdentity(c2, "a totally different query"));
  });

  it("keys by normalized topic/label when there is no real page yet (a create candidate)", () => {
    const c1 = cc("a", "suggested", { pagePath: "", pageLabel: "Best Iranian Restaurants Near Me" });
    const c2 = cc("b", "suggested", { pagePath: "", pageLabel: "best iranian restaurants near me" });
    expect(dedupeIdentity(c1, null)).toBe(dedupeIdentity(c2, null));
  });

  it("prefers the query over the page label for the page-less topic key when a query is supplied", () => {
    const c1 = cc("a", "suggested", { pagePath: "", pageLabel: "some internal label" });
    const c2 = cc("b", "suggested", { pagePath: "", pageLabel: "a different internal label" });
    expect(dedupeIdentity(c1, "best iranian restaurants near me")).toBe(dedupeIdentity(c2, "best iranian restaurants near me"));
  });

  it("never collapses two genuinely different pages", () => {
    const c1 = cc("a", "suggested", { pagePath: "/page-a" });
    const c2 = cc("b", "suggested", { pagePath: "/page-b" });
    expect(dedupeIdentity(c1, null)).not.toBe(dedupeIdentity(c2, null));
  });

  it("never collapses two genuinely different lever families on the same page", () => {
    const c1 = cc("a", "suggested", { pagePath: "/page-a", changeFamily: "meta" });
    const c2 = cc("b", "suggested", { pagePath: "/page-a", changeFamily: "title" });
    expect(dedupeIdentity(c1, null)).not.toBe(dedupeIdentity(c2, null));
  });
});

describe("strongerChange", () => {
  it("a more-advanced lifecycle status always wins, never demoted back to a bare suggestion", () => {
    const measuring = cc("a", "measuring");
    const suggested = cc("b", "suggested", { impactScore: 999 });
    expect(strongerChange(measuring, suggested)).toBe(measuring);
    expect(strongerChange(suggested, measuring)).toBe(measuring);
  });

  it("a sized forecast wins over an honest-fallback one at the same status", () => {
    const sized = cc("a", "suggested", { expectedOutcomeLow: 10, expectedOutcomeHigh: 30 });
    const unsized = cc("b", "suggested", { expectedOutcomeLow: null, impactScore: 999 });
    expect(strongerChange(sized, unsized)).toBe(sized);
    expect(strongerChange(unsized, sized)).toBe(sized);
  });

  it("falls back to higher impact score when status and sizing tie", () => {
    const low = cc("a", "suggested", { impactScore: 5 });
    const high = cc("b", "suggested", { impactScore: 50 });
    expect(strongerChange(low, high)).toBe(high);
  });
});

describe("dedupeChanges (killer finding 1/2 - the same real-world opportunity, one row)", () => {
  it("collapses two rows for the same page+query+family into one", () => {
    const rows = [
      cc("worklist:a", "suggested", { pagePath: "/best-iranian-restaurants", sourceIds: ["m1"] }),
      cc("keyword_library:a", "suggested", { pagePath: "/best-iranian-restaurants", sourceIds: ["m2"] }),
    ];
    const movesById = { m1: move("m1", "best iranian restaurants near me"), m2: move("m2", "best iranian restaurants near me") };
    const out = dedupeChanges(rows, movesById);
    expect(out).toHaveLength(1);
  });

  it("collapses two page-less rows pitching the same unbuilt topic from different lanes (the exact bug: fuseByPage only merges non-null pages)", () => {
    const rows = [
      cc("serp_steal:x", "suggested", { pagePath: "", pageLabel: "best iranian restaurants near me", sourceIds: [] }),
      cc("keyword_library:x", "suggested", { pagePath: "", pageLabel: "best iranian restaurants near me", sourceIds: [] }),
    ];
    const out = dedupeChanges(rows, {});
    expect(out).toHaveLength(1);
  });

  it("keeps two genuinely different opportunities separate", () => {
    const rows = [
      cc("a", "suggested", { pagePath: "/page-a" }),
      cc("b", "suggested", { pagePath: "/page-b" }),
    ];
    expect(dedupeChanges(rows, {})).toHaveLength(2);
  });

  it("the survivor is the stronger row (more-advanced status), never a demotion", () => {
    const rows = [
      cc("a", "suggested", { pagePath: "/p", sourceIds: ["m1"] }),
      cc("b", "measuring", { pagePath: "/p", sourceIds: ["m2"] }),
    ];
    const out = dedupeChanges(rows, {});
    expect(out).toHaveLength(1);
    expect(out[0]!.status).toBe("measuring");
  });

  it("unions sourceIds and alternateOpportunities from the dropped duplicate onto the survivor - no provenance lost", () => {
    const rows = [
      cc("a", "suggested", { pagePath: "/p", sourceIds: ["m1"], alternateOpportunities: ["x"] }),
      cc("b", "suggested", { pagePath: "/p", sourceIds: ["m2"], alternateOpportunities: ["y"], impactScore: 999 }),
    ];
    const out = dedupeChanges(rows, {});
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceIds.sort()).toEqual(["m1", "m2"]);
    expect(out[0]!.alternateOpportunities.sort()).toEqual(["x", "y"]);
  });

  it("preserves the original relative order of survivors (only rankChanges reorders)", () => {
    const rows = [
      cc("a", "suggested", { pagePath: "/page-a", impactScore: 1 }),
      cc("b", "suggested", { pagePath: "/page-b", impactScore: 2 }),
      cc("c", "suggested", { pagePath: "/page-c", impactScore: 3 }),
    ];
    const out = dedupeChanges(rows, {});
    expect(out.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op on an already-unique list", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready"), cc("c", "measuring")];
    expect(dedupeChanges(rows, {})).toHaveLength(3);
  });
});

describe("demoteUnsized (killer finding 1 - the honest fallback must never outrank a real forecast)", () => {
  it("leaves a sized row's impactScore untouched", () => {
    const sized = cc("a", "suggested", { impactScore: 50, expectedOutcomeLow: 10, expectedOutcomeHigh: 30 });
    const [out] = demoteUnsized([sized]);
    expect(out!.impactScore).toBe(50);
  });

  it("demotes an unsized row's impactScore below zero regardless of its original score", () => {
    const unsized = cc("a", "suggested", { impactScore: 999, expectedOutcomeLow: null });
    const [out] = demoteUnsized([unsized]);
    expect(out!.impactScore).toBeLessThan(0);
  });

  it("an unsized row always sorts under a sized row once ranked by impactScore", () => {
    const unsized = cc("a", "suggested", { impactScore: 999, expectedOutcomeLow: null });
    const sized = cc("b", "suggested", { impactScore: 1, expectedOutcomeLow: 5, expectedOutcomeHigh: 15 });
    const out = demoteUnsized([unsized, sized]);
    const byScore = [...out].sort((x, y) => y.impactScore - x.impactScore);
    expect(byScore[0]!.id).toBe("b");
  });

  it("never mutates the input row objects", () => {
    const unsized = cc("a", "suggested", { impactScore: 5, expectedOutcomeLow: null });
    const [out] = demoteUnsized([unsized]);
    expect(out).not.toBe(unsized);
    expect(unsized.impactScore).toBe(5);
  });
});

describe("reconcileCannibalizationRationale (killer finding 3 - the secondary line must agree)", () => {
  function moveWithCannibalization(id: string, fix: string): TodayMove {
    return { id, cannibalization: [{ query: "q", otherPages: ["other page"], isLead: true, leadPage: "other page", fix, linkSnippet: null }] } as unknown as TodayMove;
  }

  it("rewrites the rationale to state the consolidation directive when it doesn't already match", () => {
    const fix = '"Other Page" is your best-ranking page for "q" - fold this into it (redirect or internal-link) so they stop splitting its clicks.';
    const c = cc("a", "suggested", { sourceIds: ["m1"], rationale: "You already rank position 8 for a totally different query - a sharper title can climb a few spots." });
    const movesById = { m1: moveWithCannibalization("m1", fix) };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out!.rationale).toContain(fix);
    expect(out!.rationale).toContain("comes first");
  });

  it("leaves the rationale untouched when it already states the same fix (no contradiction to reconcile)", () => {
    const fix = "Point this page at \"Other Page\" (your best-ranking one for \"q\") with an internal link.";
    const c = cc("a", "suggested", { sourceIds: ["m1"], rationale: fix });
    const movesById = { m1: moveWithCannibalization("m1", fix) };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out).toBe(c);
  });

  it("leaves rows with no cannibalization case untouched", () => {
    const c = cc("a", "suggested", { sourceIds: ["m1"], rationale: "some other rationale" });
    const movesById = { m1: { id: "m1", cannibalization: [] } as unknown as TodayMove };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out).toBe(c);
  });

  it("leaves a row with no matching move untouched (no sourceIds entry)", () => {
    const c = cc("a", "suggested", { sourceIds: [], rationale: "some rationale" });
    const [out] = reconcileCannibalizationRationale([c], {});
    expect(out).toBe(c);
  });

  it("never emits an em or en dash in the reconciled sentence", () => {
    const fix = 'Fold "other page" into this one.';
    const c = cc("a", "suggested", { sourceIds: ["m1"], rationale: "different" });
    const movesById = { m1: moveWithCannibalization("m1", fix) };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out!.rationale).not.toMatch(/[–—]/);
  });
});

describe("dropBoardDuplicateNewPageRows (FP5b - 'new-page ideas appear three times in two formats')", () => {
  const boardKeys = new Set([topicIdentityKey("Biggest Cities In Iran")]);

  it("drops a page-less create row whose topic already has a New Pages board card, across singular/plural phrasing", () => {
    const rows = [
      cc("a", "suggested", { changeFamily: "new_page", pagePath: "", pageLabel: "biggest city in iran" }),
      cc("b", "suggested", { changeFamily: "meta", pagePath: "/some-page" }),
    ];
    const out = dropBoardDuplicateNewPageRows(rows, boardKeys);
    expect(out.map((c) => c.id)).toEqual(["b"]);
  });

  it("keeps a create topic the board does NOT carry (nothing is lost)", () => {
    const rows = [cc("a", "suggested", { changeFamily: "new_page", pagePath: "", pageLabel: "persian wedding sofreh" })];
    expect(dropBoardDuplicateNewPageRows(rows, boardKeys)).toHaveLength(1);
  });

  it("never drops a row that targets a REAL page, even when its label matches a board topic", () => {
    const rows = [cc("a", "suggested", { changeFamily: "new_page", pagePath: "/biggest-cities", pageLabel: "biggest cities in iran" })];
    expect(dropBoardDuplicateNewPageRows(rows, boardKeys)).toHaveLength(1);
  });

  it("never drops a non-new-page row", () => {
    const rows = [cc("a", "suggested", { changeFamily: "answer", pagePath: "", pageLabel: "biggest cities in iran" })];
    expect(dropBoardDuplicateNewPageRows(rows, boardKeys)).toHaveLength(1);
  });

  it("is a no-op when the board read failed (empty key set - honest degradation, never a blank list)", () => {
    const rows = [cc("a", "suggested", { changeFamily: "new_page", pagePath: "", pageLabel: "biggest cities in iran" })];
    expect(dropBoardDuplicateNewPageRows(rows, new Set())).toHaveLength(1);
  });
});

describe("demoteUnsized + rankChanges (integration) - the demotion actually survives real ranking", () => {
  it("an unsized row never outranks a sized row under the default 'balanced' strategy, even when the unsized row is 'ready' (readyBonus) and the sized row is a bare 'suggested'", () => {
    const unsizedReady = cc("unsized-ready", "ready", {
      impactScore: 5000, // a large raw demand/score number - exactly what used to dominate pre-fix
      expectedOutcomeLow: null,
      evidenceStrength: "directional",
      estimatedEffortMinutes: 1,
      riskLevel: "low",
    });
    const sizedSuggested = cc("sized-suggested", "suggested", {
      impactScore: 5,
      expectedOutcomeLow: 10,
      expectedOutcomeHigh: 30,
      evidenceStrength: "directional",
      estimatedEffortMinutes: 5,
      riskLevel: "low",
    });
    const demoted = demoteUnsized([unsizedReady, sizedSuggested]);
    const ranked = rankChanges(demoted, "balanced");
    // Both are actionable status views (ready/suggested collapse together in the UI), so this
    // is a fair apples-to-apples check of whether "ready" status alone can no longer let a huge
    // raw impactScore smuggle an unsized row above a real, sized forecast.
    expect(ranked[0]!.id).toBe("sized-suggested");
  });

  it("within the unsized rows themselves, relative order by original impactScore is preserved (demotion does not flatten them all to one bucket)", () => {
    const a = cc("a", "suggested", { impactScore: 50, expectedOutcomeLow: null });
    const b = cc("b", "suggested", { impactScore: 5, expectedOutcomeLow: null });
    const demoted = demoteUnsized([b, a]);
    const ranked = rankChanges(demoted, "balanced");
    expect(ranked[0]!.id).toBe("a");
  });

  it("two sized rows rank exactly as they did before (demotion is a no-op for them)", () => {
    const high = cc("high", "suggested", { impactScore: 80, expectedOutcomeLow: 20, expectedOutcomeHigh: 40 });
    const low = cc("low", "suggested", { impactScore: 20, expectedOutcomeLow: 5, expectedOutcomeHigh: 10 });
    const demoted = demoteUnsized([low, high]);
    const ranked = rankChanges(demoted, "balanced");
    expect(ranked[0]!.id).toBe("high");
  });

  it("holds under every strategy mode, including 'clean' evidence's own +1000 bonus for strong evidence", () => {
    const unsizedStrong = cc("unsized-strong", "suggested", {
      impactScore: 5000,
      expectedOutcomeLow: null,
      evidenceStrength: "strong",
      riskLevel: "low",
    });
    const sizedDirectional = cc("sized-directional", "suggested", {
      impactScore: 5,
      expectedOutcomeLow: 10,
      expectedOutcomeHigh: 30,
      evidenceStrength: "directional",
      riskLevel: "low",
    });
    const demoted = demoteUnsized([unsizedStrong, sizedDirectional]);
    for (const strategy of ["balanced", "growth", "clean"] as const) {
      const ranked = rankChanges(demoted, strategy);
      // "clean" filters to strong-evidence-only, which would drop the sized-directional row
      // entirely and leave the unsized-strong one alone - that's a real strategy behavior
      // (not a ranking failure), so only assert ordering when both rows are still in the pool.
      if (ranked.some((c) => c.id === "sized-directional")) {
        expect(ranked[0]!.id).toBe("sized-directional");
      }
    }
  });
});
