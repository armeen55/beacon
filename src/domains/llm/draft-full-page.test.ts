import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Same isolation convention as structured-drafter.test.ts: control the budget
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
  draftFullPageStructured,
  assembleDraftPage,
  serializeFullPageDraft,
  deserializeFullPageDraft,
  reassembleFromPersisted,
  stripDashes,
  MAX_SECTIONS,
  type FullPageBriefInput,
  type FullPageGroundingInput,
  type DraftFullPageResult,
} from "./draft-full-page";
import type { SectionDraft } from "./schemas";
import type { CompleteFn } from "./structured-drafter";

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

describe("draftFullPageStructured — walking the outline", () => {
  it("drafts one SectionDraft per outline heading, in order", async () => {
    const responses = BRIEF.outline.map((h) => ({ text: sectionJson({ heading: h }) }));
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete: fakeComplete(responses) });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes).toHaveLength(BRIEF.outline.length);
    expect(r.sectionsDrafted).toBe(BRIEF.outline.length);
    expect(r.sectionsFallback).toBe(0);
    expect(r.outcomes.map((o) => o.section.heading)).toEqual(BRIEF.outline);
  });

  it("caps at MAX_SECTIONS even with a longer outline", async () => {
    const longBrief: FullPageBriefInput = { ...BRIEF, outline: Array.from({ length: 12 }, (_, i) => `Section ${i + 1}`) };
    const r = await draftFullPageStructured(longBrief, GROUNDING, {
      complete: fakeComplete([{ text: sectionJson() }]),
    });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes.length).toBe(MAX_SECTIONS);
    expect(MAX_SECTIONS).toBeLessThanOrEqual(8);
  });

  it("returns an empty drafted result when the brief has no outline", async () => {
    const r = await draftFullPageStructured({ ...BRIEF, outline: [] }, GROUNDING, { complete: fakeComplete([{ text: sectionJson() }]) });
    expect(r).toEqual({ status: "drafted", outcomes: [], totalCostUsd: 0, sectionsDrafted: 0, sectionsFallback: 0 });
  });

  it("every drafted section carries at least one source (the trust floor)", async () => {
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete: fakeComplete([{ text: sectionJson() }]) });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    for (const o of r.outcomes) expect(o.section.sources.length).toBeGreaterThanOrEqual(1);
  });
});

describe("draftFullPageStructured — no-repeat accumulating context", () => {
  it("passes prior headings/excerpts into later sections' prompts (context pin)", async () => {
    const seenUsers: string[] = [];
    const complete: CompleteFn = async ({ user }) => {
      seenUsers.push(user);
      const idx = seenUsers.length - 1;
      return { text: sectionJson({ heading: BRIEF.outline[idx] }) };
    };
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    // First section's prompt has no "already covered" context yet.
    expect(seenUsers[0]).toContain("This is the first section");
    // Second section's prompt must reference the FIRST section's heading so it
    // knows not to repeat it.
    expect(seenUsers[1]).toContain("Already covered in earlier sections");
    expect(seenUsers[1]).toContain(BRIEF.outline[0]);
    // Third section must carry BOTH prior headings.
    expect(seenUsers[2]).toContain(BRIEF.outline[0]);
    expect(seenUsers[2]).toContain(BRIEF.outline[1]);
  });

  it("still advances the covered context even after a section falls back to a stub", async () => {
    // Section 1 fails validation on every attempt: callStructuredLLM's own internal
    // retry-once (2 calls) PLUS the walker's one extra quality-layer retry, which
    // itself gets callStructuredLLM's internal retry-once (2 more calls) = 4
    // non-JSON responses before the walker gives up and stubs. Section 2 then gets
    // a valid response and must still see section 1's stub as "already covered".
    const complete = fakeComplete([
      { text: "not json" },
      { text: "not json" },
      { text: "not json" },
      { text: "not json" },
      { text: sectionJson({ heading: BRIEF.outline[1] }) },
    ]);
    const r = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 2) }, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes[0]!.status).toBe("fallback_stub");
    expect(r.sectionsFallback).toBe(1);
    expect(r.outcomes[1]!.status).toBe("drafted");
  });
});

describe("draftFullPageStructured — quality-gate retry + honest fallback", () => {
  it("retries once on a regeneratable quality rejection (generic opening), then drafts", async () => {
    const generic = sectionJson({
      heading: "What is a gift",
      body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation, exchanged across many cultures worldwide in social contexts.",
    });
    const good = sectionJson({ heading: BRIEF.outline[0] });
    const complete = fakeComplete([{ text: generic }, { text: good }]);
    const r = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 1) }, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes[0]!.status).toBe("drafted");
    if (r.outcomes[0]!.status === "drafted") expect(r.outcomes[0]!.retried).toBe(true);
  });

  it("falls back to an HONEST outline stub after a second quality failure", async () => {
    const generic = sectionJson({
      heading: "What is a gift",
      body: "A gift is a voluntarily transferred item, service, or gesture given without payment or legally required compensation, exchanged across many cultures worldwide in social contexts.",
    });
    const complete = fakeComplete([{ text: generic }, { text: generic }]);
    const r = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 1) }, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    const outcome = r.outcomes[0]!;
    expect(outcome.status).toBe("fallback_stub");
    expect(outcome.section.body).toContain("I could not draft this section confidently");
    expect(outcome.section.body).toContain(BRIEF.outline[0]);
    expect(outcome.section.sources.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a stub when the LLM returns invalid JSON twice in a row (no retry loop stalls)", async () => {
    const complete = fakeComplete([{ text: "nope" }, { text: "still nope" }]);
    const r = await draftFullPageStructured({ ...BRIEF, outline: BRIEF.outline.slice(0, 1) }, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.outcomes[0]!.status).toBe("fallback_stub");
  });

  it("never lets a fallback stub contain an em or en dash", async () => {
    const complete = fakeComplete([{ text: "nope" }, { text: "still nope" }]);
    const r = await draftFullPageStructured({ ...BRIEF, outline: ["Weddings — traditions"] }, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    const stub = r.outcomes[0]!.section;
    expect(stub.heading).not.toMatch(/[—–]/);
    expect(stub.body).not.toMatch(/[—–]/);
  });
});

describe("draftFullPageStructured — budget fail-closed", () => {
  it("stubs every section (never calls the LLM) when the budget is exhausted", async () => {
    checkBudgetMock.mockResolvedValue({ allowed: false, reason: "cap reached" });
    const complete = vi.fn(fakeComplete([{ text: sectionJson() }]));
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.sectionsDrafted).toBe(0);
    expect(r.sectionsFallback).toBe(BRIEF.outline.length);
    expect(complete).not.toHaveBeenCalled();
    expect(r.totalCostUsd).toBe(0);
  });

  it("stubs every section when BEACON_LLM_PROVIDER is off (fail-closed, not fail-open)", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    const complete = vi.fn(fakeComplete([{ text: sectionJson() }]));
    const r = await draftFullPageStructured(BRIEF, GROUNDING, { complete });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.sectionsFallback).toBe(BRIEF.outline.length);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("assembleDraftPage", () => {
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
            { kind: "competitor_observation", detail: "cited page leads with an explainer" }, // duplicate detail, different section
          ],
          containsNumber: false,
        },
      },
    ],
    totalCostUsd: 0.02,
    sectionsDrafted: 2,
    sectionsFallback: 0,
  };

  it("assembles title, meta, sections, faq, and a deduped sources appendix", () => {
    const page = assembleDraftPage(BRIEF, drafted);
    expect(page.title).toBe(BRIEF.proposedTitle);
    expect(page.meta).toBe(BRIEF.metaDescription);
    expect(page.sections).toHaveLength(2);
    expect(page.faq).toEqual(BRIEF.faqQuestions);
    // 2 distinct source details across both sections, deduped once.
    expect(page.sourcesAppendix).toHaveLength(2);
    expect(page.sourcesAppendix[0]!.n).toBe(1);
    expect(page.sourcesAppendix[1]!.n).toBe(2);
  });

  it("produces paste-ready markdown with title, sections, FAQ, and sources", () => {
    const page = assembleDraftPage(BRIEF, drafted);
    expect(page.markdown).toContain(`# ${BRIEF.proposedTitle}`);
    expect(page.markdown).toContain("## The sofreh aghd ceremony");
    expect(page.markdown).toContain("## The aghd vows");
    expect(page.markdown).toContain("## Frequently asked questions");
    expect(page.markdown).toContain("## Sources");
    expect(page.markdown).toContain("1. (competitor_observation)");
  });

  it("carries stats (sectionsDrafted/sectionsFallback/totalCostUsd) through", () => {
    const page = assembleDraftPage(BRIEF, drafted);
    expect(page.stats).toEqual({ sectionsDrafted: 2, sectionsFallback: 0, totalCostUsd: 0.02 });
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
            heading: "The reception — jashn",
            body: "Guests dance and celebrate — often until late at night.",
            sources: [{ kind: "own_data", detail: "site note — internal" }],
            containsNumber: false,
          },
        },
      ],
    };
    const dashyBrief: FullPageBriefInput = { ...BRIEF, proposedTitle: "Persian Weddings — A Guide", metaDescription: "A guide — factual and clear." };
    const page = assembleDraftPage(dashyBrief, withDash);
    expect(page.title).not.toMatch(/[—–]/);
    expect(page.meta).not.toMatch(/[—–]/);
    expect(page.sections[0]!.heading).not.toMatch(/[—–]/);
    expect(page.sections[0]!.body).not.toMatch(/[—–]/);
    expect(page.sections[0]!.sources[0]!.detail).not.toMatch(/[—–]/);
    expect(page.markdown).not.toMatch(/[—–]/);
  });

  it("omits the FAQ and sources sections from markdown when there are none", () => {
    const noFaq: FullPageBriefInput = { ...BRIEF, faqQuestions: [] };
    const noSources: DraftFullPageResult = { ...drafted, outcomes: [] };
    const page = assembleDraftPage(noFaq, noSources);
    expect(page.markdown).not.toContain("## Frequently asked questions");
    expect(page.markdown).not.toContain("## Sources");
  });
});

describe("serializeFullPageDraft / deserializeFullPageDraft round-trip", () => {
  const page = assembleDraftPage(BRIEF, {
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
    ],
    totalCostUsd: 0.01,
    sectionsDrafted: 1,
    sectionsFallback: 0,
  });

  it("round-trips sections + stats through JSON", () => {
    const content = serializeFullPageDraft(page);
    expect(content).not.toBeNull();
    const parsed = deserializeFullPageDraft(content);
    expect(parsed).not.toBeNull();
    expect(parsed!.sections).toEqual(page.sections);
    expect(parsed!.stats).toEqual(page.stats);
  });

  it("stays well under the move_drafts 12k content cap for a realistic 8-section page", () => {
    const bigPage = assembleDraftPage(
      { ...BRIEF, outline: Array.from({ length: 8 }, (_, i) => `Section ${i + 1}`) },
      {
        status: "drafted",
        outcomes: Array.from({ length: 8 }, (_, i) => ({
          status: "drafted" as const,
          costUsd: 0.01,
          retried: false,
          section: {
            heading: `Section ${i + 1}`,
            body: "This is a realistic section body of about two hundred characters, describing the topic in enough factual detail to be useful to a reader looking for a direct, grounded answer to their question about the page topic.",
            sources: [{ kind: "own_data" as const, detail: "grounded fact for this section" }],
            containsNumber: false,
          },
        })),
        totalCostUsd: 0.08,
        sectionsDrafted: 8,
        sectionsFallback: 0,
      },
    );
    const content = serializeFullPageDraft(bigPage);
    expect(content).not.toBeNull();
    expect(content!.length).toBeLessThan(12_000);
  });

  it("returns null (never truncates to malformed data) when content exceeds the cap", () => {
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
  });

  it("deserializeFullPageDraft fails soft (null) on malformed JSON", () => {
    expect(deserializeFullPageDraft("not json")).toBeNull();
    expect(deserializeFullPageDraft(null)).toBeNull();
    expect(deserializeFullPageDraft(undefined)).toBeNull();
  });

  it("reassembleFromPersisted rebuilds the same paste-ready page from the compact form", () => {
    const content = serializeFullPageDraft(page)!;
    const persisted = deserializeFullPageDraft(content)!;
    const rebuilt = reassembleFromPersisted(BRIEF, persisted);
    expect(rebuilt.title).toBe(page.title);
    expect(rebuilt.sections).toEqual(page.sections);
    expect(rebuilt.markdown).toBe(page.markdown);
  });
});

describe("stripDashes", () => {
  it("removes em and en dashes from generated text", () => {
    expect(stripDashes("Iran — a country with a long history")).not.toMatch(/[—–]/);
    expect(stripDashes("10–20 years")).not.toMatch(/[—–]/);
  });
  it("handles empty/null-ish input without throwing", () => {
    expect(stripDashes("")).toBe("");
  });
});
