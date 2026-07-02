import { describe, it, expect } from "vitest";
import { checkTopicCoherence, gateCreatePageCandidate } from "./topic-coherence-gate";

describe("checkTopicCoherence", () => {
  it("operator ground-truth: drops superstitions/sports/names members glued onto a travel head topic", () => {
    const v = checkTopicCoherence("Travel Iran Beautiful Natural Wonders", [
      { id: "q1", text: "most beautiful natural places in Iran" },
      { id: "q2", text: "superstitions in Iran" },
      { id: "q3", text: "most popular sports in Iran" },
      { id: "q4", text: "most common name in Iran" },
    ]);
    expect(v.kept.map((m) => m.id)).toEqual(["q1"]);
    expect(v.dropped.map((m) => m.id)).toEqual(["q2", "q3", "q4"]);
    // only 1/4 on-topic -> suppress the whole candidate, don't just trim it
    expect(v.suppressCandidate).toBe(true);
  });

  it("keeps a coherent cluster intact (all members share the head topic's subject)", () => {
    const v = checkTopicCoherence("Persian Wedding Traditions", [
      { id: "q1", text: "persian wedding ceremony sofreh aghd" },
      { id: "q2", text: "iranian wedding customs" },
      { id: "q3", text: "traditional persian wedding dress" },
    ]);
    expect(v.dropped.length).toBe(0);
    expect(v.suppressCandidate).toBe(false);
  });

  it("trims a minority of off-topic members without suppressing the whole candidate", () => {
    const v = checkTopicCoherence("Nowruz Persian New Year", [
      { id: "q1", text: "nowruz traditions" },
      { id: "q2", text: "nowruz haft-sin table" },
      { id: "q3", text: "nowruz food recipes" },
      { id: "q4", text: "unrelated topic about football scores" },
    ]);
    expect(v.dropped.map((m) => m.id)).toEqual(["q4"]);
    expect(v.kept.length).toBe(3);
    expect(v.suppressCandidate).toBe(false);
  });

  it("does not judge coherence when the head topic itself has no distinguishing tokens (unverifiable, kept)", () => {
    const v = checkTopicCoherence("Iran", [{ id: "q1", text: "anything at all" }]);
    expect(v.suppressCandidate).toBe(false);
    expect(v.kept.length).toBe(1);
    expect(v.dropped.length).toBe(0);
  });

  it("handles an empty member list without throwing", () => {
    const v = checkTopicCoherence("Persian Gardens", []);
    expect(v.kept).toEqual([]);
    expect(v.suppressCandidate).toBe(false);
  });
});

describe("gateCreatePageCandidate", () => {
  it("filters incoherent competitor URLs and sub-queries together, suppressing a mostly-incoherent candidate", () => {
    const r = gateCreatePageCandidate("Travel Iran Beautiful Natural Wonders", {
      urls: ["https://nationalgeographic.com/travel/article/iran-beautiful-natural-wonders", "https://example.com/superstitions-iran", "https://example.com/most-popular-sports-iran"],
      subQueries: ["most beautiful natural places in Iran", "most common name in Iran"],
    });
    expect(r.keptUrls).toEqual(["https://nationalgeographic.com/travel/article/iran-beautiful-natural-wonders"]);
    expect(r.droppedUrls.length).toBe(2);
    // 2 kept / 5 total < 50% -> the candidate as a whole is incoherent
    expect(r.suppressCandidate).toBe(true);
  });

  it("passes a coherent candidate through untouched", () => {
    const r = gateCreatePageCandidate("Persian Wedding", {
      urls: ["https://theknot.com/persian-wedding-guide"],
      subQueries: ["persian wedding ceremony traditions"],
    });
    expect(r.keptUrls.length).toBe(1);
    expect(r.droppedUrls.length).toBe(0);
    expect(r.suppressCandidate).toBe(false);
  });
});
