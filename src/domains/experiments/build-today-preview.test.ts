import { describe, it, expect, vi } from "vitest";
import { buildOutlineFromFacts, enrichDailyCandidatesWithLlm, type MetaTitleDrafter } from "./build-today-preview";
import type { PageFacts, BuiltCandidate } from "./build-daily-candidates";

/**
 * BEACON_500 item 48 pin - the nightly title/meta LLM pass must be grounded in the page's own
 * cached crawl facts (title/h1/meta/body) instead of an empty outline. This pins the pure helper
 * that turns PageFacts into the drafter's `outline` array: populated when a snapshot exists,
 * empty-safe otherwise, and bounded so a long page never blows the prompt budget.
 */
describe("buildOutlineFromFacts (item 48 - ground the title/meta LLM pass)", () => {
  it("returns [] when there is no snapshot (empty-safe)", () => {
    expect(buildOutlineFromFacts(undefined)).toEqual([]);
    expect(buildOutlineFromFacts(null)).toEqual([]);
  });

  it("returns [] when facts exist but every field is empty", () => {
    const facts: PageFacts = { title: null, meta: null, h1: null, bodyParagraphs: [] };
    expect(buildOutlineFromFacts(facts)).toEqual([]);
  });

  it("populates the outline from title/h1/meta/body when a snapshot exists", () => {
    const facts: PageFacts = {
      title: "Persian Wedding Traditions",
      h1: "Persian Wedding Traditions Explained",
      meta: "Everything about a Persian wedding ceremony.",
      bodyParagraphs: [
        "The Sofreh Aghd is the ceremonial spread laid out before the couple.",
        "Guests often throw sugar over the couple's heads for a sweet life.",
      ],
    };
    const outline = buildOutlineFromFacts(facts);
    expect(outline.some((l) => l.includes("Title: Persian Wedding Traditions"))).toBe(true);
    expect(outline.some((l) => l.includes("H1: Persian Wedding Traditions Explained"))).toBe(true);
    expect(outline.some((l) => l.includes("Meta: Everything about a Persian wedding ceremony."))).toBe(true);
    expect(outline.some((l) => l.includes("Sofreh Aghd"))).toBe(true);
    expect(outline.some((l) => l.includes("sugar over the couple's heads"))).toBe(true);
  });

  it("skips blank body paragraphs", () => {
    const facts: PageFacts = { title: "T", meta: null, h1: null, bodyParagraphs: ["", "   ", "Real paragraph."] };
    const outline = buildOutlineFromFacts(facts);
    expect(outline).toEqual(["Title: T", "Real paragraph."]);
  });

  it("bounds the total outline to ~1500 chars so a long page never blows the prompt budget", () => {
    const longParagraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} `.repeat(20));
    const facts: PageFacts = { title: "T", meta: "M", h1: "H", bodyParagraphs: longParagraphs };
    const outline = buildOutlineFromFacts(facts);
    const totalChars = outline.reduce((n, l) => n + l.length, 0);
    expect(totalChars).toBeLessThanOrEqual(1500);
    expect(outline.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Folded from daily-llm-enrich.test.ts (module merged into
// build-today-preview.ts, 2026-07-21). Pins the injected-drafter LLM pass:
// drop-in fields only, fail-soft fallback, no-change detection.
// ---------------------------------------------------------------------------

function mk(over: Partial<BuiltCandidate>): BuiltCandidate {
  return {
    url: "https://s.com/p",
    pageLabel: "P",
    targetQuery: "q",
    currentText: "old meta",
    proposedText: "deterministic meta",
    leverField: "meta",
    ...over,
  } as BuiltCandidate;
}

const intents = new Map<string, string | undefined>();

describe("enrichDailyCandidatesWithLlm — LLM 'write it' pass (D-1, drop-in fields only)", () => {
  it("replaces a meta proposal with the LLM draft and flags draftSource=llm", async () => {
    const c = mk({ url: "https://s.com/a", leverField: "meta", proposedText: "deterministic meta" });
    const draft: MetaTitleDrafter = async () => ({ text: "A sharper, page-specific description.", rationale: "matches the search intent" });
    const n = await enrichDailyCandidatesWithLlm([c], intents, draft);
    expect(n).toBe(1);
    expect(c.proposedText).toBe("A sharper, page-specific description.");
    expect(c.draftSource).toBe("llm");
    expect(c.llmRationale).toBe("matches the search intent");
  });

  it("keeps the deterministic text when the LLM returns null (off / budget / no better idea)", async () => {
    const c = mk({ proposedText: "deterministic meta" });
    const n = await enrichDailyCandidatesWithLlm([c], intents, async () => null);
    expect(n).toBe(0);
    expect(c.proposedText).toBe("deterministic meta");
    expect(c.draftSource).toBeUndefined();
  });

  it("keeps the deterministic text when the drafter throws (fail soft)", async () => {
    const c = mk({ proposedText: "deterministic meta" });
    const n = await enrichDailyCandidatesWithLlm([c], intents, async () => { throw new Error("openai_500"); });
    expect(n).toBe(0);
    expect(c.proposedText).toBe("deterministic meta");
  });

  it("only touches meta/title levers (leaves answer_block + internal_link untouched)", async () => {
    const ab = mk({ leverField: "answer_block", proposedText: "buried sentence" });
    const link = mk({ leverField: "internal_link", proposedText: "anchor" });
    const draft = vi.fn(async () => ({ text: "NEW", rationale: "r" }));
    const n = await enrichDailyCandidatesWithLlm([ab, link], intents, draft);
    expect(n).toBe(0);
    expect(draft).not.toHaveBeenCalled();
    expect(ab.proposedText).toBe("buried sentence");
    expect(link.proposedText).toBe("anchor");
  });

  it("does not replace when the LLM text equals the current value or the existing proposal", async () => {
    const sameAsCurrent = mk({ currentText: "old meta", proposedText: "det" });
    const sameAsProposed = mk({ currentText: "old meta", proposedText: "det" });
    await enrichDailyCandidatesWithLlm([sameAsCurrent], intents, async () => ({ text: "old meta", rationale: "r" }));
    await enrichDailyCandidatesWithLlm([sameAsProposed], intents, async () => ({ text: "det", rationale: "r" }));
    expect(sameAsCurrent.draftSource).toBeUndefined();
    expect(sameAsProposed.draftSource).toBeUndefined();
  });

  it("passes the page's intent to the drafter", async () => {
    const c = mk({ url: "https://s.com/when", leverField: "title", targetQuery: "chaharshanbe suri 2026" });
    const im = new Map<string, string | undefined>([["https://s.com/when", "when"]]);
    let seen: string | undefined = "unset";
    await enrichDailyCandidatesWithLlm([c], im, async ({ intent }) => { seen = intent; return { text: "Chaharshanbe Suri 2026 date", rationale: "date intent" }; });
    expect(seen).toBe("when");
  });

  it("passes the page's url to the drafter (item 48 - so the caller can ground the outline)", async () => {
    const c = mk({ url: "https://s.com/wedding", leverField: "meta" });
    let seenUrl: string | undefined;
    await enrichDailyCandidatesWithLlm([c], intents, async ({ url }) => { seenUrl = url; return { text: "New meta description text.", rationale: "r" }; });
    expect(seenUrl).toBe("https://s.com/wedding");
  });
});
