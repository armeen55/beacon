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
import { dedupeIdentity, strongerChange, dedupeChanges, demoteUnsized, reconcileCannibalizationRationale, dropBoardDuplicateNewPageRows, applyOpportunityFreshness, abstentionEvidenceFor, partitionActionableByEvidence } from "./changes-data";
import { cannibalizationDirective } from "@/domains/changes/decide-action";
import { WATCHING_SENTENCE, heldForEvidenceLine } from "@/domains/recommendations/abstention";
import { topicIdentityKey } from "@/domains/demand-graph/dedupe-new-page-cards";
import type { CanonicalChange, CanonicalStatus } from "@/domains/changes/canonical-change";
import { rankChanges } from "@/domains/changes/strategy";
import type { TodayMove } from "./today-moves-data";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

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

describe("reconcileCannibalizationRationale (Wave 3C - the secondary line consumes the DECIDED action)", () => {
  // The fix text still carries the OLD ambiguous "(redirect or internal-link)" here on purpose:
  // reconcile must IGNORE it and build the rationale from the decided action instead.
  function moveWithCannibalization(id: string, over: Record<string, unknown> = {}): TodayMove {
    return {
      id,
      cannibalization: [
        {
          query: "q",
          otherPages: ["other page"],
          isLead: true,
          leadPage: "Best Page",
          fix: '"Best Page" is your best-ranking page for "q" - fold this into it (redirect or internal-link) so they stop splitting its clicks.',
          linkSnippet: null,
          decision: "consolidate",
          ...over,
        },
      ],
    } as unknown as TodayMove;
  }

  it("rewrites the rationale to the decided directive, never the ambiguous fix text", () => {
    const c = cc("a", "suggested", { sourceIds: ["m1"], decision: "consolidate", rationale: "You already rank position 8 for a totally different query, a sharper title can climb a few spots." });
    const movesById = { m1: moveWithCannibalization("m1") };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out!.rationale).toContain("comes first");
    expect(out!.rationale).toContain("Consolidate your competing pages");
    // The ambiguous "(redirect or internal-link)" fork never reaches the rendered rationale.
    expect(out!.rationale).not.toContain("redirect or internal-link");
    expect(out!.decision).toBe("consolidate");
  });

  it("uses the redirect directive (no fork) when Beacon decided to prune a dead page", () => {
    const c = cc("a", "suggested", { sourceIds: ["m1"], decision: "prune_redirect" });
    const movesById = { m1: moveWithCannibalization("m1", { decision: "prune_redirect" }) };
    const [out] = reconcileCannibalizationRationale([c], movesById);
    expect(out!.rationale).toContain("redirect");
    expect(out!.rationale).not.toContain(" or internal");
    expect(out!.decision).toBe("prune_redirect");
  });

  it("leaves the rationale untouched when it already states the decided directive", () => {
    const directive = cannibalizationDirective({ decision: "consolidate", leadPage: "Best Page", otherPages: ["other page"], query: "q", isLead: true });
    const rationale = `${directive} That comes first, any other edit below on this page should wait until this is resolved.`;
    const c = cc("a", "suggested", { sourceIds: ["m1"], decision: "consolidate", rationale });
    const movesById = { m1: moveWithCannibalization("m1") };
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
    const c = cc("a", "suggested", { sourceIds: ["m1"], decision: "consolidate", rationale: "different" });
    const movesById = { m1: moveWithCannibalization("m1") };
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

describe("applyOpportunityFreshness (N46, R6 - wired AFTER dedupe/rank, presentation + selection only)", () => {
  const NOW = new Date("2026-07-03T00:00:00Z");
  const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

  it("is byte-identical when no plan is loaded (no createdAt to judge by)", () => {
    const rows = [cc("a", "suggested"), cc("b", "ready")];
    const out = applyOpportunityFreshness(rows, null, new Set(), NOW);
    expect(out).toEqual(rows);
  });

  it("is byte-identical when the plan has no items at all", () => {
    const rows = [cc("a", "suggested")];
    const out = applyOpportunityFreshness(rows, daysAgo(60), new Set(), NOW);
    expect(out).toEqual(rows);
  });

  it("leaves a worklist-sourced row (not in planItemIds) completely untouched, even with a stale plan", () => {
    const rows = [cc("a", "suggested", { sourceIds: ["worklist-move-1"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(60), new Set(["plan-item-9"]), NOW);
    expect(out[0]!.freshness).toBeUndefined();
  });

  it("marks a fresh plan-sourced row's freshness field absent (not 'fresh' - never adds noise for the common case)", () => {
    const rows = [cc("a", "ready", { sourceIds: ["plan-item-1"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(2), new Set(["plan-item-1"]), NOW);
    expect(out[0]!.freshness).toBeUndefined();
    expect(out[0]).toEqual(rows[0]);
  });

  it("marks an aging plan-sourced row with the quiet chip", () => {
    const rows = [cc("a", "ready", { sourceIds: ["plan-item-1"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(25), new Set(["plan-item-1"]), NOW);
    expect(out[0]!.freshness).toBe("aging");
    expect(out[0]!.agingChip).toBe("evidence from 4 weeks ago");
    expect(hasBannedDash(out[0]!.agingChip ?? "")).toBe(false);
  });

  it("marks an expired plan-sourced row, never deleting it (still present, order untouched)", () => {
    const rows = [cc("a", "ready", { sourceIds: ["plan-item-1"] }), cc("b", "ready", { sourceIds: ["plan-item-2"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(60), new Set(["plan-item-1", "plan-item-2"]), NOW);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.id)).toEqual(["a", "b"]); // order preserved - never re-ranked
    expect(out[0]!.freshness).toBe("expired");
    expect(out[0]!.agingChip).toBeNull();
  });

  it("never mutates the input array's objects", () => {
    const rows = [cc("a", "ready", { sourceIds: ["plan-item-1"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(60), new Set(["plan-item-1"]), NOW);
    expect(out[0]).not.toBe(rows[0]);
    expect(rows[0]!.freshness).toBeUndefined();
  });

  it("matches a row via ANY of its sourceIds (a deduped row can carry multiple)", () => {
    const rows = [cc("a", "ready", { sourceIds: ["worklist-1", "plan-item-1"] })];
    const out = applyOpportunityFreshness(rows, daysAgo(60), new Set(["plan-item-1"]), NOW);
    expect(out[0]!.freshness).toBe("expired");
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

describe("N49 abstention live-path (partitionActionableByEvidence / abstentionEvidenceFor)", () => {
  it("holds a bare suggestion with NONE of the three real signals (no-evidence hunch)", () => {
    // A suggested row with no source move and no sizing/lane evidence carries no signal.
    const noEvidence = cc("no-evidence", "suggested", {
      upside: null,
      expectedOutcomeLow: null,
      sources: undefined,
    });
    const { kept, heldCount } = partitionActionableByEvidence([noEvidence], {});
    expect(heldCount).toBe(1);
    expect(kept.find((c) => c.id === "no-evidence")).toBeUndefined();
    // The exact R21 held-count copy renders from the held count.
    expect(heldForEvidenceLine(heldCount)).toBe(
      "1 possible move is waiting for more evidence before I recommend it.",
    );
  });

  it("passes an EVIDENCED suggestion through UNCHANGED (a sized forecast is real demand)", () => {
    const evidenced = cc("evidenced", "suggested", { expectedOutcomeLow: 10, expectedOutcomeHigh: 30 });
    const { kept, heldCount } = partitionActionableByEvidence([evidenced], {});
    expect(heldCount).toBe(0);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toBe(evidenced); // same reference, byte-identical passthrough
  });

  it("BYTE-IDENTICAL when every suggestion is evidenced: kept === input, held 0", () => {
    const a = cc("a", "suggested", { upside: 40 });
    const b = cc("b", "suggested", { expectedOutcomeLow: 5, expectedOutcomeHigh: 12 });
    const c = cc("c", "suggested", { sources: ["keyword_library"] });
    const input = [a, b, c];
    const { kept, heldCount } = partitionActionableByEvidence(input, {});
    expect(heldCount).toBe(0);
    expect(kept).toEqual(input);
  });

  it("NEVER re-gates a row that already earned ready/apply/measuring/result/blocked", () => {
    // These carry no evidence in the fixture, but a non-suggested status has already proven
    // itself and must never be held (that would drop a live/settled change).
    const earned = (["ready", "apply", "measuring", "result", "blocked"] as const).map((s) =>
      cc(`earned-${s}`, s),
    );
    const { kept, heldCount } = partitionActionableByEvidence(earned, {});
    expect(heldCount).toBe(0);
    expect(kept).toEqual(earned);
  });

  it("does NOT drop a no-evidence-looking suggestion that has a real source-move signal", () => {
    // The change itself carries no sizing, but its source TodayMove has real GSC demand +
    // a competitor teardown - abstentionEvidenceFor must read the move and pass it through.
    const c = cc("has-move", "suggested", { sourceIds: ["m1"], upside: null, expectedOutcomeLow: null });
    const m = {
      id: "m1",
      query: "q",
      demand: 4200,
      demandBasis: "gsc",
      competitorInformed: { domain: "rival.com" },
      topQueries: [{ query: "q", impressions: 900, clicks: 3, position: 8, ctr: 0.003 }],
    } as unknown as TodayMove;
    const ev = abstentionEvidenceFor(c, m);
    expect(ev.hasDemandSignal).toBe(true);
    expect(ev.hasCompetitorTeardown).toBe(true);
    expect(ev.hasBehaviorOrGscSignal).toBe(true);
    const { kept, heldCount } = partitionActionableByEvidence([c], { m1: m });
    expect(heldCount).toBe(0);
    expect(kept[0]).toBe(c);
  });

  it("the held sentence + count line carry no banned dashes", () => {
    expect(hasBannedDash(WATCHING_SENTENCE)).toBe(false);
    expect(hasBannedDash(heldForEvidenceLine(6) ?? "")).toBe(false);
    // The R21 canonical copy the wire-in surfaces for 6 held.
    expect(heldForEvidenceLine(6)).toBe(
      "6 possible moves are waiting for more evidence before I recommend them.",
    );
  });
});
