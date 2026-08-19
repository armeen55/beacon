import { describe, expect, it } from "vitest";
import { buildFanoutEvidence, ownedPageAiRollup, type FanoutSourceObservation } from "@/domains/evidence/ai-visibility/fanout-evidence";

/** THE ONE DERIVED FAN-OUT PROJECTION (AEO reconstruction, 2026-08-19). Visibility renders it and Decision consumes it off the SAME pure function, so these pins hold both surfaces at once: recurrence is DISTINCT days, assistants and parent questions and never raw rows; a prompt echo is never the assistant's own search; where the site stood is a four-way fact with an honest reporting denominator; and unknown stays unknown, never zero. */
const SITE = "own.example";
const obs = (over: Partial<FanoutSourceObservation> = {}): FanoutSourceObservation => ({
  observationId: `o-${Math.abs(JSON.stringify(over).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}-${over.reportingDay ?? "d"}-${over.engine ?? "e"}-${over.promptId ?? "p"}`,
  promptId: "p1", promptText: "where to buy a haft seen set", engine: "chatgpt", reportingDay: "2026-08-01",
  fanOutQueries: ["haft seen set delivery"], citations: [{ url: "https://rival.example/a", domain: "rival.example" }], retrievedResults: null, ...over });

describe("recurrence is distinct days and assistants, never row totals", () => {
  it("counts five same-day same-engine executions as ONE day and ONE assistant, and it is not material", () => {
    const rows = Array.from({ length: 5 }, (_, i) => obs({ observationId: `o${i}` }));
    const [r] = buildFanoutEvidence(rows, SITE).rows;
    expect([r!.executions, r!.days, r!.engines, r!.parents.length, r!.material]).toEqual([5, 1, ["chatgpt"], 1, false]);
  });
  it("earns materiality on three days OR two assistants OR two parent questions, exactly", () => {
    const days = ["2026-08-01", "2026-08-02", "2026-08-03"].map((d, i) => obs({ observationId: `d${i}`, reportingDay: d }));
    expect(buildFanoutEvidence(days, SITE).rows[0]!.material).toBe(true);
    const engines = ["chatgpt", "gemini"].map((e, i) => obs({ observationId: `e${i}`, engine: e }));
    expect(buildFanoutEvidence(engines, SITE).rows[0]!.material).toBe(true);
    const parents = [obs({ observationId: "p1o" }), obs({ observationId: "p2o", promptId: "p2", promptText: "what goes on a haft seen table" })];
    expect(buildFanoutEvidence(parents, SITE).rows[0]!.material).toBe(true);
    expect(buildFanoutEvidence([obs({})], SITE).rows[0]!.material).toBe(false); // one sighting is watched, never work
  });
  it("never lists the tracked question itself as a search the assistant thought of", () => {
    const echo = obs({ fanOutQueries: ["Where to buy a haft seen set?", "haft seen set delivery"] });
    const rows = buildFanoutEvidence([echo], SITE).rows;
    expect(rows.map((r) => r.query)).toEqual(["haft seen set delivery"]);
  });
});

describe("where the site stood is four different worlds, with an honest denominator", () => {
  it("says cited, read and passed over, never you, or unreported, off the same rows Visibility renders", () => {
    const cited = obs({ citations: [{ url: "https://own.example/haft-seen", domain: "own.example" }] });
    expect(buildFanoutEvidence([cited], SITE).rows[0]!.ownState).toBe("cited");
    const rnc = obs({ retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] });
    expect(buildFanoutEvidence([rnc], SITE).rows[0]!.ownState).toBe("retrieved_not_cited");
    expect(buildFanoutEvidence([obs({})], SITE).rows[0]!.ownState).toBe("not_retrieved");
    const silent = obs({ citations: null });
    const [u] = buildFanoutEvidence([silent], SITE).rows;
    expect([u!.ownState, u!.reportingAnswers]).toEqual(["unreported", 0]); // missing reporting is a state, never a zero share
  });
  it("keeps the reporting denominator beside every claim and ranks rivals by answers crediting them", () => {
    const rows = [obs({ observationId: "a" }), obs({ observationId: "b", engine: "gemini", citations: null })];
    const [r] = buildFanoutEvidence(rows, SITE).rows;
    expect([r!.executions, r!.reportingAnswers, r!.rivalPages[0]!.domain]).toEqual([2, 1, "rival.example"]);
  });
  it("rolls up each owned page's cited, read, and read-passed-over counts from the same canonical rows", () => {
    const rows = [
      obs({ observationId: "r1", citations: [{ url: "https://own.example/haft-seen", domain: "own.example" }], retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }),
      obs({ observationId: "r2", engine: "gemini", retrievedResults: [{ url: "https://own.example/haft-seen", domain: "own.example" }] }),
    ];
    const [p] = ownedPageAiRollup(rows, SITE);
    expect([p!.url, p!.cited, p!.retrieved, p!.retrievedNotCited, p!.engines]).toEqual(["https://own.example/haft-seen", 1, 2, 1, ["chatgpt", "gemini"]]);
  });
});
