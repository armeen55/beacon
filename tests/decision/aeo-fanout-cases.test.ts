/** WHERE A SEARCH THE ASSISTANTS RAN ENDS UP (AEO terminal closure, 2026-08-19). Fan-outs used to decorate a
 *  card built from something else: the strongest recurring search in an account could sit in the canonical
 *  demand layer for ever and reach no page, no verdict, no draft and no refusal. These pins hold the one pure
 *  resolver both sides read, so the queue and the screen can never disagree about a search, and so no material
 *  search can quietly terminate nowhere. The resolver is EVIDENCE ONLY on purpose: a search that had to consult
 *  the queue to decide whether the queue should hold it could never produce the first card. */
import { describe, expect, it } from "vitest";
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
    const c = resolveFanoutCase(rowOf(spread()), { pageUrl: "https://own.example/haft-seen", refused: false });
    expect([c.state, c.stage]).toEqual(["actionable", "rivals_cited_own_not_retrieved"]);
    expect(c.caseKey).toMatch(/^fanout:/); // the canonical identity a Change is joined on, never the wording
    expect(c.reason).toContain("2 assistants");
  });
  it("holds a search that only repeated to monitoring: days alone are an assistant's habit, not demand", () => {
    // The exact shape days>=3 used to mint work from (Codex, 2026-08-21): watched, missing dimension named.
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: "https://own.example/haft-seen", refused: false });
    expect(c.state).toBe("monitoring");
    expect(c.reason).toContain("one question and one assistant");
  });
  it("lets real Google demand corroborate the same repetition into work", () => {
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: "https://own.example/haft-seen", refused: false }, { googleDemand: true });
    expect(c.state).toBe("actionable");
    expect(c.reason).toContain("people ask Google the same thing");
  });
  it("stages a search that already reads a page here as liftability, not discoverability", () => {
    const c = resolveFanoutCase(rowOf(recurring({ retrievedResults: [OWN] })), { pageUrl: OWN.url, refused: false });
    expect(c.stage).toBe("owned_retrieved_not_cited");
    expect(c.reason).toContain("read for it and passed over");
  });
  it("degrades a reading claim to a reliance claim where no instrument reports retrieval", () => {
    const responses = ["2026-08-01", "2026-08-02", "2026-08-03"].map((reportingDay, i) =>
      obs({ reportingDay, engine: i === 0 ? "claude" : "perplexity", observationMode: "standardized_response" }));
    const c = resolveFanoutCase(rowOf(responses), { pageUrl: OWN.url, refused: false });
    expect([c.state, c.stage]).toEqual(["actionable", "own_not_in_reported_sources"]);
    expect(c.reason).toContain("not among the sources");
    expect(c.reason).not.toContain("reports reading");
  });
  it("ends a one-off as monitoring, and a spread search as work", () => {
    const once = resolveFanoutCase(rowOf([obs()]));
    expect(once.state).toBe("monitoring");
    expect(once.reason).toContain("not a pattern yet");
    expect(resolveFanoutCase(rowOf(spread())).state).not.toBe("monitoring");
  });
  it("ends as an explicit no-page verdict when no page of this account is for it", () => {
    const c = resolveFanoutCase(rowOf(spread()), { pageUrl: null, refused: true });
    expect(c.state).toBe("no_page");
    expect(c.reason).toContain("no page of this account is for it");
    expect(c.reason).toContain("pages to build"); // a verdict with a next step, never a dead end
  });
  it("ends as already credited when this site is the one being cited, and asks for no work", () => {
    const c = resolveFanoutCase(rowOf(recurring({ citations: [OWN] })), { pageUrl: OWN.url, refused: false });
    expect(c.state).toBe("already_credited");
    expect(c.reason).toContain("watch that it holds");
  });
  it("ends as unreported when the answers never said what they used, and never as a zero", () => {
    const c = resolveFanoutCase(rowOf(recurring({ citations: null })), { pageUrl: OWN.url, refused: false });
    expect(c.state).toBe("unreported");
    expect(c.reason).toContain("missing reporting, not a zero");
  });
  it("leaves no material search unaccounted for across a mixed set", () => {
    const world = [
      ...recurring({ fanOutQueries: ["haft seen set delivery"], engine: "gemini", observationMode: "standardized_response" }),
      ...recurring({ fanOutQueries: ["haft seen set delivery"] }).slice(0, 1),
      ...recurring({ fanOutQueries: ["nowruz table meaning"], citations: [OWN] }),
      ...recurring({ fanOutQueries: ["sabzeh how to grow"], retrievedResults: [OWN] }),
      ...recurring({ fanOutQueries: ["haft seen history"], citations: null }),
      ...recurring({ fanOutQueries: ["repeats on one assistant"] }),
      obs({ fanOutQueries: ["one off curiosity"] }),
    ];
    const rows = buildFanoutEvidence(world, SITE).rows;
    const material = rows.filter((r) => r.material);
    expect(material.length).toBe(5);
    const states = material.map((r) => resolveFanoutCase(r, { pageUrl: OWN.url, refused: false }).state);
    // Everything with a second dimension terminates in a verdict; the repeats-only cluster is watched.
    expect(new Set(states)).toEqual(new Set(["actionable", "already_credited", "unreported", "monitoring"]));
    expect(states.filter((s) => s === "monitoring").length).toBe(1);
    expect(resolveFanoutCase(rows.find((r) => !r.material)!).state).toBe("monitoring");
  });
  it("keys a case on identity, so a search that merely reads like another one is a different case", () => {
    const a = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["haft seen set delivery"] })));
    const b = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["Haft Seen set delivery?"] })));
    const other = resolveFanoutCase(rowOf(recurring({ fanOutQueries: ["haft seen set prices"] })));
    expect(a.caseKey).toBe(b.caseKey); // a capital letter and a question mark are the SAME search
    expect(a.caseKey).not.toBe(other.caseKey);
  });
});

/** THE BRIEF DERIVES FROM THE ANSWER INTENT AND THE STAGE, NEVER FROM A TOPIC STRATEGY (operator, 2026-08-21): a phrase-page recipe hardcoded in the producer shipped on wildlife and rug cards. */
describe("no case card carries a content strategy written for another page", () => {
  const { caseCopy, intentOf, readableSubject } = AI_CASE_COPY;
  const standing = (over: Partial<Parameters<typeof caseCopy>[0]> = {}): Parameters<typeof caseCopy>[0] => ({
    voice: "What animals live in Iran?", quoted: '"What animals live in Iran?"', path: "/iran-animals",
    intent: intentOf("What animals live in Iran?"), stage: "owned_retrieved_not_cited",
    retrievedNotCited: 3, domain: "rival.example", covers: "iran, animals", factLine: null, ...over });
  it("a wildlife case and a rug case never inherit language-learning instructions", () => {
    const rugs = standing({ quoted: '"What are Persian rugs known for?"', path: "/persian-rugs", intent: intentOf("What are Persian rugs known for?") });
    for (const c of [caseCopy(standing()), caseCopy(rugs)]) {
      expect(`${c.headline} ${c.after} ${c.steps.join(" ")}`).not.toMatch(/English meaning|more formal|every expression|pair every/i);
    }
    expect(intentOf("What are Persian rugs known for?")).toBe("definition");
    expect(caseCopy(rugs).after).toContain("the definition in the first sentence");
  });
  it("a phrase question earns the list shape from its own intent, not from its topic", () => {
    expect(intentOf("What are basic Persian phrases for beginners?")).toBe("examples");
    expect(caseCopy(standing({ intent: "examples" })).after).toContain("each on its own line");
  });
  it("a raw fan-out is quoted as evidence and never pasted as the thing to answer", () => {
    expect(readableSubject("funny Persian idioms phrases examples")).toBe("funny Persian idioms phrases");
    const c = caseCopy(standing({ quoted: "searches for funny Persian idioms phrases" }));
    expect(c.after).not.toContain("funny Persian idioms phrases examples");
    expect(c.after).toContain("answers searches for funny Persian idioms phrases");
  });
  it("a case with no reported retrieval claims no reading and nothing passed over", () => {
    const c = caseCopy(standing({ stage: "own_not_in_reported_sources", retrievedNotCited: 0 }));
    expect(c.headline).not.toMatch(/\bread\b|passed over|opened/i);
    expect(c.after).not.toMatch(/passed over|already open/);
    expect(c.after).toContain("whether this page was read is unknown");
  });
});
