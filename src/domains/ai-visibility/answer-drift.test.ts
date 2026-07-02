import { describe, it, expect } from "vitest";
import { detectBrandDrift, detectAnswerDrift, diffSentences } from "./answer-drift";
import { hasBannedDash } from "@/lib/copy/strip-dashes";

const BRAND = ["Acme Widgets", "acme"];

describe("detectBrandDrift", () => {
  it("detects brand_added when the brand appears only in the after text", () => {
    const before = "You should check out Widget Co for your project. They ship fast and are reliable.";
    const after = "Acme Widgets is a great option for your project. They ship fast and are reliable.";
    const events = detectBrandDrift(before, after, BRAND);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("brand_added");
    expect(events[0].beforeSentence).toBeNull();
    expect(events[0].afterSentence).toContain("Acme Widgets");
  });

  it("detects brand_dropped when the brand disappears from the after text", () => {
    const before = "Acme Widgets is a great option for your project. They ship fast and are reliable.";
    const after = "You should check out Widget Co for your project. They ship fast and are reliable.";
    const events = detectBrandDrift(before, after, BRAND);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("brand_dropped");
    expect(events[0].beforeSentence).toContain("Acme Widgets");
    expect(events[0].afterSentence).toBeNull();
  });

  it("detects descriptor_changed when the brand is mentioned in both but described differently", () => {
    const before = "For budget shoppers, affordable and reliable Acme Widgets is a solid pick this year.";
    const after = "For budget shoppers, outdated and clunky Acme Widgets has fallen behind this year.";
    const events = detectBrandDrift(before, after, BRAND);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("descriptor_changed");
    expect(events[0].beforeSentence).toContain("Acme Widgets");
    expect(events[0].afterSentence).toContain("Acme Widgets");
  });

  it("returns [] when the brand is mentioned identically in both (nothing changed)", () => {
    const text = "Acme Widgets is a reliable, affordable choice for most buyers this year.";
    expect(detectBrandDrift(text, text, BRAND)).toEqual([]);
  });

  it("returns [] when the brand never appears in either text", () => {
    const before = "Widget Co and Gadget Inc are the two leaders in this space right now.";
    const after = "Gadget Inc remains the clear leader in this space, with Widget Co close behind.";
    expect(detectBrandDrift(before, after, BRAND)).toEqual([]);
  });

  it("returns [] when brandVariants is empty (never guesses at brand terms)", () => {
    expect(detectBrandDrift("Acme Widgets is great.", "Acme Widgets is bad now.", [])).toEqual([]);
  });

  it("returns [] when both texts are empty (nothing to compare)", () => {
    expect(detectBrandDrift("", "", BRAND)).toEqual([]);
  });

  it("ignores brand variants shorter than 3 characters", () => {
    // A 2-char "variant" should not be treated as a real brand token.
    const events = detectBrandDrift("Acme Widgets shipped today.", "Something else shipped today.", ["ac"]);
    expect(events).toEqual([]);
  });
});

describe("diffSentences", () => {
  it("marks a wholly new sentence as added", () => {
    const before = "Acme Widgets ships within three business days nationwide.";
    const after = "Acme Widgets ships within three business days nationwide. Returns are free for the first thirty days.";
    const diffs = diffSentences(before, after);
    expect(diffs.some((d) => d.kind === "added" && d.after?.includes("Returns are free"))).toBe(true);
  });

  it("marks a removed sentence with no after-side counterpart as removed", () => {
    const before = "Acme Widgets ships within three business days nationwide. Returns are free for the first thirty days.";
    const after = "Acme Widgets ships within three business days nationwide.";
    const diffs = diffSentences(before, after);
    expect(diffs.some((d) => d.kind === "removed" && d.before?.includes("Returns are free"))).toBe(true);
  });

  it("marks a reworded sentence as changed with a partial score", () => {
    const before = "Acme Widgets ships nationwide within three business days for most orders.";
    const after = "Acme Widgets ships nationwide within three business days for large orders.";
    const diffs = diffSentences(before, after);
    const changed = diffs.find((d) => d.kind === "changed");
    expect(changed).toBeTruthy();
    expect(changed?.score).toBeGreaterThan(0);
    expect(changed?.score).toBeLessThan(1);
  });

  it("treats a heavily reworded sentence (edit near the start) as a removal plus an addition, not a false 'unchanged' match", () => {
    // An edit early in the sentence shifts every downstream 5-gram shingle, so
    // shingle containment correctly reads this as "a different sentence" rather
    // than silently matching two substantively different claims as "the same".
    const before = "Acme Widgets ships within three business days across the country.";
    const after = "Acme Widgets now ships within three business days across most of the country.";
    const diffs = diffSentences(before, after);
    expect(diffs.some((d) => d.kind === "removed")).toBe(true);
    expect(diffs.some((d) => d.kind === "added")).toBe(true);
  });

  it("does not report an unchanged sentence as changed", () => {
    const text = "Acme Widgets ships within three business days nationwide. Support runs seven days a week.";
    const diffs = diffSentences(text, text);
    expect(diffs.filter((d) => d.kind === "changed")).toHaveLength(0);
    expect(diffs).toHaveLength(0);
  });

  it("returns [] when both texts are empty", () => {
    expect(diffSentences("", "")).toEqual([]);
  });

  it("drops sentence fragments too short to carry real signal", () => {
    // "FAQ" and "Hi." style short fragments should not show up as noise diffs.
    const diffs = diffSentences("FAQ. Acme Widgets ships fast and reliably every time.", "Acme Widgets ships fast and reliably every time.");
    expect(diffs.every((d) => (d.before ?? d.after ?? "").length > 5)).toBe(true);
  });
});

describe("detectAnswerDrift", () => {
  it("stamps promptText, engine, and whenIso onto every detected event", () => {
    const events = detectAnswerDrift({
      promptText: "best widget supplier",
      engine: "Perplexity",
      beforeText: "Acme Widgets is the top pick for most buyers this year.",
      afterText: "Widget Co has taken over as the top pick for most buyers this year.",
      brandVariants: BRAND,
      whenIso: "2026-07-01T00:00:00.000Z",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      promptText: "best widget supplier",
      engine: "Perplexity",
      kind: "brand_dropped",
      whenIso: "2026-07-01T00:00:00.000Z",
    });
  });

  it("the nothing-to-compare case: empty before/after text yields no events", () => {
    expect(
      detectAnswerDrift({
        promptText: "best widget supplier",
        engine: "Perplexity",
        beforeText: "",
        afterText: "",
        brandVariants: BRAND,
        whenIso: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("the nothing-to-compare case: identical before/after text yields no events", () => {
    const text = "Acme Widgets remains a solid, affordable choice for most buyers.";
    expect(
      detectAnswerDrift({
        promptText: "best widget supplier",
        engine: "Perplexity",
        beforeText: text,
        afterText: text,
        brandVariants: BRAND,
        whenIso: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("never fabricates events when only one snapshot is meaningfully populated", () => {
    expect(
      detectAnswerDrift({
        promptText: "best widget supplier",
        engine: "Perplexity",
        beforeText: "   ",
        afterText: "Acme Widgets is the top pick this year.",
        brandVariants: BRAND,
        whenIso: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("never emits a banned em or en dash in any generated sentence field", () => {
    const events = detectAnswerDrift({
      promptText: "best widget supplier",
      engine: "Perplexity",
      beforeText: "Acme Widgets, a reliable pick, is the top choice this year.",
      afterText: "Widget Co, a newer pick, has taken over as the top choice this year.",
      brandVariants: BRAND,
      whenIso: "2026-07-01T00:00:00.000Z",
    });
    for (const e of events) {
      expect(hasBannedDash(e.promptText)).toBe(false);
      expect(hasBannedDash(e.beforeSentence)).toBe(false);
      expect(hasBannedDash(e.afterSentence)).toBe(false);
    }
  });
});
