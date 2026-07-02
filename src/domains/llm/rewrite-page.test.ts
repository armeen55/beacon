import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Same isolation convention as draft-full-page.test.ts: control the budget
// gate deterministically and stub winner-memory so tests never touch the real
// json-store or Supabase.
const { checkBudgetMock, recordSpendMock } = vi.hoisted(() => ({
  checkBudgetMock: vi.fn(),
  recordSpendMock: vi.fn(),
}));
vi.mock("@/domains/recommendations/adjudicator-budget", () => ({
  checkBudget: checkBudgetMock,
  recordSpend: recordSpendMock,
}));

const { buildWinnerFewShotsMock } = vi.hoisted(() => ({
  buildWinnerFewShotsMock: vi.fn(async () => ""),
}));
vi.mock("./winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
}));

import {
  rewritePageStructured,
  assembleRewrite,
  serializeRewriteDraft,
  deserializeRewriteDraft,
  stripDashes,
  MAX_REWRITE_SECTIONS,
  type CurrentPageSection,
  type RewritePageGroundingInput,
  type RewritePageResult,
} from "./rewrite-page";
import type { SectionDraft } from "./schemas";
import type { CompleteFn } from "./structured-drafter";

const SECTIONS: CurrentPageSection[] = [
  { heading: "The sofreh aghd ceremony", oldBody: "The sofreh aghd is a ceremonial spread laid before the couple." },
  { heading: "The aghd vows", oldBody: "An officiant reads the marriage vows to the couple and witnesses." },
  { heading: "The jashn reception", oldBody: "The jashn is the celebration that follows the ceremony, with music and food." },
];

const GROUNDING: RewritePageGroundingInput = {
  topic: "persian wedding traditions",
  competitorWhatWins: "FAQ schema · answer block · 1.8k words",
  competitorOutline: ["What is a Persian wedding", "The sofreh aghd spread", "The reception"],
  fanoutQuestions: ["What is a sofreh aghd?", "What happens at a jashn?"],
  evidenceFacts: ["3 competitor pages cited for this topic"],
};

function sectionJson(over: Partial<SectionDraft> = {}): string {
  const value: SectionDraft = {
    heading: "The sofreh aghd ceremony",
    body: "The sofreh aghd is a ceremonial spread laid before an Iranian couple during the wedding, carrying symbolic items such as bread, herbs, gold coins, and a mirror. Family members hold a canopy above the couple while an officiant reads the vows aloud to those gathered.",
    sources: [{ kind: "competitor_observation", detail: "the cited page leads with a sofreh aghd explainer" }],
    containsNumber: false,
    ...over,
  };
  return JSON.stringify(value);
}

/** A completion fn that replays a fixed queue of responses (last one repeats). */
function fakeComplete(responses: Array<{ text: string } | { error: string }>): CompleteFn {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]!;
}

const ORIGINAL_PROVIDER = process.env.BEACON_LLM_PROVIDER;

beforeEach(() => {
  process.env.BEACON_LLM_PROVIDER = "openai";
  checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
  recordSpendMock.mockResolvedValue(undefined);
  buildWinnerFewShotsMock.mockReset();
  buildWinnerFewShotsMock.mockResolvedValue("");
});
afterEach(() => {
  process.env.BEACON_LLM_PROVIDER = ORIGINAL_PROVIDER;
  vi.clearAllMocks();
});

describe("rewritePageStructured — walking the current sections", () => {
  it("rewrites one SectionDraft per current section, in order", async () => {
    const responses = SECTIONS.map((s) => ({ text: sectionJson({ heading: s.heading }) }));
    const r = await rewritePageStructured(SECTIONS, GROUNDING, { complete: fakeComplete(responses) });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes).toHaveLength(SECTIONS.length);
    expect(r.sectionsRewritten).toBe(SECTIONS.length);
    expect(r.sectionsKeptOriginal).toBe(0);
    expect(r.outcomes.map((o) => o.heading)).toEqual(SECTIONS.map((s) => s.heading));
  });

  it("caps at MAX_REWRITE_SECTIONS even with more current sections", async () => {
    const many: CurrentPageSection[] = Array.from({ length: 12 }, (_, i) => ({
      heading: `Section ${i + 1}`,
      oldBody: `Old body for section ${i + 1}.`,
    }));
    const r = await rewritePageStructured(many, GROUNDING, { complete: fakeComplete([{ text: sectionJson() }]) });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes.length).toBe(MAX_REWRITE_SECTIONS);
    expect(MAX_REWRITE_SECTIONS).toBeLessThanOrEqual(8);
  });

  it("returns an empty rewritten result when there are no current sections", async () => {
    const r = await rewritePageStructured([], GROUNDING, { complete: fakeComplete([{ text: sectionJson() }]) });
    expect(r).toEqual({ status: "rewritten", outcomes: [], totalCostUsd: 0, sectionsRewritten: 0, sectionsKeptOriginal: 0 });
  });

  it("grounds the prompt on the section's OWN old body text", async () => {
    const seenUsers: string[] = [];
    const complete: CompleteFn = async ({ user }) => {
      seenUsers.push(user);
      return { text: sectionJson({ heading: SECTIONS[0]!.heading }) };
    };
    await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(seenUsers[0]).toContain(SECTIONS[0]!.oldBody);
  });

  it("tells the model plainly when no old body text is on file for a section", async () => {
    const seenUsers: string[] = [];
    const complete: CompleteFn = async ({ user }) => {
      seenUsers.push(user);
      return { text: sectionJson() };
    };
    await rewritePageStructured([{ heading: "A heading with no body", oldBody: "" }], GROUNDING, { complete });
    expect(seenUsers[0]).toContain("no body text on file");
  });
});

describe("rewritePageStructured — ORIGINAL KEPT on failure (never a stub on a rewrite)", () => {
  it("keeps the ORIGINAL text verbatim after a second quality failure (no fabricated stub)", async () => {
    const generic = sectionJson({
      heading: "What is a gift",
      body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation, exchanged across many cultures worldwide in social contexts.",
    });
    const complete = fakeComplete([{ text: generic }, { text: generic }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const outcome = r.outcomes[0]!;
    expect(outcome.status).toBe("kept_original");
    if (outcome.status !== "kept_original") return;
    // The kept text is EXACTLY the original old body — never a stub sentence,
    // never truncated, never fabricated.
    expect(outcome.oldBody).toBe(SECTIONS[0]!.oldBody);
    expect(outcome.heading).toBe(SECTIONS[0]!.heading);
    expect(outcome.reason).toBeTruthy();
  });

  it("keeps the original when the LLM returns invalid JSON twice in a row", async () => {
    const complete = fakeComplete([{ text: "nope" }, { text: "still nope" }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes[0]!.status).toBe("kept_original");
    if (r.outcomes[0]!.status === "kept_original") {
      expect(r.outcomes[0]!.oldBody).toBe(SECTIONS[0]!.oldBody);
    }
  });

  it("retries once on a regeneratable quality rejection, then rewrites", async () => {
    const generic = sectionJson({
      heading: "What is a gift",
      body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation, exchanged across many cultures worldwide in social contexts.",
    });
    const good = sectionJson({ heading: SECTIONS[0]!.heading });
    const complete = fakeComplete([{ text: generic }, { text: good }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes[0]!.status).toBe("rewritten");
    if (r.outcomes[0]!.status === "rewritten") expect(r.outcomes[0]!.retried).toBe(true);
  });

  it("never lets a kept-original section's heading/body pick up an em or en dash from re-stripping", async () => {
    const complete = fakeComplete([{ text: "nope" }, { text: "still nope" }]);
    const r = await rewritePageStructured(
      [{ heading: "Weddings — traditions", oldBody: "Old text with an em dash — right here." }],
      GROUNDING,
      { complete },
    );
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const outcome = r.outcomes[0]!;
    expect(outcome.status).toBe("kept_original");
    if (outcome.status !== "kept_original") return;
    expect(outcome.heading).not.toMatch(/[—–]/);
    expect(outcome.oldBody).not.toMatch(/[—–]/);
  });
});

describe("rewritePageStructured — numeric-fidelity firewall", () => {
  it("rejects (and keeps original) a rewrite that invents a number not in the old text or grounding", async () => {
    // The shared structured-drafter firewall runs against `grounded`, which this
    // walker builds from the section's OWN old text + the grounding facts. A
    // number appearing nowhere in either must fail the firewall and retry, then
    // fall back to keeping the original — never publish an invented number.
    const invented = sectionJson({
      heading: SECTIONS[0]!.heading,
      body: "The sofreh aghd tradition dates back exactly 4,732 years and involves precisely 17 ceremonial items laid out in a fixed order for every wedding across the country.",
      containsNumber: true,
    });
    const complete = fakeComplete([{ text: invented }, { text: invented }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const outcome = r.outcomes[0]!;
    expect(outcome.status).toBe("kept_original");
    if (outcome.status !== "kept_original") return;
    expect(outcome.oldBody).toBe(SECTIONS[0]!.oldBody);
  });

  it("allows a rewrite that restates a number already present in the old text", async () => {
    const oldWithNumber: CurrentPageSection = {
      heading: "The sofreh aghd ceremony",
      oldBody: "The sofreh aghd spread includes 7 symbolic items laid before the couple.",
    };
    const restated = sectionJson({
      heading: oldWithNumber.heading,
      body: "The sofreh aghd spread traditionally includes 7 symbolic items, each laid before the couple to represent blessings for the marriage ahead, drawing from long-standing Persian custom.",
      containsNumber: true,
    });
    const complete = fakeComplete([{ text: restated }]);
    const r = await rewritePageStructured([oldWithNumber], GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes[0]!.status).toBe("rewritten");
  });
});

describe("rewritePageStructured — budget fail-closed", () => {
  it("keeps every section original (never calls the LLM) when the budget is exhausted", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: sectionJson() }]));
    const r = await rewritePageStructured(SECTIONS, GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.sectionsKeptOriginal).toBe(SECTIONS.length);
    expect(r.sectionsRewritten).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    for (const o of r.outcomes) expect(o.status).toBe("kept_original");
  });

  it("returns every original untouched (byte-identical) when AI drafting is off", async () => {
    process.env.BEACON_LLM_PROVIDER = "off";
    const r = await rewritePageStructured(SECTIONS, GROUNDING, {});
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    for (let i = 0; i < SECTIONS.length; i += 1) {
      const outcome = r.outcomes[i]!;
      expect(outcome.status).toBe("kept_original");
      if (outcome.status === "kept_original") expect(outcome.oldBody).toBe(SECTIONS[i]!.oldBody);
    }
  });
});

describe("assembleRewrite — side-by-side assembly", () => {
  it("marks rewritten sections changed with old !== new, and kept-original sections unchanged with old === new", async () => {
    const complete = fakeComplete([
      { text: sectionJson({ heading: SECTIONS[0]!.heading }) },
      { text: "nope" },
      { text: "nope" },
    ]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 2), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const assembled = assembleRewrite(r);
    expect(assembled.sections).toHaveLength(2);
    expect(assembled.sections[0]!.changed).toBe(true);
    expect(assembled.sections[0]!.newBody).not.toBe(assembled.sections[0]!.oldBody);
    expect(assembled.sections[1]!.changed).toBe(false);
    expect(assembled.sections[1]!.newBody).toBe(assembled.sections[1]!.oldBody);
    expect(assembled.sections[1]!.keptReason).toBeTruthy();
  });

  it("never emits an em or en dash anywhere in the assembled sections", async () => {
    const complete = fakeComplete([{ text: sectionJson({ heading: SECTIONS[0]!.heading, body: "No dashes here, only hyphens - like this." }) }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const assembled = assembleRewrite(r);
    for (const s of assembled.sections) {
      expect(s.heading).not.toMatch(/[—–]/);
      expect(s.oldBody).not.toMatch(/[—–]/);
      expect(s.newBody).not.toMatch(/[—–]/);
    }
  });
});

describe("serializeRewriteDraft / deserializeRewriteDraft — persistence round-trip", () => {
  it("round-trips an assembled rewrite through serialize/deserialize", async () => {
    const complete = fakeComplete([{ text: sectionJson({ heading: SECTIONS[0]!.heading }) }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const assembled = assembleRewrite(r);
    const content = serializeRewriteDraft(assembled);
    expect(content).not.toBeNull();
    const persisted = deserializeRewriteDraft(content);
    expect(persisted).not.toBeNull();
    expect(persisted!.sections).toEqual(assembled.sections);
    expect(persisted!.stats).toEqual(assembled.stats);
  });

  it("deserializeRewriteDraft fails soft (null) on garbage input", () => {
    expect(deserializeRewriteDraft(null)).toBeNull();
    expect(deserializeRewriteDraft(undefined)).toBeNull();
    expect(deserializeRewriteDraft("not json")).toBeNull();
    expect(deserializeRewriteDraft(JSON.stringify({ v: 999, sections: [] }))).toBeNull();
  });
});

describe("stripDashes", () => {
  it("strips em and en dashes to hyphens", () => {
    expect(stripDashes("a — b – c")).not.toMatch(/[—–]/);
  });
});

describe("RewritePageResult status union — off / blocked_budget pass-through types", () => {
  it("type-level: RewritePageResult includes off and blocked_budget statuses (compile-time pin)", () => {
    const off: RewritePageResult = { status: "off" };
    const blocked: RewritePageResult = { status: "blocked_budget", reason: "cap reached" };
    expect(off.status).toBe("off");
    expect(blocked.status).toBe("blocked_budget");
  });
});
