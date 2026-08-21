/** WHERE A SEARCH THE ASSISTANTS RAN ENDS UP (AEO terminal closure, 2026-08-19). Fan-outs used to decorate a
 *  card built from something else: the strongest recurring search in an account could sit in the canonical
 *  demand layer for ever and reach no page, no verdict, no draft and no refusal. These pins hold the one pure
 *  resolver both sides read, so the queue and the screen can never disagree about a search, and so no material
 *  search can quietly terminate nowhere. The resolver is EVIDENCE ONLY on purpose: a search that had to consult
 *  the queue to decide whether the queue should hold it could never produce the first card. */
import { describe, expect, it } from "vitest";
import { resolveFanoutCase } from "@/domains/decision/producers/ai-cases";
import { buildFanoutEvidence, type FanoutSourceObservation } from "@/domains/evidence/ai-visibility/fanout-evidence";

const SITE = "own.example";
const OWN = { url: "https://own.example/haft-seen", domain: "own.example" };
const RIVAL = { url: "https://rival.example/a", domain: "rival.example" };
const obs = (over: Partial<FanoutSourceObservation> = {}): FanoutSourceObservation => ({
  observationId: `o-${over.reportingDay ?? "d"}-${over.engine ?? "e"}-${over.promptId ?? "p"}`,
  promptId: "p1", promptText: "where do families buy a haft seen set", engine: "chatgpt", reportingDay: "2026-08-01",
  fanOutQueries: ["haft seen set delivery"], citations: [RIVAL], retrievedResults: null, ...over });
/** A search that genuinely recurred: three separate days, which is the cheapest honest pattern. */
const recurring = (over: Partial<FanoutSourceObservation> = {}) =>
  ["2026-08-01", "2026-08-02", "2026-08-03"].map((reportingDay) => obs({ reportingDay, ...over }));
const rowOf = (rows: FanoutSourceObservation[]) => buildFanoutEvidence(rows, SITE).rows[0]!;

describe("every material search the assistants ran terminates somewhere a person can see", () => {
  it("reaches an actionable case with no Google query and no tracked question behind it", () => {
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: "https://own.example/haft-seen", refused: false });
    expect([c.state, c.stage]).toEqual(["actionable", "rivals_cited_own_not_retrieved"]);
    expect(c.caseKey).toMatch(/^fanout:/); // the canonical identity a Change is joined on, never the wording
    expect(c.reason).toContain("3 separate days");
  });
  it("stages a search that already reads a page here as liftability, not discoverability", () => {
    const c = resolveFanoutCase(rowOf(recurring({ retrievedResults: [OWN] })), { pageUrl: OWN.url, refused: false });
    expect(c.stage).toBe("owned_retrieved_not_cited");
    expect(c.reason).toContain("read for it and passed over");
  });
  it("ends a one-off as monitoring, and never a material one", () => {
    const once = resolveFanoutCase(rowOf([obs()]));
    expect(once.state).toBe("monitoring");
    expect(once.reason).toContain("not a pattern yet");
    expect(resolveFanoutCase(rowOf(recurring())).state).not.toBe("monitoring");
  });
  it("ends as an explicit no-page verdict when no page of this account is for it", () => {
    const c = resolveFanoutCase(rowOf(recurring()), { pageUrl: null, refused: true });
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
    // Five clusters, one of each kind the evidence can produce, plus one that never recurred.
    const world = [
      ...recurring({ fanOutQueries: ["haft seen set delivery"] }),
      ...recurring({ fanOutQueries: ["nowruz table meaning"], citations: [OWN] }),
      ...recurring({ fanOutQueries: ["sabzeh how to grow"], retrievedResults: [OWN] }),
      ...recurring({ fanOutQueries: ["haft seen history"], citations: null }),
      obs({ fanOutQueries: ["one off curiosity"] }),
    ];
    const rows = buildFanoutEvidence(world, SITE).rows;
    const material = rows.filter((r) => r.material);
    expect(material.length).toBe(4);
    // A page is found for every actionable one in this fixture, so nothing here may come back as monitoring.
    const states = material.map((r) => resolveFanoutCase(r, { pageUrl: OWN.url, refused: false }).state);
    expect(states.filter((s) => s === "monitoring")).toEqual([]);
    expect(new Set(states)).toEqual(new Set(["actionable", "already_credited", "unreported"]));
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
