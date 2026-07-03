import { describe, it, expect } from "vitest";
import {
  normalizeWorklistEntry,
  normalizeGapVerdictEntry,
  normalizeStealBriefEntry,
  normalizeKeywordLibraryEntry,
  selectKeywordLibraryGaps,
  fuseByPage,
  rankUnifiedEntries,
  unifiedScore,
  buildUnifiedList,
  unifiedEntryToCanonicalChange,
  mergeSourcesOntoChange,
  confidenceFromEvidence,
  sourcesSentence,
  MULTI_LANE_BOOST_PER_EXTRA_SOURCE,
  RISK_PENALTY,
  type UnifiedEntry,
} from "./unified-list";
import type { CanonicalChange } from "@/domains/changes/canonical-change";
import type { PersistedGapVerdict } from "@/domains/demand-graph/teardown-commonality-verdict";
import type { StealBrief } from "@/domains/serp/serp-steal-lane";
import type { KeywordLibraryRow } from "@/domains/research/keyword-library";

const TENANT = "tenant-test";

function change(over: Partial<CanonicalChange> = {}): CanonicalChange {
  return {
    id: "tenant-test::/page::meta",
    tenantId: TENANT,
    pagePath: "/page",
    pageUrl: "https://x.com/page",
    pageLabel: "Page",
    opportunityType: "Capture clicks",
    changeType: "edit_meta",
    changeFamily: "meta",
    status: "suggested",
    recommendation: "Update the meta description",
    exactInstructions: null,
    before: null,
    after: null,
    rationale: "Real evidence here",
    estimatedEffortMinutes: 1,
    impactScore: 50,
    upside: 30,
    expectedOutcome: "Usually adds 20 to 40 clicks a month within 14 days.",
    expectedOutcomeLow: 20,
    expectedOutcomeHigh: 40,
    expectedOutcomeDays: 14,
    hypothesisId: "abc123",
    riskLevel: "low",
    evidenceStrength: "directional",
    measurementMethod: "Tracked vs baseline",
    selectedForToday: false,
    activeExperiment: false,
    protectedControl: false,
    blockedReason: null,
    result: null,
    measurementHeadline: null,
    measurementDetail: null,
    nextCheckpoint: null,
    attributionLimited: false,
    qualityDecision: "approved",
    qualityNote: null,
    sourceIds: ["m1"],
    alternateOpportunities: [],
    ...over,
  };
}

function gapVerdict(over: Partial<PersistedGapVerdict> = {}): PersistedGapVerdict {
  return {
    promptId: "prompt-1",
    outcome: "atomic_edit",
    atomicEdit: {
      kind: "atomic_edit",
      ownedUrl: "https://x.com/persian-wedding",
      additions: ["Add a section on Sofreh Aghd costs"],
      fanoutQuestionsToWeave: [],
      rationale: "The winners all cover costs.",
    },
    newPage: null,
    renderedSentence: "3 of 3 winning pages cover Sofreh Aghd costs.",
    reason: null,
    promptText: "what happens at a persian wedding",
    ownedUrl: "https://x.com/persian-wedding",
    ...over,
  };
}

function stealBrief(over: Partial<StealBrief> = {}): StealBrief {
  return {
    keyword: "persian new year traditions",
    ourPage: "https://x.com/nowruz",
    ourPosition: 8,
    impressions: 2000,
    serpSource: "stored_history",
    competitorUrl: "https://competitor.com/nowruz",
    competitorDomain: "competitor.com",
    teardownStatus: "torn_down",
    whatWins: "a table of dates",
    structureGaps: ["haft-sin", "traditions"],
    editPointer: { label: "persian new year traditions", reason: "The top result covers haft-sin, which our page does not mention yet." },
    summary: "We rank position 8 for this, competitor.com outranks us.",
    ...over,
  };
}

function kwRow(over: Partial<KeywordLibraryRow> = {}): KeywordLibraryRow {
  return {
    keyword: "persian calligraphy classes",
    searchesPerMo: 500,
    timesShownPerMo: 300,
    clicks: 5,
    yourPosition: null,
    difficulty: null,
    trend: null,
    ownerPage: null,
    ownerPageHref: null,
    competitorOwners: [],
    relatedQuestions: [],
    sources: ["gsc"],
    lastChecked: null,
    ...over,
  };
}

describe("normalizeWorklistEntry (lane a)", () => {
  it("carries forecast, effort, and status straight through from the CanonicalChange", () => {
    const e = normalizeWorklistEntry(change());
    expect(e.id).toBe("worklist:tenant-test::/page::meta");
    expect(e.page).toBe("/page");
    expect(e.expectedValue).toEqual({ low: 20, high: 40, basis: "Usually adds 20 to 40 clicks a month within 14 days.", days: 14, hypothesisId: "abc123" });
    expect(e.effortMinutes).toBe(1);
    expect(e.sources).toEqual(["worklist"]);
    expect(e.sourceChange).not.toBeNull();
  });

  it("never re-derives confidence beyond the existing evidence-strength ladder", () => {
    expect(confidenceFromEvidence("strong")).toBeGreaterThan(confidenceFromEvidence("directional"));
    expect(confidenceFromEvidence("directional")).toBeGreaterThan(confidenceFromEvidence("tracking"));
  });

  it("passes through a blocked status as a hold, without dropping the row", () => {
    const e = normalizeWorklistEntry(change({ status: "blocked", blockedReason: "This page is a comparison control." }));
    expect(e.hold).toEqual({ held: true, reason: "This page is a comparison control." });
  });

  it("passes through a flagged quality decision as a hold", () => {
    const e = normalizeWorklistEntry(change({ qualityDecision: "flagged", qualityNote: "May be off-topic." }));
    expect(e.hold).toEqual({ held: true, reason: "May be off-topic." });
  });

  it("is not held when neither blocked nor flagged", () => {
    const e = normalizeWorklistEntry(change());
    expect(e.hold).toEqual({ held: false, reason: null });
  });
});

describe("normalizeGapVerdictEntry (lane b, D2)", () => {
  it("returns null for no_verdict (never fabricates an entry from insufficient evidence)", () => {
    expect(normalizeGapVerdictEntry(TENANT, gapVerdict({ outcome: "no_verdict", atomicEdit: null, reason: "Fewer than 2 usable teardowns." }))).toBeNull();
  });

  it("normalizes an atomic_edit verdict to an edit entry naming the owned page", () => {
    const e = normalizeGapVerdictEntry(TENANT, gapVerdict())!;
    expect(e.kind).toBe("edit");
    expect(e.page).toBe("/persian-wedding");
    expect(e.exactWhat).toContain("Sofreh Aghd costs");
    expect(e.sources).toEqual(["aeo_gap"]);
  });

  it("normalizes a new_page verdict to a create entry with no page, only a topic", () => {
    const v = gapVerdict({
      outcome: "new_page",
      atomicEdit: null,
      ownedUrl: null,
      newPage: {
        kind: "new_page_commonality",
        sharedHeadingsToInclude: ["Costs"],
        answerShape: "definition_first",
        wordBand: { low: 800, high: 1600, median: 1200 },
        schemaTypesToInclude: ["FAQPage"],
        openingPattern: "direct_definition",
        hasFaqConsensus: true,
        hasToolConsensus: false,
        fanoutQuestionsToWeave: [],
        rationale: "No owned page yet.",
      },
    });
    const e = normalizeGapVerdictEntry(TENANT, v)!;
    expect(e.kind).toBe("create");
    expect(e.page).toBeNull();
    expect(e.topic).toBe(v.promptText);
  });

  it("an edit verdict is honest when there are no concrete additions", () => {
    const e = normalizeGapVerdictEntry(TENANT, gapVerdict({ atomicEdit: { kind: "atomic_edit", ownedUrl: "https://x.com/p", additions: [], fanoutQuestionsToWeave: [], rationale: "Already matches." } }))!;
    expect(e.exactWhat).toMatch(/already covers/i);
  });
});

describe("normalizeStealBriefEntry (lane c, D3)", () => {
  it("normalizes a torn-down brief with real GSC position/impressions", () => {
    const e = normalizeStealBriefEntry(TENANT, stealBrief())!;
    expect(e.kind).toBe("edit");
    expect(e.page).toBe("/nowruz");
    expect(e.exactWhat).toContain("haft-sin");
    expect(e.sources).toEqual(["serp_steal"]);
    expect(e.confidence).toBeGreaterThan(0);
  });

  it("returns null when the SERP was never resolved (nothing concrete to do yet)", () => {
    expect(normalizeStealBriefEntry(TENANT, stealBrief({ teardownStatus: "not_read", editPointer: null }))).toBeNull();
  });

  it("flags a blocked teardown as a risk without dropping the entry", () => {
    const e = normalizeStealBriefEntry(TENANT, stealBrief({ teardownStatus: "blocked", editPointer: null }))!;
    expect(e).not.toBeNull();
    expect(e.exactWhat).toMatch(/blocks crawlers/);
    expect(e.riskFlags[0]).toMatch(/blocks crawlers/);
  });
});

describe("selectKeywordLibraryGaps + normalizeKeywordLibraryEntry (lane d)", () => {
  it("selects an unowned row with real demand", () => {
    const rows = [kwRow()];
    const selected = selectKeywordLibraryGaps(rows, new Set());
    expect(selected).toHaveLength(1);
  });

  it("selects a close-to-page-1 owned row (position 11-20) but not a page-1 row", () => {
    const closeRow = kwRow({ keyword: "close", ownerPage: "https://x.com/close", yourPosition: 14 });
    const page1Row = kwRow({ keyword: "page1", ownerPage: "https://x.com/page1", yourPosition: 3 });
    const selected = selectKeywordLibraryGaps([closeRow, page1Row], new Set());
    expect(selected.map((r) => r.keyword)).toEqual(["close"]);
  });

  it("drops a row below the demand floor", () => {
    const thin = kwRow({ searchesPerMo: 5, timesShownPerMo: 5 });
    expect(selectKeywordLibraryGaps([thin], new Set())).toHaveLength(0);
  });

  it("drops a row whose owner page is already covered by another lane", () => {
    const covered = kwRow({ ownerPage: "https://x.com/covered", yourPosition: 15 });
    expect(selectKeywordLibraryGaps([covered], new Set(["/covered"]))).toHaveLength(0);
  });

  it("normalizes an unowned row to a create entry naming the topic", () => {
    const e = normalizeKeywordLibraryEntry(TENANT, kwRow());
    expect(e.kind).toBe("create");
    expect(e.topic).toBe("persian calligraphy classes");
    expect(e.exactWhat).toContain("500");
  });

  it("normalizes an owned close-to-page-1 row to an edit entry", () => {
    const e = normalizeKeywordLibraryEntry(TENANT, kwRow({ ownerPage: "https://x.com/close", yourPosition: 14 }));
    expect(e.kind).toBe("edit");
    expect(e.page).toBe("/close");
  });
});

describe("fuseByPage (multi-lane agreement)", () => {
  it("merges two entries on the same page into one, unioning sources", () => {
    const a = normalizeWorklistEntry(change({ pagePath: "/persian-wedding" }));
    const b = normalizeGapVerdictEntry(TENANT, gapVerdict())!;
    const fused = fuseByPage([a, b]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.sources.sort()).toEqual(["aeo_gap", "worklist"]);
  });

  it("never merges two create entries with different topics (no page to key on)", () => {
    const a = normalizeKeywordLibraryEntry(TENANT, kwRow({ keyword: "topic a" }));
    const b = normalizeKeywordLibraryEntry(TENANT, kwRow({ keyword: "topic b" }));
    const fused = fuseByPage([a, b]);
    expect(fused).toHaveLength(2);
  });

  it("fusion never lowers confidence or raises risk below either input's best", () => {
    const strongLowRisk = normalizeWorklistEntry(change({ pagePath: "/p", evidenceStrength: "strong", riskLevel: "low" }));
    const weakHighRisk: UnifiedEntry = { ...normalizeKeywordLibraryEntry(TENANT, kwRow({ ownerPage: "https://x.com/p", yourPosition: 15 })), risk: "high", confidence: 0.1 };
    const fused = fuseByPage([strongLowRisk, weakHighRisk])[0]!;
    expect(fused.confidence).toBe(strongLowRisk.confidence);
    expect(fused.risk).toBe("low");
  });

  it("a hold on any fused lane holds the whole entry", () => {
    const held = normalizeWorklistEntry(change({ pagePath: "/p", status: "blocked", blockedReason: "mid-measurement" }));
    const clean = normalizeGapVerdictEntry(TENANT, gapVerdict({ atomicEdit: { kind: "atomic_edit", ownedUrl: "https://x.com/p", additions: ["x"], fanoutQuestionsToWeave: [], rationale: "r" } }))!;
    const fused = fuseByPage([held, clean])[0]!;
    expect(fused.hold.held).toBe(true);
  });
});

describe("unifiedScore + rankUnifiedEntries (ranking determinism, multi-lane boost, risk penalty)", () => {
  const base: UnifiedEntry = {
    id: "a",
    kind: "edit",
    page: "/a",
    topic: null,
    pageLabel: "A",
    exactWhat: "Do X",
    expectedValue: { low: 20, high: 40, basis: "b", days: 14, hypothesisId: "h" },
    confidence: 0.6,
    risk: "low",
    riskFlags: [],
    effortMinutes: 3,
    sources: ["worklist"],
    forecastBasis: "b",
    hold: { held: false, reason: null },
    sourceChange: null,
  };

  it("is deterministic: same input always produces the same order", () => {
    const entries = [
      { ...base, id: "a", confidence: 0.6 },
      { ...base, id: "b", confidence: 0.9, expectedValue: { ...base.expectedValue, low: 40, high: 60 } },
      { ...base, id: "c", confidence: 0.3, expectedValue: { ...base.expectedValue, low: null, high: null } },
    ];
    const r1 = rankUnifiedEntries(entries).map((e) => e.id);
    const r2 = rankUnifiedEntries([...entries].reverse()).map((e) => e.id);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(["b", "a", "c"]);
  });

  it("a second corroborating lane boosts the score by exactly the documented multiplier", () => {
    const single: UnifiedEntry = { ...base, sources: ["worklist"] };
    const dual: UnifiedEntry = { ...base, sources: ["worklist", "aeo_gap"] };
    expect(unifiedScore(dual)).toBeCloseTo(unifiedScore(single) * (1 + MULTI_LANE_BOOST_PER_EXTRA_SOURCE), 6);
  });

  it("a third lane boosts further (linear in extra sources)", () => {
    const dual: UnifiedEntry = { ...base, sources: ["worklist", "aeo_gap"] };
    const triple: UnifiedEntry = { ...base, sources: ["worklist", "aeo_gap", "serp_steal"] };
    expect(unifiedScore(triple)).toBeCloseTo(unifiedScore(base) * (1 + 2 * MULTI_LANE_BOOST_PER_EXTRA_SOURCE), 6);
    expect(unifiedScore(triple)).toBeGreaterThan(unifiedScore(dual));
  });

  it("higher risk strictly lowers score at equal everything else", () => {
    const low = { ...base, risk: "low" as const };
    const medium = { ...base, risk: "medium" as const };
    const high = { ...base, risk: "high" as const };
    expect(unifiedScore(low)).toBeGreaterThan(unifiedScore(medium));
    expect(unifiedScore(medium)).toBeGreaterThan(unifiedScore(high));
    expect(RISK_PENALTY.low).toBeGreaterThan(RISK_PENALTY.medium);
    expect(RISK_PENALTY.medium).toBeGreaterThan(RISK_PENALTY.high);
  });

  it("effort breaks ties within the same value band (quick wins first)", () => {
    const quick = { ...base, id: "quick", effortMinutes: 1 };
    const slow = { ...base, id: "slow", effortMinutes: 60 };
    const ranked = rankUnifiedEntries([slow, quick]);
    expect(ranked.map((e) => e.id)).toEqual(["quick", "slow"]);
  });

  it("a held entry sinks to the bottom but is never dropped from the list", () => {
    const held = { ...base, id: "held", hold: { held: true, reason: "wait" } };
    const clean = { ...base, id: "clean" };
    const ranked = rankUnifiedEntries([held, clean]);
    expect(ranked.map((e) => e.id)).toEqual(["clean", "held"]);
    expect(ranked).toHaveLength(2);
  });

  it("an unsized (honest-gap) entry still ranks, never disappears, but scores below a sized one at equal confidence", () => {
    const sized = { ...base, id: "sized" };
    const unsized = { ...base, id: "unsized", expectedValue: { ...base.expectedValue, low: null, high: null } };
    const ranked = rankUnifiedEntries([sized, unsized]);
    expect(ranked.map((e) => e.id)).toEqual(["sized", "unsized"]);
  });
});

describe("buildUnifiedList (end-to-end fuse + rank)", () => {
  it("fuses and ranks a mixed batch from every lane in one deterministic pass", () => {
    const worklist = normalizeWorklistEntry(change({ pagePath: "/a" }));
    const gap = normalizeGapVerdictEntry(TENANT, gapVerdict({ ownedUrl: "https://x.com/a", atomicEdit: { kind: "atomic_edit", ownedUrl: "https://x.com/a", additions: ["y"], fanoutQuestionsToWeave: [], rationale: "r" } }))!;
    const steal = normalizeStealBriefEntry(TENANT, stealBrief({ ourPage: "https://x.com/b" }))!;
    const kwGap = normalizeKeywordLibraryEntry(TENANT, kwRow());
    const list = buildUnifiedList([worklist, gap, steal, kwGap]);
    expect(list).toHaveLength(3); // worklist + gap fuse onto /a, steal stays separate, kwGap stays separate
    const fusedA = list.find((e) => e.page === "/a")!;
    expect(fusedA.sources.sort()).toEqual(["aeo_gap", "worklist"]);
  });
});

describe("unifiedEntryToCanonicalChange + mergeSourcesOntoChange (worklist seam)", () => {
  it("renders a non-worklist entry as a first-class CanonicalChange the existing UI can show", () => {
    const e = normalizeStealBriefEntry(TENANT, stealBrief())!;
    const c = unifiedEntryToCanonicalChange(TENANT, e);
    expect(c.id).toBe(e.id);
    expect(c.pagePath).toBe("/nowruz");
    expect(c.recommendation).toBe(e.exactWhat);
    expect(c.sources).toEqual(sourcesSentence(e.sources));
    expect(c.status).toBe("suggested");
  });

  it("a held entry renders as blocked with the hold reason surfaced", () => {
    const e: UnifiedEntry = { ...normalizeStealBriefEntry(TENANT, stealBrief())!, hold: { held: true, reason: "wait for data" } };
    const c = unifiedEntryToCanonicalChange(TENANT, e);
    expect(c.status).toBe("blocked");
    expect(c.blockedReason).toBe("wait for data");
  });

  it("mergeSourcesOntoChange never clobbers the original CanonicalChange's live status", () => {
    const original = change({ status: "measuring", measurementHeadline: "Early positive signal" });
    const e: UnifiedEntry = { ...normalizeWorklistEntry(original), sources: ["worklist", "serp_steal"] };
    const merged = mergeSourcesOntoChange(e);
    expect(merged.status).toBe("measuring");
    expect(merged.measurementHeadline).toBe("Early positive signal");
    expect(merged.sources).toEqual(["your worklist", "Google results"]);
  });

  it("a single-source worklist entry keeps its original rationale untouched", () => {
    const original = change({ rationale: "Original rationale" });
    const e = normalizeWorklistEntry(original);
    const merged = mergeSourcesOntoChange(e);
    expect(merged.rationale).toBe("Original rationale");
  });
});
