import { describe, it, expect } from "vitest";
import { buildRefreshQueries } from "./keyword-refresh-candidates";

const q = (label: string, prompt: string | null = null) => buildRefreshQueries([{ label, prompt }]);

describe("buildRefreshQueries — suppress generic, preserve specific, no raw questions", () => {
  it("preserves specific cultural topics", () => {
    expect(q("Persian Wedding")).toContain("persian wedding");
    expect(q("Iranian Culture Etiquette")).toContain("iranian culture etiquette");
    expect(q("Culture of Iran")).toContain("culture of iran");
    expect(q("Iran Natural Attractions")).toContain("iran natural attractions");
    expect(q("Iranian Diaspora")).toContain("iranian diaspora");
    expect(q("Nowruz Activities Kids")).toContain("nowruz activities kids");
  });
  it("suppresses generic / junk labels (no distinguishing token)", () => {
    expect(q("Things Iran Highlights")).toEqual([]);
    expect(q("List Iranians")).toEqual([]);
    expect(q("Gifts")).toEqual([]);
    expect(q("Persian")).toEqual([]); // brand token only
  });
  it("uses a short non-question prompt as a second query, deduped vs the label", () => {
    const out = buildRefreshQueries([{ label: "Persian Wedding", prompt: "persian wedding traditions" }]);
    expect(out).toContain("persian wedding");
    expect(out).toContain("persian wedding traditions");
  });
  it("never queries a raw question prompt; a generic label is also suppressed", () => {
    const out = buildRefreshQueries([{ label: "Famous Iranians", prompt: "Who are the most famous Iranian poets?" }]);
    expect(out.some((x) => x.startsWith("who "))).toBe(false); // no raw question
    expect(out).toEqual([]); // "famous iranians" = filler + generic → suppressed
  });
  it("keeps a label with a real distinguishing token even when the prompt is a question", () => {
    const out = buildRefreshQueries([{ label: "Persian Poets", prompt: "Who are the most famous Persian poets?" }]);
    expect(out).toContain("persian poets");
    expect(out.some((x) => x.startsWith("who "))).toBe(false);
  });
  it("caps query length to a head phrase", () => {
    const out = q("Complete Guide to Persian Wedding Ceremony Traditions and Customs");
    expect(out[0]?.split(" ").length).toBeLessThanOrEqual(6);
  });
  it("dedupes across candidates", () => {
    const out = buildRefreshQueries([{ label: "Persian Wedding" }, { label: "persian wedding" }]);
    expect(out.filter((x) => x === "persian wedding").length).toBe(1);
  });
});

describe("buildRefreshQueries — reject conversational sentence fragments", () => {
  it("drops first-person prompt/label fragments", () => {
    expect(buildRefreshQueries([{ label: "I was invited to a Persian wedding" }])).toEqual([]);
    expect(buildRefreshQueries([{ label: "Persian Wedding", prompt: "I want to celebrate my heritage" }])).toEqual(["persian wedding"]);
  });
});
