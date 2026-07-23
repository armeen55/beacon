/**
 * SOURCES — AI-visibility polling boundary (Core 100K lane S move).
 */
import { describe, it, expect } from "vitest";
import {
  rankRecurringDomains,
  rankRecurringPages,
  buildPresenceMatrix,
  findAnswerSentence,
  extractQuestionsFromAnswer,
  rollUpNativeQuestions,
  buildNativeIntelReport,
  type NativeObservationInput,
} from "@/domains/evidence/readers/native-intel";

function row(over: Partial<NativeObservationInput> = {}): NativeObservationInput {
  return {
    promptId: "p1",
    promptText: "what is the best persian rug",
    engine: "chatgpt",
    topic: "rugs",
    observedAt: "2026-07-01T09:00:00Z",
    answerText: "no answer text",
    citationDomains: [],
    citationUrls: [],
    trackedBrandMentioned: false,
    trackedBrandCited: false,
    ...over,
  };
}

describe("rankRecurringDomains - the people on the lists", () => {
  it("ranks by distinct prompts first, then total citation count", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", citationDomains: ["jozan.net", "rugman.com"] }),
      row({ promptId: "p2", citationDomains: ["jozan.net"] }),
      row({ promptId: "p3", citationDomains: ["rugman.com"] }),
      row({ promptId: "p3", engine: "perplexity", citationDomains: ["rugman.com"] }),
    ];
    const ranked = rankRecurringDomains(rows);
    // Both domains hit 2 distinct prompts; rugman.com wins the tiebreak on
    // total citation count (3 vs 2), so it sorts first.
    expect(ranked.map((d) => d.domain)).toEqual(["rugman.com", "jozan.net"]);
    const jozan = ranked.find((d) => d.domain === "jozan.net")!;
    expect(jozan.distinctPrompts).toBe(2);
    expect(jozan.citationCount).toBe(2);
    const rugman = ranked.find((d) => d.domain === "rugman.com")!;
    expect(rugman.distinctPrompts).toBe(2); // p1, p3
    expect(rugman.citationCount).toBe(3); // p1 once, p3 twice (2 engines)
    expect(rugman.engines).toEqual(["chatgpt", "perplexity"]);
  });

  it("excludes the tenant's own domain and subdomains", () => {
    const rows: NativeObservationInput[] = [
      row({ citationDomains: ["fixture-content.example", "en.fixture-content.example", "jozan.net"] }),
    ];
    const ranked = rankRecurringDomains(rows, { ownedRoot: "fixture-content.example" });
    expect(ranked.map((d) => d.domain)).toEqual(["jozan.net"]);
  });


  it("honest empty when no citations exist", () => {
    expect(rankRecurringDomains([row({ citationDomains: [] })])).toEqual([]);
  });

  it("excludes search-engine redirect/grounding-wrapper hosts (not a real recommended source)", () => {
    const rows: NativeObservationInput[] = [
      row({ engine: "gemini", citationDomains: ["vertexaisearch.cloud.google.com", "jozan.net"] }),
    ];
    const ranked = rankRecurringDomains(rows);
    expect(ranked.map((d) => d.domain)).toEqual(["jozan.net"]);
  });

});

describe("rankRecurringPages - the exact URLs cited repeatedly", () => {
  it("ranks exact URLs, keyed separately from their domain", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", citationUrls: ["https://jozan.net/guide-a"] }),
      row({ promptId: "p2", citationUrls: ["https://jozan.net/guide-a"] }),
      row({ promptId: "p3", citationUrls: ["https://jozan.net/guide-b"] }),
    ];
    const ranked = rankRecurringPages(rows);
    expect(ranked[0]!.url).toBe("https://jozan.net/guide-a");
    expect(ranked[0]!.distinctPrompts).toBe(2);
    expect(ranked[0]!.domain).toBe("jozan.net");
    expect(ranked[1]!.url).toBe("https://jozan.net/guide-b");
  });

  it("excludes the tenant's own pages", () => {
    const rows: NativeObservationInput[] = [
      row({ citationUrls: ["https://www.fixture-content.example/persian-rugs", "https://jozan.net/guide"] }),
    ];
    const ranked = rankRecurringPages(rows, { ownedRoot: "fixture-content.example" });
    expect(ranked.map((p) => p.url)).toEqual(["https://jozan.net/guide"]);
  });


  it("excludes search-engine redirect/grounding-wrapper URLs", () => {
    const rows: NativeObservationInput[] = [
      row({ citationUrls: ["https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", "https://jozan.net/guide"] }),
    ];
    expect(rankRecurringPages(rows).map((p) => p.url)).toEqual(["https://jozan.net/guide"]);
  });
});

describe("findAnswerSentence - the exact sentence naming the brand", () => {
  it("returns the sentence containing a brand variant", () => {
    const text = "Here are some options. Referencepedia has a great rug guide. It covers many styles.";
    expect(findAnswerSentence(text, ["Referencepedia"])).toBe("Referencepedia has a great rug guide.");
  });


  it("returns null when the brand is not present", () => {
    expect(findAnswerSentence("No mention of any brand here.", ["Referencepedia"])).toBeNull();
  });


});

describe("buildPresenceMatrix - we are / we are not", () => {
  it("marks presentAnywhere when any engine mentions or cites us", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", engine: "chatgpt", trackedBrandMentioned: false, trackedBrandCited: false, answerText: "no mention" }),
      row({
        promptId: "p1",
        engine: "perplexity",
        trackedBrandMentioned: true,
        trackedBrandCited: true,
        answerText: "Referencepedia has the best guide.",
      }),
    ];
    const matrix = buildPresenceMatrix(rows, { brandVariants: ["Referencepedia"] });
    expect(matrix.rows).toHaveLength(1);
    const p1 = matrix.rows[0]!;
    expect(p1.presentAnywhere).toBe(true);
    expect(p1.absentEverywhere).toBe(false);
    const pplx = p1.byEngine.find((c) => c.engine === "perplexity")!;
    expect(pplx.mentioned).toBe(true);
    expect(pplx.cited).toBe(true);
    expect(pplx.answerSentence).toBe("Referencepedia has the best guide.");
    const chatgpt = p1.byEngine.find((c) => c.engine === "chatgpt")!;
    expect(chatgpt.answerSentence).toBeNull();
  });

  it("marks absentEverywhere only when every checked engine is silent", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", engine: "chatgpt", trackedBrandMentioned: false, trackedBrandCited: false }),
      row({ promptId: "p1", engine: "gemini", trackedBrandMentioned: false, trackedBrandCited: false }),
    ];
    const matrix = buildPresenceMatrix(rows);
    expect(matrix.rows[0]!.absentEverywhere).toBe(true);
    expect(matrix.totals).toEqual({ promptsChecked: 1, present: 0, absent: 1 });
  });

  it("uses only the LATEST observation per (prompt, engine)", () => {
    const rows: NativeObservationInput[] = [
      row({
        promptId: "p1",
        engine: "chatgpt",
        observedAt: "2026-06-20T00:00:00Z",
        trackedBrandMentioned: true,
        trackedBrandCited: true,
        answerText: "Referencepedia used to be cited.",
      }),
      row({
        promptId: "p1",
        engine: "chatgpt",
        observedAt: "2026-07-01T00:00:00Z",
        trackedBrandMentioned: false,
        trackedBrandCited: false,
        answerText: "No longer mentioned.",
      }),
    ];
    const matrix = buildPresenceMatrix(rows, { brandVariants: ["Referencepedia"] });
    expect(matrix.rows[0]!.byEngine).toHaveLength(1);
    expect(matrix.rows[0]!.byEngine[0]!.mentioned).toBe(false);
  });

});

describe("extractQuestionsFromAnswer - native fanout source", () => {

  it("extracts list-formatted follow-up questions and strips the marker", () => {
    const text = "People also ask: 1. What is Nowruz? 2. When is Nowruz celebrated?";
    const qs = extractQuestionsFromAnswer(text);
    expect(qs).toContain("What is Nowruz?");
    expect(qs).toContain("When is Nowruz celebrated?");
  });



});

describe("rollUpNativeQuestions - ranked, deduped native fanouts", () => {
  it("ranks by how many distinct prompts raised the same follow-up question", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", answerText: "Intro. What is Nowruz? More text." }),
      row({ promptId: "p2", answerText: "Different intro. What is Nowruz? Other text." }),
      row({ promptId: "p3", answerText: "Something else. What is Chaharshanbe Suri? Text." }),
    ];
    const rolled = rollUpNativeQuestions(rows);
    expect(rolled[0]).toMatchObject({ text: "What is Nowruz?", weight: 2, sourcePrompts: ["p1", "p2"] });
    expect(rolled[1]).toMatchObject({ text: "What is Chaharshanbe Suri?" });
  });

  it("excludes a question that is just the source prompt repeated", () => {
    const rows: NativeObservationInput[] = [
      row({ promptId: "p1", promptText: "What is Nowruz?", answerText: "What is Nowruz? It is Persian New Year." }),
    ];
    expect(rollUpNativeQuestions(rows)).toEqual([]);
  });

  it("respects the limit option", () => {
    const rows: NativeObservationInput[] = Array.from({ length: 5 }, (_, i) =>
      row({ promptId: `p${i}`, answerText: `Intro text. What is topic ${i}? More.` }),
    );
    expect(rollUpNativeQuestions(rows, { limit: 2 })).toHaveLength(2);
  });

  it("honest empty when no answers contain questions", () => {
    expect(rollUpNativeQuestions([row({ answerText: "Just a plain statement." })])).toEqual([]);
  });
});

describe("buildNativeIntelReport - the combined report", () => {
  it("wires all four analyses together with honest coverage counts", () => {
    const rows: NativeObservationInput[] = [
      row({
        promptId: "p1",
        engine: "chatgpt",
        answerText: "Referencepedia has a great guide. What is Nowruz?",
        citationDomains: ["jozan.net"],
        citationUrls: ["https://jozan.net/guide"],
        trackedBrandMentioned: true,
        trackedBrandCited: false,
      }),
      row({
        promptId: "p2",
        engine: "perplexity",
        answerText: "No mention here.",
        citationDomains: ["jozan.net"],
        citationUrls: ["https://jozan.net/other"],
        trackedBrandMentioned: false,
        trackedBrandCited: false,
      }),
    ];
    const report = buildNativeIntelReport(rows, { ownedRoot: "fixture-content.example", brandVariants: ["Referencepedia"] });
    expect(report.rowsScanned).toBe(2);
    expect(report.enginesSeen).toEqual(["chatgpt", "perplexity"]);
    expect(report.recurringDomains.map((d) => d.domain)).toEqual(["jozan.net"]);
    expect(report.recurringDomains[0]!.distinctPrompts).toBe(2);
    expect(report.recurringPages).toHaveLength(2);
    expect(report.presence.totals).toEqual({ promptsChecked: 2, present: 1, absent: 1 });
    expect(report.nativeQuestions.map((q) => q.text)).toEqual(["What is Nowruz?"]);
  });

  it("honest empty report for zero rows", () => {
    const report = buildNativeIntelReport([]);
    expect(report).toEqual({
      recurringDomains: [],
      recurringPages: [],
      presence: { rows: [], totals: { promptsChecked: 0, present: 0, absent: 0 } },
      nativeQuestions: [],
      rowsScanned: 0,
      enginesSeen: [],
    });
  });
});
