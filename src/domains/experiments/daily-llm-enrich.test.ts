import { describe, it, expect, vi } from "vitest";
import { enrichDailyCandidatesWithLlm, type MetaTitleDrafter } from "./daily-llm-enrich";
import type { BuiltCandidate } from "./build-daily-candidates";

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
});
