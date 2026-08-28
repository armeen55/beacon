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
/** THE CARD SAYS WHAT HAPPENED; ONLY THE DIAGNOSIS SAYS WHAT THE PAGE LACKS (operator, 2026-08-28). caseCopy derives stage-honest headlines; gateOf turns a diagnosis into the one treatment it supports and names NO treatment without one; diagnoseGap binds the exact packet, funds every uncached attempt from the pass's own purse, and refuses a claim the packet cannot carry. */
describe("stage copy is honest and the diagnosis owns the treatment", () => {
  const { caseCopy, intentOf, readableSubject, gateOf } = AI_CASE_COPY;
  const standing = (over: Partial<Parameters<typeof caseCopy>[0]> = {}): Parameters<typeof caseCopy>[0] => ({ quoted: '"What animals live in Iran?"', path: "/iran-animals", intent: intentOf("What animals live in Iran?"), stage: "owned_retrieved_not_cited", domain: "rival.example", diagnosed: false, ...over });
  it("no case card carries a content strategy, a reading overclaim, or a raw fan-out as the thing to answer", () => {
    const rugs = caseCopy(standing({ quoted: '"What are Persian rugs known for?"', path: "/persian-rugs" }));
    for (const c of [caseCopy(standing()), rugs]) expect(`${c.headline} ${c.steps.join(" ")}`).not.toMatch(/English meaning|more formal|every expression|pair every|liftable|lift whole/i);
    expect(intentOf("What are basic Persian phrases for beginners?")).toBe("examples");
    expect(readableSubject("funny Persian idioms phrases examples")).toBe("funny Persian idioms phrases");
    expect(caseCopy(standing({ stage: "own_not_in_reported_sources" })).headline).not.toMatch(/\bread\b|passed over|opened/i); });
  const dx = (over: Record<string, unknown> = {}) => ({ kind: "already_answered", treatment: null, explanation: "The page lists every item with its meaning.", ownedIds: ["own-1"], evidenceIds: [], packet: "pk", contentHash: "h1", completeness: "complete", observationIds: ["o1"], version: 1, decidedAt: "2026-08-28T00:00:00.000Z", ...over }) as never;
  it("a refusing diagnosis mints no card, scatter hires on its own passages, missing information never hires, and an unruled case names no treatment at all", () => {
    expect(gateOf(dx())).toMatchObject({ emit: false, state: "monitoring", reason: expect.stringContaining("already answers this question") });
    expect(gateOf(dx({ kind: "unknown" }))).toMatchObject({ emit: false, reason: expect.stringContaining("no content change is authorized yet") });
    expect(gateOf(dx({ kind: "authority_or_source_gap", evidenceIds: ["ans-1"] }))).toMatchObject({ emit: false, reason: expect.stringContaining("no generic copy is ordered") });
    const scattered = gateOf(dx({ kind: "scattered_answer", treatment: "rewrite_existing_section", ownedIds: ["own-1", "own-4"] }));
    expect(scattered).toMatchObject({ emit: true, hire: true, treatment: "rewrite_existing_section", work: expect.stringContaining("structural synthesis of the page's own material") });
    expect((scattered as { work: string }).work).toContain("call to action"); // the CTA stays protected in the brief
    // MISSING INFORMATION NEVER HIRES: the writer would have to STATE the proposition, and nothing binds that exact statement to the facts that support it.
    expect(gateOf(dx({ kind: "missing_information", treatment: "add_answer_section", evidenceIds: ["ans-1"], missing: "the date rule" }))).toMatchObject({ emit: true, hire: false, next: expect.stringContaining("acquires an authoritative source") });
    expect(gateOf(null)).toMatchObject({ emit: true, hire: false, treatment: null, work: expect.stringContaining("no copy is ordered") }); }); });
/** THE READER'S ANSWER IS CHECKED, ITS PACKET IS THE IDENTITY, AND EVERY UNCACHED ATTEMPT IS FUNDED. */
describe("the gap reader is exact, fail-closed and metered", () => {
  const { diagnoseGap, aeoMeter } = AI_CASE_COPY;
  const NOW = new Date("2026-08-28T00:00:00.000Z");
  const page = (over: Record<string, unknown> = {}) => ({ passages: ["The seven items and their meanings, listed.", "A second passage about the table."], faqs: [{ question: "What is it?", answer: "The table." }], completeness: "complete", contentHash: "h1", ...over });
  const ask = (over: Record<string, unknown> = {}) => diagnoseGap({ tenantId: "t", caseKey: "prompt:p1", query: "what is on the table", stage: "owned_retrieved_not_cited", pageUrl: "https://own.example/haft-seen", observationIds: ["o1"], passages: ["rival passage"], meter: aeoMeter(9), persist: true, now: NOW, ...over } as never);
  const drafted = (v: Record<string, unknown>) => ({ status: "drafted", value: { ownedIds: [], evidenceIds: [], missing: "", explanation: "e", ...v } });
  it("refuses ids nobody supplied, thin scatter, and every claim the packet cannot carry", async () => {
    net.body = page(); net.answer = drafted({ kind: "already_answered", ownedIds: ["own-9"] });
    expect(await ask(), "an id nobody supplied rules nothing").toBeNull();
    net.answer = drafted({ kind: "scattered_answer", ownedIds: ["own-1"] });
    expect(await ask(), "one passage is not scatter").toBeNull();
    net.body = page({ completeness: "sample_only" }); net.answer = drafted({ kind: "missing_information", evidenceIds: ["ans-1"], missing: "the 1979 rule" });
    expect((await ask())!, "absence against a sample degrades to unknown").toMatchObject({ kind: "unknown", treatment: null, limitation: expect.stringContaining("incomplete") });
    net.body = page(); net.answer = drafted({ kind: "reachability_gap" });
    expect((await ask())!, "no technical evidence, no reachability diagnosis").toMatchObject({ kind: "unknown", treatment: null });
    net.answer = drafted({ kind: "freshness_gap", evidenceIds: ["ans-1"], missing: "the rival is newer" });
    expect((await ask())!, "freshness needs a dated conflict, not a sentence").toMatchObject({ kind: "unknown", limitation: expect.stringContaining("dated conflict") });
    net.answer = drafted({ kind: "freshness_gap", evidenceIds: ["ans-1"], missing: "the credited page says 2024 and this one does not" });
    expect((await ask())!, "a year the model typed but no supplied passage contains proves nothing").toMatchObject({ kind: "unknown", treatment: null });
    net.answer = drafted({ kind: "authority_or_source_gap", evidenceIds: ["ans-1"] });
    expect((await ask())!, "passage text alone never establishes a publisher's standing").toMatchObject({ kind: "unknown", treatment: null, limitation: expect.stringContaining("typed source authority") });
    for (const kind of ["missing_information", "authority_or_source_gap", "freshness_gap"]) { // a fan-out packet carries no credited passage, so nothing outside the page is in evidence
      net.answer = drafted({ kind, evidenceIds: [], missing: "the 1979 rule" });
      expect((await ask({ passages: [] }))!, `${kind} without a credited passage`).toMatchObject({ kind: "unknown", treatment: null, limitation: expect.stringContaining("no credited passage") }); }
    net.answer = { status: "refused" };
    expect(await ask(), "an unruled reader moves nothing").toBeNull(); });
  it("binds the exact packet, funds every uncached attempt, and buys nothing unfunded", async () => {
    net.body = page(); net.answer = drafted({ kind: "already_answered", ownedIds: ["own-1"] }); net.calls = 0;
    const first = (await ask())!; expect(net.calls).toBe(1);
    expect([(await ask({ banked: first }))!.decidedAt, net.calls], "the same packet is served from the bank and buys nothing").toEqual([first.decidedAt, 1]);
    for (const [what, over] of [["an observation removed", { observationIds: [] }], ["an observation added", { observationIds: ["o1", "o2"] }], ["a changed credited passage", { passages: ["a different rival passage"] }], ["a different question", { query: "something else" }]] as const) {
      net.calls = 0;
      expect((await ask({ banked: first, ...over }))!.packet, what).not.toBe(first.packet);
      expect(net.calls, `${what} was re-earned`).toBe(1); }
    net.calls = 0;
    expect((await ask({ banked: { ...first, contentHash: "OLD", packet: "OLD" } }))!.decidedAt, "a moved page body is re-earned").toBe(NOW.toISOString());
    // THE WORDS ARE PART OF THE IDENTITY, not only a hash the crawler may never have stored.
    net.body = { ...page({ contentHash: null }) }; const noHashA = (await ask({ query: "hashless" }))!;
    net.body = { ...page({ contentHash: null }), passages: ["Entirely different words on the very same page.", "And a second different passage."] };
    expect((await ask({ query: "hashless" }))!.packet, "no content hash, changed words: a different packet").not.toBe(noHashA.packet);
    const meter = aeoMeter(5); net.answer = drafted({ kind: "already_answered", ownedIds: ["own-9"] }); // every one refuses
    for (let i = 0; i < 5; i += 1) expect(await ask({ meter, query: `q${i}` })).toBeNull();
    net.calls = 0;
    expect(await ask({ meter, query: "the sixth" }), "unfunded: not bought").toBeNull();
    expect([net.calls, meter.spent()], "no sixth call however many refused, and the receipt says what the pass spent").toEqual([0, { funded: 5, attempted: 5, cached: 0, left: 0 }]);
    const cachedMeter = aeoMeter(2); net.calls = 0;
    net.answer = { status: "drafted", cached: true, value: { kind: "already_answered", ownedIds: ["own-1"], evidenceIds: [], missing: "", explanation: "e" } };
    await ask({ meter: cachedMeter, query: "cached one" });
    expect(cachedMeter.spent(), "a cache hit reached no provider, so it costs no unit").toMatchObject({ attempted: 0, cached: 1, left: 2 });
    net.calls = 0; net.answer = drafted({ kind: "already_answered", ownedIds: ["own-1"] });
    expect([await ask({ meter: aeoMeter(0), query: "unfunded" }), net.calls], "zero funded is zero bought").toEqual([null, 0]); }); });
