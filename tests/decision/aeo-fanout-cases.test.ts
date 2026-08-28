/** WHERE A SEARCH THE ASSISTANTS RAN ENDS UP (AEO terminal closure, 2026-08-19). Fan-outs used to decorate a card built from something else: the strongest recurring search in an account could sit in the canonical demand layer for ever and reach no page, no verdict, no draft and no refusal. These pins hold the one pure resolver both sides read, so the queue and the screen can never disagree about a search, and so no material search can quietly terminate nowhere. The resolver is EVIDENCE ONLY on purpose: a search that had to consult the queue to decide whether the queue should hold it could never produce the first card. */
import { describe, expect, it, vi } from "vitest";
const net = vi.hoisted(() => ({ calls: 0, answer: null as unknown, body: null as unknown }));
vi.mock("@/domains/decision/llm/structured-drafter", () => ({ callStructuredLLM: async () => { net.calls += 1; return net.answer; } }));
vi.mock("@/domains/evidence/pages/owned-context", () => ({ loadOwnedPageBodies: async (_t: string, urls: string[]) => {
  const { canonicalUrlKey } = await import("@/domains/evidence/snapshot");
  return new Map(net.body ? urls.map((u) => [canonicalUrlKey(u), net.body]) : []); } }));
import { AI_CASE_COPY, resolveFanoutCase } from "@/domains/decision/producers/ai-cases";
import { buildFanoutEvidence, type FanoutSourceObservation } from "@/domains/evidence/ai-visibility/fanout-evidence";
const SITE = "own.example";
const OWN = { url: "https://own.example/haft-seen", domain: "own.example" };
const RIVAL = { url: "https://rival.example/a", domain: "rival.example" };
const obs = (over: Partial<FanoutSourceObservation> = {}): FanoutSourceObservation => ({
  observationId: `o-${over.reportingDay ?? "d"}-${over.engine ?? "e"}-${over.promptId ?? "p"}`,
  promptId: "p1", promptText: "where do families buy a haft seen set", engine: "chatgpt", reportingDay: "2026-08-01",
  observationMode: "consumer_search", fanOutQueries: ["haft seen set delivery"], citations: [RIVAL], retrievedResults: null, ...over });
const recurring = (over: Partial<FanoutSourceObservation> = {}) =>
  ["2026-08-01", "2026-08-02", "2026-08-03"].map((reportingDay) => obs({ reportingDay, ...over }));
const rowOf = (rows: FanoutSourceObservation[]) => buildFanoutEvidence(rows, SITE).rows[0]!;
const spread = () => [obs({ reportingDay: "2026-08-01" }), obs({ reportingDay: "2026-08-02" }),
  obs({ reportingDay: "2026-08-02", engine: "gemini", observationMode: "standardized_response" })];
describe("every material search the assistants ran terminates somewhere a person can see", () => {
  it("reaches an actionable case once a second assistant joins, with no Google query behind it", () => {
    const c = resolveFanoutCase(rowOf(spread()), { pageUrl: "https://own.example/haft-seen", refused: false }); expect([c.state, c.stage]).toEqual(["actionable", "rivals_cited_own_not_retrieved"]);
    expect(c.caseKey).toMatch(/^fanout:/); // the canonical identity a Change is joined on, never the wording
    expect(c.reason).toContain("2 assistants");});
  it("holds a search that only repeated to monitoring: days alone are an assistant's habit, not demand", () => {
    // The exact shape days>=3 used to mint work from (Codex, 2026-08-21): watched, missing dimension named.
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: "https://own.example/haft-seen", refused: false }); expect(c.state).toBe("monitoring");
    expect(c.reason).toContain("one question and one assistant");});
  it("lets real Google demand corroborate the same repetition into work", () => {
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: "https://own.example/haft-seen", refused: false }, { googleDemand: true }); expect(c.state).toBe("actionable");
    expect(c.reason).toContain("people ask Google the same thing");});
  it("stages a search that already reads a page here as liftability, not discoverability", () => {
    const c = resolveFanoutCase(rowOf(recurring({ retrievedResults: [OWN] })), { pageUrl: OWN.url, refused: false }); expect(c.stage).toBe("owned_retrieved_not_cited");
    expect(c.reason).toContain("read for it and passed over");});
  it("degrades a reading claim to a reliance claim where no instrument reports retrieval", () => {
    const responses = ["2026-08-01", "2026-08-02", "2026-08-03"].map((reportingDay, i) =>
      obs({ reportingDay, engine: i === 0 ? "claude" : "perplexity", observationMode: "standardized_response" }));
    const c = resolveFanoutCase(rowOf(responses), { pageUrl: OWN.url, refused: false }); expect([c.state, c.stage]).toEqual(["actionable", "own_not_in_reported_sources"]);
    expect(c.reason).toContain("not among the sources"); expect(c.reason).not.toContain("reports reading");});
  it("ends a one-off as monitoring, and a spread search as work", () => {
    const once = resolveFanoutCase(rowOf([obs()])); expect(once.state).toBe("monitoring");
    expect(once.reason).toContain("not a pattern yet"); expect(resolveFanoutCase(rowOf(spread())).state).not.toBe("monitoring");});
  it("ends as an explicit no-page verdict when no page of this account is for it", () => {
    const c = resolveFanoutCase(rowOf(spread()), { pageUrl: null, refused: true }); expect(c.state).toBe("no_page");
    expect(c.reason).toContain("no page of this account is for it");
    expect(c.reason).toContain("pages to build"); // a verdict with a next step, never a dead end
  });
  it("ends as already credited when this site is the one being cited, and asks for no work", () => {
    const c = resolveFanoutCase(rowOf(recurring({ citations: [OWN] })), { pageUrl: OWN.url, refused: false }); expect(c.state).toBe("already_credited");
    expect(c.reason).toContain("watch that it holds");});
  it("ends as unreported when the answers never said what they used, and never as a zero", () => {
    const c = resolveFanoutCase(rowOf(recurring({ citations: null })), { pageUrl: OWN.url, refused: false }); expect(c.state).toBe("unreported");
    expect(c.reason).toContain("missing reporting, not a zero");});
  it("leaves no material search unaccounted for across a mixed set", () => {
    const world = [
      ...recurring({ fanOutQueries: ["haft seen set delivery"], engine: "gemini", observationMode: "standardized_response" }),
      ...recurring({ fanOutQueries: ["haft seen set delivery"] }).slice(0, 1),
      ...recurring({ fanOutQueries: ["nowruz table meaning"], citations: [OWN] }),
      ...recurring({ fanOutQueries: ["sabzeh how to grow"], retrievedResults: [OWN] }),
      ...recurring({ fanOutQueries: ["haft seen history"], citations: null }),
      ...recurring({ fanOutQueries: ["repeats on one assistant"] }),
      obs({ fanOutQueries: ["one off curiosity"] }),];
    const rows = buildFanoutEvidence(world, SITE).rows; const material = rows.filter((r) => r.material);
    expect(material.length).toBe(5); const states = material.map((r) => resolveFanoutCase(r, { pageUrl: OWN.url, refused: false }).state);
    // Everything with a second dimension terminates in a verdict; the repeats-only cluster is watched.
    expect(new Set(states)).toEqual(new Set(["actionable", "already_credited", "unreported", "monitoring"])); expect(states.filter((s) => s === "monitoring").length).toBe(1);
    expect(resolveFanoutCase(rows.find((r) => !r.material)!).state).toBe("monitoring");});
  it("keys a case on identity, so a search that merely reads like another one is a different case", () => {
    const a = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["haft seen set delivery"] }))); const b = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["Haft Seen set delivery?"] })));
    const other = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["haft seen set prices"] })));
    expect(a.caseKey).toBe(b.caseKey); // a capital letter and a question mark are the SAME search
    expect(a.caseKey).not.toBe(other.caseKey);});});
/** THE CARD SAYS WHAT HAPPENED; ONLY THE DIAGNOSIS SAYS WHAT THE PAGE LACKS (operator, 2026-08-28). caseCopy derives stage-honest headlines and steps; gateOf turns a banked or freshly ruled diagnosis into the one treatment it supports, and an unruled case keeps its card without hiring the writer. diagnoseGap validates the reader hard: only supplied ids, absence only against a complete page, scatter only across separate passages, reachability never without technical evidence. */
describe("stage copy is honest and the diagnosis owns the treatment", () => {
  const { caseCopy, intentOf, readableSubject, gateOf } = AI_CASE_COPY;
  const standing = (over: Partial<Parameters<typeof caseCopy>[0]> = {}): Parameters<typeof caseCopy>[0] => ({ quoted: '"What animals live in Iran?"', path: "/iran-animals", intent: intentOf("What animals live in Iran?"), stage: "owned_retrieved_not_cited", domain: "rival.example", ...over });
  it("no case card carries a content strategy, a reading overclaim, or a raw fan-out as the thing to answer", () => {
    const rugs = caseCopy(standing({ quoted: '"What are Persian rugs known for?"', path: "/persian-rugs" }));
    for (const c of [caseCopy(standing()), rugs]) expect(`${c.headline} ${c.steps.join(" ")}`).not.toMatch(/English meaning|more formal|every expression|pair every|liftable/i);
    expect(intentOf("What are basic Persian phrases for beginners?")).toBe("examples"); // the shape rides the drafter seam by intent, never a topic recipe
    expect(readableSubject("funny Persian idioms phrases examples")).toBe("funny Persian idioms phrases");
    expect(caseCopy(standing({ stage: "own_not_in_reported_sources" })).headline).not.toMatch(/\bread\b|passed over|opened/i); }); // no reading claim where reading is not reported
  const dx = (over: Record<string, unknown> = {}) => ({ kind: "already_answered", treatment: null, explanation: "The page lists every item with its meaning.", ownedIds: ["own-1"], evidenceIds: [], contentHash: "h1", completeness: "complete", observationIds: ["o1"], version: 1, decidedAt: "2026-08-28T00:00:00.000Z", ...over }) as never;
  it("a refusing diagnosis mints no card, an authorizing one names the treatment, and an unruled case never hires", () => {
    const answered = gateOf(dx(), "rewrite_existing_section", false);
    expect([answered.emit, (answered as { state: string }).state, (answered as { reason: string }).reason]).toEqual([false, "monitoring", expect.stringContaining("already answers this question")]);
    expect(gateOf(dx({ kind: "unknown" }), "add_answer_section", false)).toMatchObject({ emit: false, reason: expect.stringContaining("no content change is authorized yet") });
    expect(gateOf(dx({ kind: "authority_or_source_gap", evidenceIds: ["ans-1"] }), "add_answer_section", false)).toMatchObject({ emit: false, reason: expect.stringContaining("no generic copy is ordered") }); // same information, stronger rival: never an answer block
    const scattered = gateOf(dx({ kind: "scattered_answer", treatment: "rewrite_existing_section", ownedIds: ["own-1", "own-4"] }), "add_answer_section", false);
    expect(scattered).toMatchObject({ emit: true, hire: true, treatment: "rewrite_existing_section", work: expect.stringContaining("structural synthesis of the page's own material") });
    expect((scattered as { work: string }).work).toContain("call to action"); // the CTA stays protected in the work brief
    expect(gateOf(dx({ kind: "missing_information", treatment: "add_answer_section", evidenceIds: ["ans-1"], missing: "the festival's date rule" }), "add_answer_section", false)).toMatchObject({ emit: true, hire: false, next: expect.stringContaining("acquires an authoritative source") }); // rival text stays briefing; acquisition first
    expect(gateOf(dx({ kind: "missing_information", treatment: "add_answer_section", evidenceIds: ["ans-1"], missing: "the date rule" }), "add_answer_section", true)).toMatchObject({ emit: true, hire: true });
    expect(gateOf(null, "rewrite_existing_section", false)).toMatchObject({ emit: true, hire: false, work: expect.stringContaining("no copy is ordered") }); }); }); // unruled: the card stays, the writer is never hired
/** THE READER IS VALIDATED HARD AFTER IT ANSWERS, and an unruled reader moves nothing. */
describe("the gap reader's answer is checked, never trusted", () => {
  const { diagnoseGap } = AI_CASE_COPY;
  const NOW = new Date("2026-08-28T00:00:00.000Z");
  const page = (over: Record<string, unknown> = {}) => ({ passages: ["The seven items and their meanings, listed."], faqs: [{ question: "What is it?", answer: "The table." }], completeness: "complete", contentHash: "h1", ...over });
  const ask = (banked?: unknown) => diagnoseGap({ tenantId: "t", query: "what is on the table", stage: "owned_retrieved_not_cited", pageUrl: "https://own.example/haft-seen", observationIds: ["o1"], passages: ["rival passage"], banked: banked as never, persist: true, now: NOW });
  const drafted = (v: Record<string, unknown>) => ({ status: "drafted", value: { ownedIds: [], evidenceIds: [], missing: "", explanation: "e", ...v } });
  it("only supplied ids rule, absence needs a complete page, scatter needs separate passages, and reachability needs technical evidence", async () => {
    net.body = page();
    net.answer = drafted({ kind: "already_answered", ownedIds: ["own-9"] });
    expect(await ask(), "an id nobody supplied rules nothing").toBeNull();
    net.answer = drafted({ kind: "scattered_answer", ownedIds: ["own-1"] });
    expect(await ask(), "one passage is not scatter").toBeNull();
    net.body = page({ completeness: "sample_only" });
    net.answer = drafted({ kind: "missing_information", evidenceIds: ["ans-1"], missing: "the date rule" });
    expect((await ask())!, "absence against a sample degrades to unknown with the recrawl owed").toMatchObject({ kind: "unknown", treatment: null, limitation: expect.stringContaining("incomplete") });
    net.body = page();
    net.answer = drafted({ kind: "reachability_gap" });
    expect((await ask())!, "no technical evidence, no reachability diagnosis").toMatchObject({ kind: "unknown", treatment: null });
    net.answer = { status: "refused" };
    expect(await ask(), "an unruled reader moves nothing").toBeNull(); });
  it("a fresh banked reading is served without a call, and a stale one is re-earned", async () => {
    net.body = page(); net.calls = 0;
    const banked = { kind: "already_answered", treatment: null, explanation: "e", ownedIds: ["own-1"], evidenceIds: [], contentHash: "h1", completeness: "complete", observationIds: ["o1"], version: 1, decidedAt: "2026-08-27T00:00:00.000Z" };
    expect([(await ask(banked))!.kind, net.calls], "fresh: served, nothing bought").toEqual(["already_answered", 0]);
    net.answer = drafted({ kind: "already_answered", ownedIds: ["own-1"] });
    expect([(await ask({ ...banked, contentHash: "OLD" }))!.decidedAt, net.calls], "the page moved: re-earned through the reader").toEqual([NOW.toISOString(), 1]); }); });
