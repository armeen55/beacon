import { describe, it, expect } from "vitest";
import {
  normalizePrompt,
  buildAeoPromptInputs,
  assignPromptToPage,
  compileCoverage,
} from "@/domains/profound-coverage/compiler";
import type { AeoPromptInput, OwnedPageCandidate } from "@/domains/profound-coverage/types";
import type { PromptOpportunity } from "@/domains/profound-question-intelligence/prompt-opportunity";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function input(p: Partial<AeoPromptInput>): AeoPromptInput {
  return {
    promptId: p.promptId ?? null,
    prompt: p.prompt ?? "What is taarof?",
    topic: p.topic ?? "Iranopedia",
    tags: p.tags ?? [],
    models: p.models ?? ["ChatGPT"],
    executions: p.executions ?? 1,
    ownMentionCount: p.ownMentionCount ?? 0,
    ownCitationCount: p.ownCitationCount ?? 0,
    citationUrls: p.citationUrls ?? [],
    topCitedPages: p.topCitedPages ?? [],
    topCitedDomains: p.topCitedDomains ?? [],
    fanoutQueries: p.fanoutQueries ?? [],
    answerSearchQueries: p.answerSearchQueries ?? [],
    rawAnswerThemes: p.rawAnswerThemes ?? [],
    rawAnswerExample: p.rawAnswerExample ?? null,
  };
}

function page(p: Partial<OwnedPageCandidate>): OwnedPageCandidate {
  return {
    url: p.url ?? "https://iranopedia.com/page",
    title: p.title ?? null,
    h1: p.h1 ?? null,
    h2s: p.h2s ?? [],
    metaDescription: p.metaDescription ?? null,
    wordCount: p.wordCount ?? 800,
    gscQueries: p.gscQueries ?? [],
    clicks90d: p.clicks90d ?? 0,
    impressions90d: p.impressions90d ?? 0,
    position90d: p.position90d ?? null,
    ctr90d: p.ctr90d ?? 0,
    ga4Visits28d: p.ga4Visits28d ?? 0,
    ga4Value: p.ga4Value ?? 0,
    clarityFriction: p.clarityFriction ?? 0,
    existingSchemaTypes: p.existingSchemaTypes ?? [],
  };
}

function opp(p: Partial<PromptOpportunity>): PromptOpportunity {
  return {
    prompt: p.prompt ?? "What is taarof?",
    promptId: p.promptId ?? null,
    topic: p.topic ?? "Iranopedia",
    executions: p.executions ?? 1,
    models: p.models ?? ["ChatGPT"],
    ownMentionCount: p.ownMentionCount ?? 0,
    ownCitationCount: p.ownCitationCount ?? 0,
    ownCitedUrls: p.ownCitedUrls ?? [],
    topCitedPages: p.topCitedPages ?? [],
    topCompetitorDomains: p.topCompetitorDomains ?? [],
    fanoutQueries: p.fanoutQueries ?? [],
    rawAnswerExamples: p.rawAnswerExamples ?? [],
    tags: p.tags ?? [],
    visibilityGap: p.visibilityGap ?? 1,
    citationGap: p.citationGap ?? 1,
    promptAttentionScore: p.promptAttentionScore ?? 1,
    recommendedMove: p.recommendedMove ?? "answer_block",
    evidence: p.evidence ?? "",
  };
}

const comp = (url: string, answers = 1) => ({ url, hostname: hostOf(url), answers, isOwned: false });
const owned = (url: string, answers = 1) => ({ url, hostname: "iranopedia.com", answers, isOwned: true });
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// normalizePrompt
// ---------------------------------------------------------------------------

describe("normalizePrompt", () => {
  it("strips filler + stopwords and keeps content tokens", () => {
    const r = normalizePrompt("What are the best websites for learning Persian?");
    expect(r.tokens).toContain("learning");
    expect(r.tokens).toContain("persian");
    expect(r.tokens).not.toContain("best");
    expect(r.tokens).not.toContain("websites");
  });

  it("classifies intents by keyword heuristics", () => {
    expect(normalizePrompt("What is taarof?").intent).toBe("definition");
    expect(normalizePrompt("Best Iranian restaurants in Tehran").intent).toBe("list");
    expect(normalizePrompt("How to make ghormeh sabzi").intent).toBe("how_to");
    expect(normalizePrompt("Persian culture and traditions").intent).toBe("cultural_guide");
    expect(normalizePrompt("Cities to visit in Iran").intent).toBe("travel_place");
    expect(normalizePrompt("Learn Farsi phrases for travel").intent).toBe("language_translation");
    expect(normalizePrompt("History of the ancient Persian empire").intent).toBe("history");
    expect(normalizePrompt("Where to buy Persian rugs gift price").intent).toBe("product_commercial");
    expect(normalizePrompt("Who was Cyrus the Great biography").intent).toBe("biography");
  });

  it("extracts multiword named entities", () => {
    const r = normalizePrompt("Who was Cyrus the Great?");
    expect(r.entities).toContain("cyrus the great");
  });
});

// ---------------------------------------------------------------------------
// buildAeoPromptInputs
// ---------------------------------------------------------------------------

describe("buildAeoPromptInputs", () => {
  it("maps PromptOpportunity and drops borrowed-account noise", () => {
    const real = opp({ prompt: "What is taarof?", fanoutQueries: ["taarof meaning"], tags: ["culture"], rawAnswerExamples: ["taarof is..."] });
    const noise = opp({ prompt: "Evaluate the Frontier Models company ChatGPT on Iranopedia" });
    const out = buildAeoPromptInputs([real, noise]);
    expect(out).toHaveLength(1);
    expect(out[0]!.prompt).toBe("What is taarof?");
    // fan-outs double as answerSearchQueries; tags double as rawAnswerThemes.
    expect(out[0]!.answerSearchQueries).toEqual(["taarof meaning"]);
    expect(out[0]!.rawAnswerThemes).toEqual(["culture"]);
    expect(out[0]!.rawAnswerExample).toBe("taarof is...");
  });
});

// ---------------------------------------------------------------------------
// assignPromptToPage
// ---------------------------------------------------------------------------

describe("assignPromptToPage", () => {
  it("strong title + GSC overlap -> existing_page", () => {
    const inp = input({ prompt: "What is taarof?", topCitedPages: [comp("https://mei.edu/articles/taarof", 2)] });
    const pages = [
      page({
        url: "https://iranopedia.com/culture/taarof",
        title: "Taarof explained",
        h1: "What is Taarof?",
        gscQueries: ["taarof", "what is taarof"],
        clicks90d: 120,
        impressions90d: 4000,
        position90d: 6,
      }),
    ];
    const a = assignPromptToPage(inp, pages, 1);
    expect(a.assignment).toBe("existing_page");
    expect(a.targetUrl).toBe("https://iranopedia.com/culture/taarof");
    expect(a.confidence).toBe("high");
  });

  it("no owned page + competitors cited -> new_page", () => {
    const inp = input({
      prompt: "Best Persian poets of all time",
      topCitedPages: [comp("https://example.com/persian-poets", 3), comp("https://other.com/top-poets", 2)],
    });
    const a = assignPromptToPage(inp, [], 1);
    expect(a.assignment).toBe("new_page");
    expect(a.targetUrl).toBeNull();
    expect(a.topCompetitorPages.length).toBeGreaterThan(0);
  });

  it("many sibling prompts in one topic + no owner -> hub_page", () => {
    const inp = input({
      prompt: "Persian poetry styles overview",
      topic: "Persian Poetry",
      topCitedPages: [comp("https://example.com/persian-poetry", 3), comp("https://other.com/poetry-guide", 2)],
    });
    const a = assignPromptToPage(inp, [], 5);
    expect(a.assignment).toBe("hub_page");
  });

  it("hackathon eval prompt -> ignore_noise", () => {
    const inp = input({ prompt: "Evaluate the Frontier Models company ChatGPT on Iranopedia" });
    const a = assignPromptToPage(inp, [], 1);
    expect(a.assignment).toBe("ignore_noise");
  });

  it("ChatGPT/openai.com citation is NEVER treated as Iranopedia ownership", () => {
    // The borrowed tracked asset appears in citations/mentions; it must not flip ownership.
    const inp = input({
      prompt: "Best Persian poets of all time",
      ownMentionCount: 0,
      ownCitationCount: 0,
      topCitedPages: [
        { url: "https://openai.com/chatgpt", hostname: "openai.com", answers: 3, isOwned: false },
        comp("https://example.com/persian-poets", 2),
      ],
    });
    const a = assignPromptToPage(inp, [], 1);
    // Not owned -> a real gap (new_page), never existing_page.
    expect(a.assignment).toBe("new_page");
    expect(a.missingCoverage.directAnswerMissing).toBe(true);
  });

  it("citation URLs become competitorPagesToBeat / topCompetitorPages", () => {
    const inp = input({
      prompt: "Best Persian poets of all time",
      topCitedPages: [comp("https://example.com/persian-poets", 3)],
    });
    const a = assignPromptToPage(inp, [], 1);
    expect(a.topCompetitorPages).toContain("https://example.com/persian-poets");
  });

  it("fanouts become fanoutsToAnswer", () => {
    const inp = input({
      prompt: "Best Persian poets of all time",
      fanoutQueries: ["who is the most famous persian poet", "hafez vs rumi"],
      topCitedPages: [comp("https://example.com/persian-poets", 3), comp("https://b.com/poets", 2)],
    });
    const a = assignPromptToPage(inp, [], 1);
    expect(a.fanoutsToAnswer).toContain("who is the most famous persian poet");
  });

  it("two owned pages match the same prompt -> internal_link_fix", () => {
    const inp = input({ prompt: "What is taarof in Persian culture?" });
    const pages = [
      page({ url: "https://iranopedia.com/culture/taarof", title: "Taarof in Persian culture", h1: "Taarof", clicks90d: 200 }),
      page({ url: "https://iranopedia.com/etiquette/taarof-guide", title: "Persian taarof etiquette culture", h1: "Taarof culture", clicks90d: 30 }),
    ];
    const a = assignPromptToPage(inp, pages, 1);
    expect(a.assignment).toBe("internal_link_fix");
    // Canonical target = the higher-traffic page.
    expect(a.targetUrl).toBe("https://iranopedia.com/culture/taarof");
    expect(a.missingCoverage.internalLinksMissing).toBe(true);
  });

  it("product/commercial with no owned page -> ignore_noise + needsSerpValidation on the pack", () => {
    const inp = input({
      prompt: "Where to buy Persian saffron gift price",
      topCitedPages: [comp("https://shop.com/saffron", 2)],
    });
    const a = assignPromptToPage(inp, [], 1);
    expect(a.assignment).toBe("ignore_noise");
    expect(a.intent).toBe("product_commercial");
  });
});

// ---------------------------------------------------------------------------
// compileCoverage
// ---------------------------------------------------------------------------

describe("compileCoverage", () => {
  it("dedupes near-identical prompts to one assignment", () => {
    const a = opp({ prompt: "What is taarof?", executions: 3, topCitedPages: [comp("https://mei.edu/taarof", 2), comp("https://x.com/taarof", 2)] });
    const b = opp({ prompt: "what is taarof", executions: 2, topCitedPages: [comp("https://mei.edu/taarof", 1)] });
    const r = compileCoverage([a, b], []);
    expect(r.assignments).toHaveLength(1);
    expect(r.summary.totalPrompts).toBe(1);
  });

  it("ranking: GSC-backed existing-page move beats weak pure-Profound gap", () => {
    // Weak gap: 1 answer, no fan-outs, single weak competitor.
    const weakGap = opp({
      prompt: "Obscure Persian micro-topic nobody searches",
      executions: 1,
      models: ["ChatGPT"],
      fanoutQueries: [],
      topCitedPages: [comp("https://example.com/obscure-topic", 1), comp("https://b.com/obscure", 1)],
    });
    // GSC-backed existing page move: real traffic + a cited competitor.
    const gscMove = opp({
      prompt: "What is taarof?",
      executions: 2,
      models: ["ChatGPT"],
      topCitedPages: [comp("https://mei.edu/taarof", 2)],
    });
    const pages = [
      page({
        url: "https://iranopedia.com/culture/taarof",
        title: "Taarof explained",
        h1: "What is Taarof?",
        gscQueries: ["taarof", "what is taarof"],
        clicks90d: 300,
        impressions90d: 9000,
        ga4Value: 500,
        position90d: 5,
      }),
    ];
    const r = compileCoverage([weakGap, gscMove], pages);
    expect(r.actionPacks.length).toBeGreaterThanOrEqual(2);
    const top = r.actionPacks[0]!;
    expect(top.prompt).toBe("What is taarof?");
    expect(["add_answer_block", "expand_existing_page"]).toContain(top.action);
    // The GSC-backed move's score strictly exceeds the weak gap's.
    const taarof = r.actionPacks.find((p) => p.prompt === "What is taarof?")!;
    const obscure = r.actionPacks.find((p) => p.prompt.startsWith("Obscure"));
    if (obscure) expect(taarof.priorityScore).toBeGreaterThan(obscure.priorityScore);
  });

  it("strong corroborated gap CAN rank well but a weak one is capped", () => {
    const strongGap = opp({
      prompt: "Best Persian poets ranked",
      executions: 5,
      models: ["ChatGPT", "Perplexity"],
      fanoutQueries: ["hafez vs rumi", "most famous persian poet", "classical persian poetry"],
      topCitedPages: [comp("https://a.com/persian-poets", 3), comp("https://b.com/top-poets", 2)],
    });
    const weakGap = opp({
      prompt: "Random untracked thing",
      executions: 1,
      models: ["ChatGPT"],
      fanoutQueries: [],
      topCitedPages: [comp("https://c.com/random", 1)],
    });
    const r = compileCoverage([strongGap, weakGap], []);
    const strong = r.actionPacks.find((p) => p.prompt === "Best Persian poets ranked")!;
    const weak = r.actionPacks.find((p) => p.prompt === "Random untracked thing");
    expect(strong.priorityScore).toBeGreaterThan(35);
    if (weak) expect(weak.priorityScore).toBeLessThanOrEqual(35);
  });

  it("many related prompts in a topic cluster -> at least one hub_page", () => {
    const topic = "Persian Poetry";
    const cluster = [
      opp({ prompt: "Best classical Persian poets", topic, topCitedPages: [comp("https://a.com/poets", 3), comp("https://b.com/poetry", 2)] }),
      opp({ prompt: "Famous modern Persian poets list", topic, topCitedPages: [comp("https://c.com/modern-poets", 2), comp("https://d.com/poets", 2)] }),
      opp({ prompt: "Persian poetry forms and styles", topic, topCitedPages: [comp("https://e.com/forms", 2), comp("https://f.com/styles", 2)] }),
      opp({ prompt: "Top Persian poetry books to read", topic, topCitedPages: [comp("https://g.com/books", 2), comp("https://h.com/reading", 2)] }),
      opp({ prompt: "Greatest Persian love poems collection", topic, topCitedPages: [comp("https://i.com/love-poems", 2), comp("https://j.com/poems", 2)] }),
    ];
    const r = compileCoverage(cluster, []);
    expect(r.summary.hubPage).toBeGreaterThanOrEqual(1);
    expect(r.actionPacks.some((p) => p.action === "create_hub")).toBe(true);
  });

  it("fanouts become FAQ + section candidates on the action pack", () => {
    const o = opp({
      prompt: "Best Persian poets ranked",
      executions: 4,
      models: ["ChatGPT", "Perplexity"],
      fanoutQueries: ["who is the most famous persian poet", "hafez vs rumi"],
      topCitedPages: [comp("https://a.com/poets", 3), comp("https://b.com/poetry", 2)],
    });
    const r = compileCoverage([o], []);
    const pack = r.actionPacks[0]!;
    expect(pack.faqQuestions.length).toBeGreaterThan(0);
    expect(pack.sectionsToAdd.length).toBeGreaterThan(0);
  });

  it("summary counts add up to total prompts", () => {
    const r = compileCoverage(
      [
        opp({ prompt: "What is taarof?", topCitedPages: [comp("https://mei.edu/taarof", 2)] }),
        opp({ prompt: "Evaluate the Frontier Models company ChatGPT on Iranopedia" }),
      ],
      [page({ url: "https://iranopedia.com/culture/taarof", title: "Taarof explained", h1: "What is Taarof?", gscQueries: ["taarof"], clicks90d: 50, impressions90d: 2000 })],
    );
    const s = r.summary;
    // Noise prompt is filtered at buildAeoPromptInputs -> not counted at all.
    expect(s.totalPrompts).toBe(1);
    expect(s.existingPage + s.newPage + s.hubPage + s.internalLinkFix + s.ignoredNoise).toBe(s.totalPrompts);
  });

  it("owned-page citation (iranopedia.com) IS ownership and pivots to expand, not create", () => {
    const o = opp({
      prompt: "What is Nowruz?",
      ownCitationCount: 2,
      topCitedPages: [owned("https://iranopedia.com/nowruz", 2), comp("https://mei.edu/nowruz", 1)],
    });
    const inputs = buildAeoPromptInputs([o]);
    const a = assignPromptToPage(inputs[0]!, [page({ url: "https://iranopedia.com/nowruz", title: "Nowruz", h1: "What is Nowruz?", gscQueries: ["nowruz"], clicks90d: 80, impressions90d: 3000 })], 1);
    expect(a.assignment).toBe("existing_page");
    expect(a.missingCoverage.directAnswerMissing).toBe(false);
  });
});
