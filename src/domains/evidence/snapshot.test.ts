/**
 * Outcome tests for the EvidenceSnapshot kernel. These pin the CONTRACT downstream Decisions consume, not the
 * implementation. They prove: all six mandatory sources normalize in with an honest freshness slot; owned-page
 * and competitor evidence are both present; the assembler is deterministic; native AI can fail soft; and the
 * evidenceHash tracks MATERIAL evidence (including the research funnel's keywords / AI observations / SERP /
 * winning pages) while ignoring every timestamp and spend/cache counter.
 */
import { describe, it, expect } from "vitest";
import { buildEvidenceSnapshot, MANDATORY_SOURCES, type EvidenceSnapshotInput, type EvidenceSourceKind } from "./snapshot";
import { emptyResearchEvidence, type FunnelResearchEvidence } from "./funnel/research-evidence";
const RESEARCH_SOURCE = { status: "dormant" as const, lastSyncedAt: null, payload: emptyResearchEvidence() };
const SCOPE = { tenantId: "t_iran", site: "fixture-content.example", builtAt: "2026-07-22T00:00:00.000Z" };
/** A fully-populated six-source fixture (existing owned page + a cited competitor). */
function fullInput(): EvidenceSnapshotInput {
  return {
    scope: SCOPE,
    gsc: { status: "fresh", lastSyncedAt: "2026-07-21T00:00:00.000Z", payload: [
      { url: "https://fixture-content.example/flag", clicks90d: 40, impressions90d: 4000, ctr90d: 0.01, position90d: 8.2,
        topQueries: [{ query: "iran flag meaning", impressions: 3000, clicks: 30, position: 8 }, { query: "iran flag colors", impressions: 1000, clicks: 10, position: 9 }] },
      { url: "https://fixture-content.example/flag-history", clicks90d: 5, impressions90d: 900, ctr90d: 0.005, position90d: 14,
        topQueries: [{ query: "iran flag meaning", impressions: 900, clicks: 5, position: 14 }] }] },
    ga4: { status: "fresh", lastSyncedAt: "2026-07-21T00:00:00.000Z", payload: [
      { url: "https://fixture-content.example/flag", sessions28d: 800, engaged28d: 500, conversions28d: 12, revenueUsd: 340 }] },
    wix: { status: "fresh", lastSyncedAt: "2026-07-20T00:00:00.000Z", payload: [
      { url: "https://fixture-content.example/flag", title: "The Iran Flag: Meaning and Colors", metaDescription: "What the Iran flag means.", h1: "The Iran Flag", h2: ["Colors", "Emblem"], outline: ["Colors", "Emblem", "History"], schemaTypes: ["Article"], hasFaq: false, faqCount: 0, wordCount: 600, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" },
      { url: "https://fixture-content.example/flag-history", title: "Iran Flag History Through the Ages", metaDescription: null, h1: "Iran Flag History", h2: ["Timeline"], outline: ["Timeline"], schemaTypes: [], hasFaq: false, faqCount: 0, wordCount: 300, internalLinks: [], fetchedAt: "2026-07-20T00:00:00.000Z" }] },
    clarity: { status: "fresh", lastSyncedAt: "2026-07-21T00:00:00.000Z", payload: [
      { url: "https://fixture-content.example/flag", sessions: 800, rageClicks: 20, deadClicks: 10, quickbacks: 5, scriptErrors: 3, frictionScore: 36 }] },
    dataforseo: { status: "fresh", lastSyncedAt: "2026-07-19T00:00:00.000Z", payload: [{ query: "iran flag meaning", searchVolume: 5400, competition: 0.2, competitionLevel: "low" },
      { query: "buy iran flag", searchVolume: 880, competition: 0.8, competitionLevel: "high" }] },
    research: RESEARCH_SOURCE,
    nativeAi: { status: "fresh", lastSyncedAt: "2026-07-21T00:00:00.000Z", payload: { rowsScanned: 120, enginesSeen: ["chatgpt", "perplexity"],
      citedPages: [
        { url: "https://fixture-content.example/flag", isOwned: true, citationCount: 4, distinctPrompts: 3, engines: ["chatgpt"], examplePrompts: ["what does the iran flag mean"] },
        { url: "https://persianfood.example/kebab", isOwned: false, citationCount: 9, distinctPrompts: 6, engines: ["chatgpt", "perplexity"], examplePrompts: ["best persian kebab recipes", "how to make koobideh kebab"] }],
      questions: [{ text: "what does the emblem on the iran flag mean", weight: 5, sourcePrompts: ["p1", "p2"] }, { text: "iran flag colors meaning", weight: 3, sourcePrompts: ["p3"] }] } },
  };
}
describe("buildEvidenceSnapshot - six-source normalization", () => {
  it("normalizes all six sources and joins owned evidence by canonical URL", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    expect(snap.sources.map((s) => s.source).sort()).toEqual([...MANDATORY_SOURCES].sort());
    for (const s of snap.sources) expect(s.status).toBe("fresh");
    const flag = snap.ownedPages.find((p) => p.url === "fixture-content.example/flag")!;
    expect(flag.search?.clicks90d).toBe(40); expect(flag.engagement?.revenueUsd).toBe(340); // GSC, then GA4 revenue
    expect(flag.content?.title).toBe("The Iran Flag: Meaning and Colors"); expect(flag.friction?.frictionScore).toBe(36); // Wix, then Clarity
    expect(flag.aiCitations.count).toBe(4); // native AI
    const meaning = snap.keywordDemand.find((k) => k.query === "iran flag meaning")!;
    expect(meaning.searchVolume).toBe(5400); expect(meaning.source).toBe("mixed"); // DataForSEO volume, and both sources agreed
    expect(meaning.gscImpressions).toBe(3900); // 3000 + 900 across both owned pages
    const q = snap.questionDemand.find((x) => x.question.includes("emblem"))!;
    expect(q.source).toBe("native_ai"); expect(["answered", "unanswered"]).toContain(q.coverageStatus);
  });
  it("surfaces competitor, cannibalization, and intent evidence", () => {
    const snap = buildEvidenceSnapshot(fullInput());
    expect(snap.competitors.some((c) => c.domain === "persianfood.example")).toBe(true);
    // A cited competitor stays evidence and never becomes a page topic of its own.
    expect(snap.contentGaps.every((g) => g.kind === "unanswered_question")).toBe(true);
    const cannib = snap.cannibalization.find((c) => c.query === "iran flag meaning")!;
    expect(cannib.competingUrls).toEqual(["fixture-content.example/flag", "fixture-content.example/flag-history"]);
    expect(snap.intentClusters.find((c) => c.queries.some((qq) => qq.includes("buy")))?.intent).toBe("commercial");
  });
  it("is deterministic and hashes on material evidence, not the clock", () => {
    const base = fullInput(); const a = buildEvidenceSnapshot(base);
    expect(buildEvidenceSnapshot(fullInput())).toEqual(a);
    const laterClock: EvidenceSnapshotInput = { ...base, gsc: { ...base.gsc, lastSyncedAt: "2099-01-01T00:00:00.000Z" } };
    expect(buildEvidenceSnapshot(laterClock).evidenceHash).toBe(a.evidenceHash);
    const changed: EvidenceSnapshotInput = { ...base, gsc: { ...base.gsc, payload: base.gsc.payload.map((p, i) => (i === 0 ? { ...p, clicks90d: 9999 } : p)) } };
    expect(buildEvidenceSnapshot(changed).evidenceHash).not.toBe(a.evidenceHash);
  });
});
describe("buildEvidenceSnapshot - honest source states", () => {
  function emptyInput(): EvidenceSnapshotInput {
    const empty = <T>(payload: T) => ({ status: "empty" as const, lastSyncedAt: null, payload });
    return { scope: SCOPE, gsc: empty([]), ga4: empty([]), wix: empty([]), clarity: empty([]), dataforseo: empty([]), research: RESEARCH_SOURCE,
      nativeAi: { status: "dormant", lastSyncedAt: null, payload: { citedPages: [], questions: [], rowsScanned: 0, enginesSeen: [] } } };
  }
  it("keeps all six slots even when every source is empty/dormant", () => {
    const snap = buildEvidenceSnapshot(emptyInput());
    expect(snap.sources).toHaveLength(6); expect(snap.ownedPages).toHaveLength(0);
    const byKind = new Map<EvidenceSourceKind, string>(snap.sources.map((s) => [s.source, s.status]));
    expect(byKind.get("native_ai")).toBe("dormant"); expect(byKind.get("gsc")).toBe("empty");
  });
  it("distinguishes a FAILED source from an EMPTY one, with a plain note", () => {
    const input = emptyInput();
    input.ga4 = { status: "failed", lastSyncedAt: null, note: "GA4 read errored this run.", payload: [] };
    const snap = buildEvidenceSnapshot(input); const ga4 = snap.sources.find((s) => s.source === "ga4")!;
    expect(ga4.status).toBe("failed"); expect(ga4.note).toBe("GA4 read errored this run.");
    expect(snap.sources.find((s) => s.source === "gsc")!.note).not.toBe(ga4.note);
  });
  it("native AI dormant does not break the rest of the snapshot", () => {
    const input = fullInput();
    input.nativeAi = { status: "dormant", lastSyncedAt: null, payload: { citedPages: [], questions: [], rowsScanned: 0, enginesSeen: [] } };
    const snap = buildEvidenceSnapshot(input);
    expect(snap.sources.find((s) => s.source === "native_ai")!.status).toBe("dormant");
    expect(snap.ownedPages.length).toBe(2); // owned evidence still assembled
    expect(snap.competitors.length).toBe(0); expect(snap.aiCitations.rowsScanned).toBe(0); // no AI citations -> no competitors
  });
});
describe("evidenceHash - research material truth, not the clock", () => {
  function researchFixture(): FunnelResearchEvidence {
    return {
      retainedKeywords: [{ query: "koobideh recipe", searchVolume: 1200, competition: 0.3, competitionLevel: "low", difficulty: null, intent: "informational" }],
      aiObservations: [{ promptId: "p1", promptText: "best koobideh recipe", engine: "chatgpt", observationMode: "consumer_search", modelRequested: "gpt-4o", modelServed: "gpt-4o-2026", webSearchReported: true, citationsObserved: true, citations: [{ url: "https://persianfood.example/kebab", domain: "persianfood.example", title: "Kebab" }], fanOutQueries: ["koobideh", "kebab koobideh"], observedAt: "2026-07-22T00:00:00.000Z" }],
      serpEvidence: [{ query: "koobideh recipe", organic: [{ rank: 1, domain: "persianfood.example", url: "https://persianfood.example/kebab", title: "Kebab" }], aiOverview: [{ url: "https://ao.example/x", domain: "ao.example", title: null }], aiMode: [], paa: [{ question: "what is koobideh", answeringDomain: "persianfood.example" }], related: ["kebab"] }],
      winningPages: [{ url: "https://persianfood.example/kebab", domain: "persianfood.example", engines: ["chatgpt"], examplePrompts: ["best koobideh recipe"], appearances: [], extract: { title: "Kebab", h1: "Koobideh Kebab", wordCount: 800, headings: ["Ingredients"], faqCount: 2 } }],
      receipt: { researched: 5, retained: 1, stale: 0, missing: 0, cached: 3, spentUsd: 0.02, freshestObservationAt: "2026-07-22T00:00:00.000Z" },
    };
  }
  const hashOf = (r: FunnelResearchEvidence) => buildEvidenceSnapshot({ ...fullInput(), research: { status: "fresh", lastSyncedAt: "2026-07-22T00:00:00.000Z", payload: r } }).evidenceHash;
  it("is stable when only clocks and spend/cache counters change", () => {
    const base = hashOf(researchFixture()); const clockOnly = researchFixture();
    clockOnly.aiObservations[0].observedAt = "2099-01-01T00:00:00.000Z";
    clockOnly.winningPages[0].appearances = [{ kind: "ai_answer", query: null, promptId: "p1", promptText: "x", engine: "chatgpt", rank: null, citedUrl: "https://persianfood.example/kebab", observedAt: "2099-01-01T00:00:00.000Z", modelServed: "gpt-4o-2026" }];
    clockOnly.receipt = { researched: 999, retained: 999, stale: 9, missing: 9, cached: 999, spentUsd: 9.99, freshestObservationAt: "2099-01-01T00:00:00.000Z" };
    expect(hashOf(clockOnly)).toBe(base);
  });
  it("changes for a citation URL, observation mode, served model, fan-out list, keyword volume/intent, or extract structure", () => {
    const base = hashOf(researchFixture());
    const mut = (f: (r: FunnelResearchEvidence) => void) => { const r = researchFixture(); f(r); return hashOf(r); };
    expect(mut((r) => (r.aiObservations[0].citations![0].url = "https://other.example/x"))).not.toBe(base);
    expect(mut((r) => (r.aiObservations[0].observationMode = "standardized_response"))).not.toBe(base); // the consumer look and the standardized answer are never the same evidence
    expect(mut((r) => (r.aiObservations[0].modelServed = "gpt-5"))).not.toBe(base);
    expect(mut((r) => (r.aiObservations[0].fanOutQueries = ["totally", "different"]))).not.toBe(base);
    expect(mut((r) => (r.retainedKeywords[0].searchVolume = 99999))).not.toBe(base);
    expect(mut((r) => (r.retainedKeywords[0].intent = "commercial"))).not.toBe(base);
    expect(mut((r) => (r.winningPages[0].extract!.wordCount = 12345))).not.toBe(base);
  });
});
