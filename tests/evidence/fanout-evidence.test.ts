import { describe, expect, it } from "vitest";
import { buildFanoutEvidence, ownedPageAiRollup, type FanoutSourceObservation } from "@/domains/evidence/ai-visibility/fanout-evidence";
/** THE ONE DERIVED FAN-OUT PROJECTION (AEO reconstruction, 2026-08-19). Visibility renders it and Decision consumes it off the SAME pure function, so these pins hold both surfaces at once: recurrence is DISTINCT days, assistants and parent questions and never raw rows; a prompt echo is never the assistant's own search; where the site stood is a four-way fact with an honest reporting denominator; and unknown stays unknown, never zero. */
const SITE = "own.example";
const obs = (over: Partial<FanoutSourceObservation> = {}): FanoutSourceObservation => ({
  observationId: `o-${Math.abs(JSON.stringify(over).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}-${over.reportingDay ?? "d"}-${over.engine ?? "e"}-${over.promptId ?? "p"}`,
  promptId: "p1", promptText: "where to buy a haft seen set", engine: "chatgpt", reportingDay: "2026-08-01",
  // The real instrument by default: the ChatGPT consumer-search scraper, whose sources are relied-on pages and which reports what it retrieved, so claims about reading are legal on these rows.
  observationMode: "consumer_search",
  fanOutQueries: ["haft seen set delivery"], citations: [{ url: "https://rival.example/a", domain: "rival.example" }], retrievedResults: null, ...over });
describe("recurrence is distinct days and assistants, never row totals", () => {
  it("counts five same-day same-engine executions as ONE day and ONE assistant, and it is not material", () => {
    const rows = Array.from({ length: 5 }, (_, i) => obs({ observationId: `o${i}` })); const [r] = buildFanoutEvidence(rows, SITE).rows;
    expect([r!.executions, r!.days, r!.engines, r!.parents.length, r!.material]).toEqual([5, 1, ["chatgpt"], 1, false]);});
  it("earns materiality on time, or on breadth that already cost something, and says which", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d, i) => obs({ observationId: `d${i}`, reportingDay: d })); const overDays = buildFanoutEvidence(days, SITE).rows[0]!;
    expect([overDays.material, overDays.materialBecause]).toEqual([true, "ran on 3 separate days"]);
    const twoDaysTwoEngines = [obs({ observationId: "a", engine: "chatgpt" }), obs({ observationId: "b", engine: "gemini", reportingDay: "2026-08-02" })]; expect(buildFanoutEvidence(twoDaysTwoEngines, SITE).rows[0]!.material).toBe(true);
    const parents = [obs({ observationId: "p1o" }), obs({ observationId: "p2o", reportingDay: "2026-08-02", promptId: "p2", promptText: "what goes on a haft seen table" })];
    expect(buildFanoutEvidence(parents, SITE).rows[0]!.material).toBe(true);
    expect(buildFanoutEvidence([obs({})], SITE).rows[0]!.material).toBe(false); // one sighting is watched, never work
  });
  it("does not call one same-day sighting on two assistants material until it has already cost something", () => {
    // THE COINCIDENCE. Two assistants ran the same search once, on one day, and nothing here was read for it.
    const coincidence = ["chatgpt", "gemini"].map((e, i) => obs({ observationId: `e${i}`, engine: e })); const bare = buildFanoutEvidence(coincidence, SITE).rows[0]!;
    expect(bare.material).toBe(false); expect(bare.materialBecause).toContain("not a pattern yet");
    // THE SAME SHAPE WITH A CONSEQUENCE: a page of this account was read for it and credited to somebody else.
    const costly = coincidence.map((o) => ({ ...o, retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] })); const withCost = buildFanoutEvidence(costly, SITE).rows[0]!;
    expect(withCost.material).toBe(true); expect(withCost.materialBecause).toContain("read for it and passed over");});
  it("keeps every exact wording that collapsed onto one search, most executed first", () => {
    const rows = [obs({ observationId: "v1", fanOutQueries: ["haft seen set delivery"] }),
      obs({ observationId: "v2", reportingDay: "2026-08-02", fanOutQueries: ["haft seen set delivery"] }),
      obs({ observationId: "v3", reportingDay: "2026-08-03", fanOutQueries: ["Haft Seen set delivery?"] })];
    const r = buildFanoutEvidence(rows, SITE).rows[0]!; expect(r.variants.map((v) => [v.text, v.executions])).toEqual([["haft seen set delivery", 2], ["Haft Seen set delivery?", 1]]);
    expect(r.query).toBe("haft seen set delivery"); // the wording shown is the one the assistants typed most
  });
  it("divides recurrence by its own parent questions' answers, never by the whole account", () => {
    // One loud question answered four times, one quiet question answered once, and the search rides the quiet one.
    const loud = Array.from({ length: 4 }, (_, i) => obs({ observationId: `l${i}`, reportingDay: `2026-08-0${i + 1}`, promptId: "loud", promptText: "loud question", fanOutQueries: ["something else entirely"] }));
    const quiet = obs({ observationId: "q1", promptId: "quiet", promptText: "quiet question", fanOutQueries: ["haft seen set delivery"] }); const row = buildFanoutEvidence([...loud, quiet], SITE).rows.find((r) => r.key.includes("haft"))!;
    expect([row.parentExecutions, row.parentShare]).toEqual([1, 1]); // every answer to ITS parent ran it
    expect(row.windowShare).toBe(0.2); // one of the account's five reporting answers, and it is labelled as that
  });
  it("names the pages of this account the assistants read for a search, and says what it did not list", () => {
    const rows = Array.from({ length: 3 }, (_, i) => obs({ observationId: `x${i}`, reportingDay: `2026-08-0${i + 1}`,
      retrievedResults: [{ url: "https://own.example/haft-seen?ref=x", domain: "own.example" }],
      citations: Array.from({ length: 7 }, (_, j) => ({ url: `https://rival${j}.example/a`, domain: `rival${j}.example` })) }));
    const r = buildFanoutEvidence(rows, SITE).rows[0]!; expect(r.ownPages).toEqual([{ url: "https://own.example/haft-seen", cited: 0, retrieved: 3, retrievedNotCited: 3 }]);
    expect([r.rivalPages.length, r.rivalPagesTotal]).toEqual([5, 7]); // five shown, seven said out loud
    expect(r.observationIdsTruncated).toBe(false);});
  it("never merges two models or two modes into one instrument", () => {
    const rows = [obs({ observationId: "m1", modelServed: "gpt-5", observationMode: "web" }),
      obs({ observationId: "m2", reportingDay: "2026-08-02", modelServed: "gpt-5.1", observationMode: "web" })];
    const r = buildFanoutEvidence(rows, SITE).rows[0]!; expect(r.models.map((m) => m.modelServed)).toEqual(["gpt-5", "gpt-5.1"]);});
  it("never lists the tracked question itself as a search the assistant thought of", () => {
    const echo = obs({ fanOutQueries: ["Where to buy a haft seen set?", "haft seen set delivery"] }); const rows = buildFanoutEvidence([echo], SITE).rows;
    expect(rows.map((r) => r.query)).toEqual(["haft seen set delivery"]);});});
describe("where the site stood is five different worlds, with an honest denominator", () => {
  it("says cited, read and passed over, never you, not credited, or unreported, off the same rows Visibility renders", () => {
    const cited = obs({ citations: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }); expect(buildFanoutEvidence([cited], SITE).rows[0]!.ownState).toBe("cited");
    const rnc = obs({ retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }); expect(buildFanoutEvidence([rnc], SITE).rows[0]!.ownState).toBe("retrieved_not_cited");
    // The scraper reports retrieval, so "never read this site" is a claim its rows can carry.
    expect(buildFanoutEvidence([obs({})], SITE).rows[0]!.ownState).toBe("not_retrieved");
    // llm_responses shows absence from the credit, never absence from the reading (Codex, 2026-08-21).
    const responses = obs({ engine: "claude", observationMode: "standardized_response" }); const [nc] = buildFanoutEvidence([responses], SITE).rows;
    expect([nc!.ownState, nc!.retrievalReportingAnswers, nc!.sourceSemantics]).toEqual(["not_credited", 0, "explicit_citation"]); const silent = obs({ citations: null });
    const [u] = buildFanoutEvidence([silent], SITE).rows;
    expect([u!.ownState, u!.reportingAnswers]).toEqual(["unreported", 0]); // missing reporting is a state, never a zero share
  });
  it("names what the reported sources mean, and never merges reliance with strict citation silently", () => {
    const scraper = obs({ observationId: "s1" }); const responses = obs({ observationId: "s2", engine: "gemini", observationMode: "standardized_response" });
    expect(buildFanoutEvidence([scraper], SITE).rows[0]!.sourceSemantics).toBe("selected_or_relied_on"); expect(buildFanoutEvidence([scraper, responses], SITE).rows[0]!.sourceSemantics).toBe("mixed");
    const unknown = obs({ observationMode: undefined }); // saying nothing is never evidence of absence
    expect(buildFanoutEvidence([unknown], SITE).rows[0]!.ownState).toBe("not_credited");});
  it("keeps the reporting denominator beside every claim and ranks rivals by answers crediting them", () => {
    const rows = [obs({ observationId: "a" }), obs({ observationId: "b", engine: "gemini", citations: null })]; const [r] = buildFanoutEvidence(rows, SITE).rows;
    expect([r!.executions, r!.reportingAnswers, r!.rivalPages[0]!.domain]).toEqual([2, 1, "rival.example"]);});
  it("rolls up each owned page's cited, read, and read-passed-over counts from the same canonical rows", () => {
    const rows = [
      obs({ observationId: "r1", citations: [{ url: "https://own.example/haft-seen", domain: "own.example" }], retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }),
      obs({ observationId: "r2", engine: "gemini", retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }),
    ];
    const [p] = ownedPageAiRollup(rows, SITE); expect([p!.url, p!.cited, p!.retrieved, p!.retrievedNotCited, p!.engines]).toEqual(["https://own.example/haft-seen", 1, 2, 1, ["chatgpt", "gemini"]]);
  });});
/** SITE FURNITURE COMES OUT AT THE CANONICAL EXTRACTION, once, computed from the account's own pages, never a hardcoded phrase list (Codex, 2026-08-21). */
describe("the canonical outline arrives without site furniture", () => {
  it("strips a heading printed across the site and keeps every page's own sections", async () => {
    const { buildEvidenceSnapshot } = await import("@/domains/evidence/snapshot"); const { emptyResearchEvidence } = await import("@/domains/evidence/funnel/research-evidence");
    const src = <T,>(payload: T) => ({ status: "fresh" as const, lastSyncedAt: null, payload });
    const wixPage = (path: string, own: string) => ({
      url: `https://fixture.example${path}`, title: own, metaDescription: "d", h1: own, h2: [],
      outline: ["Explore More", own, "Related Articles"], schemaTypes: [], hasFaq: false, faqCount: 0,
      wordCount: 500, internalLinks: [], fetchedAt: "2026-08-10T00:00:00.000Z" });
    const snap = buildEvidenceSnapshot({
      scope: { tenantId: "t", site: "fixture.example", builtAt: "2026-08-20T00:00:00.000Z" },
      gsc: src([]), ga4: src([]), clarity: src([]), dataforseo: src([]),
      wix: src([wixPage("/a", "Haft Seen Explained"), wixPage("/b", "Nowruz Recipes"), wixPage("/c", "Sizdah Bedar")]),
      research: src(emptyResearchEvidence()), aiAnswersUnread: false });
    const outlines = snap.ownedPages.map((p) => p.content?.outline ?? []);
    expect(outlines.flat()).not.toContain("Explore More"); // chrome on every page is not content anywhere
    expect(outlines.flat()).not.toContain("Related Articles"); expect(outlines.flat().sort()).toEqual(["Haft Seen Explained", "Nowruz Recipes", "Sizdah Bedar"]);});});
