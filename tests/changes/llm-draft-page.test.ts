/**
 * Full-page drafter + rewrite walker boundaries (Core 100K Phase 6 merge of
 * src/domains/llm/draft-full-page.test.ts + rewrite-page.test.ts).
 *
 * Pins: one SectionDraft per outline heading with the >=1 source trust floor;
 * accumulating no-repeat context; quality-gate retry then an HONEST fallback
 * (a stub for new pages, the ORIGINAL VERBATIM for rewrites - never a
 * fabricated stub on a rewrite); the numeric-fidelity firewall grounded on
 * the section's own old text; budget/provider fail-closed with zero LLM
 * calls; dash-free assembly; persistence round-trips that fail soft.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
vi.mock("@/domains/llm/winner-memory", () => ({
  buildWinnerFewShots: buildWinnerFewShotsMock,
}));

import {
  draftFullPageStructured,
  assembleDraftPage,
  serializeFullPageDraft,
  deserializeFullPageDraft,
  reassembleFromPersisted,
  MAX_SECTIONS,
  type FullPageBriefInput,
  type FullPageGroundingInput,
  type DraftFullPageResult,
} from "@/domains/llm/draft-full-page";
import {
  rewritePageStructured,
  assembleRewrite,
  serializeRewriteDraft,
  deserializeRewriteDraft,
  type CurrentPageSection,
  type RewritePageGroundingInput,
} from "@/domains/llm/rewrite-page";
import type { SectionDraft } from "@/domains/llm/schemas";
import type { CompleteFn } from "@/domains/llm/structured-drafter";
import { fakeComplete } from "./_llm";

const BRIEF: FullPageBriefInput = {
  proposedTitle: "Persian Wedding Traditions Explained",
  metaDescription: "A clear, factual guide to the Persian wedding ceremony, the sofreh aghd, and the celebration that follows the vows.",
  openingAnswer:
    "A Persian wedding blends pre-Islamic and Islamic customs centered on the sofreh aghd, a ceremonial spread with symbolic items such as a mirror, candelabras, and sweets laid out before the couple.",
  outline: ["The sofreh aghd ceremony", "The aghd vows", "The jashn reception"],
  faqQuestions: ["What is a sofreh aghd?", "How long does a Persian wedding last?"],
};

const GROUNDING: FullPageGroundingInput = {
  topic: "persian wedding traditions",
  competitorWhatWins: "FAQ schema · answer block · 1.8k words",
  competitorOutline: ["What is a Persian wedding", "The sofreh aghd spread", "The reception"],
  fanoutQuestions: ["What is a sofreh aghd?", "What happens at a jashn?"],
  evidenceFacts: ["Iranopedia has no page for this topic yet", "3 competitor pages cited for this topic"],
};

const SECTIONS: CurrentPageSection[] = [
  { heading: "The sofreh aghd ceremony", oldBody: "The sofreh aghd is a ceremonial spread laid before the couple." },
  { heading: "The aghd vows", oldBody: "An officiant reads the marriage vows to the couple and witnesses." },
  { heading: "The jashn reception", oldBody: "The jashn is the celebration that follows the ceremony, with music and food." },
];

const REWRITE_GROUNDING: RewritePageGroundingInput = {
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

const GENERIC_SECTION = sectionJson({
  heading: "What is a gift",
  body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation, exchanged across many cultures worldwide in social contexts.",
});

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

describe("draftFullPageStructured - walking the outline", () => {
  it("drafts one SectionDraft per outline heading, in order, each carrying >= 1 source (the trust floor)", async () => {
    const responses = BRIEF.outline.map((h) => ({ text: sectionJson({ heading: h }) }));
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete: fakeComplete(responses) });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes.map((o) => o.section.heading)).toEqual(BRIEF.outline);
    expect(r.sectionsFallback).toBe(0);
    for (const o of r.outcomes) expect(o.section.sources.length).toBeGreaterThanOrEqual(1);
  });

  it("caps at MAX_SECTIONS even with a longer outline", async () => {
    const longBrief: FullPageBriefInput = { ...BRIEF, outline: Array.from({ length: 12 }, (_, i) => `Section ${i + 1}`) };
    const r = await draftFullPageStructured(longBrief, GROUNDING, { complete: fakeComplete([{ text: sectionJson() }]) });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes.length).toBe(MAX_SECTIONS);
    expect(MAX_SECTIONS).toBeLessThanOrEqual(8);
  });

  it("passes prior headings/excerpts into later sections' prompts (no-repeat context pin)", async () => {
    const seenUsers: string[] = [];
    const complete: CompleteFn = async ({ user }) => {
      seenUsers.push(user);
      const idx = seenUsers.length - 1;
      return { text: sectionJson({ heading: BRIEF.outline[idx] }) };
    };
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    expect(seenUsers[0]).toContain("This is the first section");
    expect(seenUsers[1]).toContain("Already covered in earlier sections");
    expect(seenUsers[1]).toContain(BRIEF.outline[0]);
    expect(seenUsers[2]).toContain(BRIEF.outline[1]);
  });

  it("retries once on a regeneratable quality rejection, then drafts; falls back to an HONEST outline stub after a second failure", async () => {
    const good = sectionJson({ heading: BRIEF.outline[0] });
    const retried = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 1) }, GROUNDING, {
      complete: fakeComplete([{ text: GENERIC_SECTION }, { text: good }]),
    });
    expect(retried.status).toBe("drafted");
    if (retried.status !== "drafted") return;
    expect(retried.outcomes[0]!.status).toBe("drafted");

    const stubbed = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 1) }, GROUNDING, {
      complete: fakeComplete([{ text: GENERIC_SECTION }, { text: GENERIC_SECTION }]),
    });
    expect(stubbed.status).toBe("drafted");
    if (stubbed.status !== "drafted") return;
    const outcome = stubbed.outcomes[0]!;
    expect(outcome.status).toBe("fallback_stub");
    expect(outcome.section.body).toContain("I could not draft this section confidently");
    expect(outcome.section.body).toContain(BRIEF.outline[0]);
  });

  it("stubs every section (never calls the LLM) when the budget is exhausted or the provider is off", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: sectionJson() }]));
    const blocked = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(blocked.status).toBe("drafted");
    if (blocked.status !== "drafted") return;
    expect(blocked.sectionsFallback).toBe(BRIEF.outline.length);
    expect(complete).not.toHaveBeenCalled();
    expect(blocked.totalCostUsd).toBe(0);

    checkBudgetMock.mockResolvedValue({ allowed: true, remaining: 10 });
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const off = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(off.status).toBe("drafted");
    if (off.status !== "drafted") return;
    expect(off.sectionsFallback).toBe(BRIEF.outline.length);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("assembleDraftPage + persistence", () => {
  const drafted: DraftFullPageResult = {
    status: "drafted",
    outcomes: [
      {
        status: "drafted",
        costUsd: 0.01,
        retried: false,
        section: {
          heading: "The sofreh aghd ceremony",
          body: "The sofreh aghd is a ceremonial spread laid before the couple.",
          sources: [{ kind: "competitor_observation", detail: "cited page leads with an explainer" }],
          containsNumber: false,
        },
      },
      {
        status: "drafted",
        costUsd: 0.01,
        retried: true,
        section: {
          heading: "The aghd vows",
          body: "The aghd is the legal vow-exchange, often officiated by a cleric or notary.",
          sources: [
            { kind: "fanout_question", detail: "What happens at the aghd?" },
            { kind: "competitor_observation", detail: "cited page leads with an explainer" },
          ],
          containsNumber: false,
        },
      },
    ],
    totalCostUsd: 0.02,
    sectionsDrafted: 2,
    sectionsFallback: 0,
  };

  it("assembles title, meta, sections, faq, a deduped sources appendix, and paste-ready markdown", () => {
    const page = assembleDraftPage(BRIEF, drafted);
    expect(page.title).toBe(BRIEF.proposedTitle);
    expect(page.sections).toHaveLength(2);
    expect(page.sourcesAppendix).toHaveLength(2); // deduped across sections
    expect(page.markdown).toContain(`# ${BRIEF.proposedTitle}`);
    expect(page.markdown).toContain("## Frequently asked questions");
    expect(page.markdown).toContain("## Sources");
  });

  it("strips em/en dashes from every text field at assembly (defense in depth)", () => {
    const withDash: DraftFullPageResult = {
      ...drafted,
      outcomes: [
        {
          status: "drafted",
          costUsd: 0,
          retried: false,
          section: {
            heading: "The reception \u2014 jashn",
            body: "Guests dance and celebrate \u2014 often until late at night.",
            sources: [{ kind: "own_data", detail: "site note \u2014 internal" }],
            containsNumber: false,
          },
        },
      ],
    };
    const dashyBrief: FullPageBriefInput = { ...BRIEF, proposedTitle: "Persian Weddings \u2014 A Guide", metaDescription: "A guide \u2014 factual and clear." };
    const page = assembleDraftPage(dashyBrief, withDash);
    expect(page.title).not.toMatch(/[\u2013\u2014]/);
    expect(page.meta).not.toMatch(/[\u2013\u2014]/);
    expect(page.markdown).not.toMatch(/[\u2013\u2014]/);
  });

  it("round-trips through serialize/deserialize/reassemble; refuses over-cap content; fails soft on garbage", () => {
    const page = assembleDraftPage(BRIEF, drafted);
    const content = serializeFullPageDraft(page)!;
    const persisted = deserializeFullPageDraft(content)!;
    expect(persisted.sections).toEqual(page.sections);
    const rebuilt = reassembleFromPersisted(BRIEF, persisted);
    expect(rebuilt.markdown).toBe(page.markdown);

    // Over the move_drafts cap -> null, never truncated-to-malformed.
    const hugePage = assembleDraftPage(BRIEF, {
      status: "drafted",
      outcomes: [
        {
          status: "drafted",
          costUsd: 0,
          retried: false,
          section: { heading: "Huge", body: "x".repeat(11_800), sources: [{ kind: "own_data", detail: "x" }], containsNumber: false },
        },
      ],
      totalCostUsd: 0,
      sectionsDrafted: 1,
      sectionsFallback: 0,
    });
    expect(serializeFullPageDraft(hugePage)).toBeNull();
    expect(deserializeFullPageDraft("not json")).toBeNull();
    expect(deserializeFullPageDraft(null)).toBeNull();
  });
});

describe("rewritePageStructured - ORIGINAL KEPT on failure (never a stub on a rewrite)", () => {
  it("rewrites one SectionDraft per current section in order, grounding each prompt on its OWN old body", async () => {
    const seenUsers: string[] = [];
    const complete: CompleteFn = async ({ user }) => {
      seenUsers.push(user);
      const idx = seenUsers.length - 1;
      return { text: sectionJson({ heading: SECTIONS[idx]!.heading }) };
    };
    const r = await rewritePageStructured(SECTIONS, REWRITE_GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes.map((o) => o.heading)).toEqual(SECTIONS.map((s) => s.heading));
    expect(seenUsers[0]).toContain(SECTIONS[0]!.oldBody);
  });

  it("keeps the ORIGINAL text verbatim after a second quality failure (no fabricated stub)", async () => {
    const complete = fakeComplete([{ text: GENERIC_SECTION }, { text: GENERIC_SECTION }]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), REWRITE_GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const outcome = r.outcomes[0]!;
    expect(outcome.status).toBe("kept_original");
    if (outcome.status !== "kept_original") return;
    expect(outcome.oldBody).toBe(SECTIONS[0]!.oldBody);
    expect(outcome.reason).toBeTruthy();
  });

  it("retries once on a regeneratable quality rejection, then rewrites", async () => {
    const good = sectionJson({ heading: SECTIONS[0]!.heading });
    const r = await rewritePageStructured(SECTIONS.slice(0, 1), REWRITE_GROUNDING, {
      complete: fakeComplete([{ text: GENERIC_SECTION }, { text: good }]),
    });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.outcomes[0]!.status).toBe("rewritten");
    if (r.outcomes[0]!.status === "rewritten") expect(r.outcomes[0]!.retried).toBe(true);
  });

  it("numeric-fidelity firewall: an invented number keeps the original; a restated number from the old text is allowed", async () => {
    const invented = sectionJson({
      heading: SECTIONS[0]!.heading,
      body: "The sofreh aghd tradition dates back exactly 4,732 years and involves precisely 17 ceremonial items laid out in a fixed order for every wedding across the country.",
      containsNumber: true,
    });
    const kept = await rewritePageStructured(SECTIONS.slice(0, 1), REWRITE_GROUNDING, {
      complete: fakeComplete([{ text: invented }, { text: invented }]),
    });
    expect(kept.status).toBe("rewritten");
    if (kept.status !== "rewritten") return;
    expect(kept.outcomes[0]!.status).toBe("kept_original");

    const oldWithNumber: CurrentPageSection = {
      heading: "The sofreh aghd ceremony",
      oldBody: "The sofreh aghd spread includes 7 symbolic items laid before the couple.",
    };
    const restated = sectionJson({
      heading: oldWithNumber.heading,
      body: "The sofreh aghd spread traditionally includes 7 symbolic items, each laid before the couple to represent blessings for the marriage ahead, drawing from long-standing Persian custom.",
      containsNumber: true,
    });
    const allowed = await rewritePageStructured([oldWithNumber], REWRITE_GROUNDING, { complete: fakeComplete([{ text: restated }]) });
    expect(allowed.status).toBe("rewritten");
    if (allowed.status !== "rewritten") return;
    expect(allowed.outcomes[0]!.status).toBe("rewritten");
  });

  it("keeps every section original (never calls the LLM) when the budget is exhausted", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: sectionJson() }]));
    const r = await rewritePageStructured(SECTIONS, REWRITE_GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    expect(r.sectionsKeptOriginal).toBe(SECTIONS.length);
    expect(complete).not.toHaveBeenCalled();
  });

  it("assembleRewrite marks rewritten sections changed and kept-original unchanged; persistence round-trips + fails soft", async () => {
    const complete = fakeComplete([
      { text: sectionJson({ heading: SECTIONS[0]!.heading }) },
      { text: "nope" },
      { text: "nope" },
    ]);
    const r = await rewritePageStructured(SECTIONS.slice(0, 2), REWRITE_GROUNDING, { complete });
    expect(r.status).toBe("rewritten");
    if (r.status !== "rewritten") return;
    const assembled = assembleRewrite(r);
    expect(assembled.sections[0]!.changed).toBe(true);
    expect(assembled.sections[1]!.changed).toBe(false);
    expect(assembled.sections[1]!.newBody).toBe(assembled.sections[1]!.oldBody);
    const content = serializeRewriteDraft(assembled);
    const persisted = deserializeRewriteDraft(content);
    expect(persisted!.sections).toEqual(assembled.sections);
    expect(deserializeRewriteDraft("not json")).toBeNull();
    expect(deserializeRewriteDraft(JSON.stringify({ v: 999, sections: [] }))).toBeNull();
  });
});
