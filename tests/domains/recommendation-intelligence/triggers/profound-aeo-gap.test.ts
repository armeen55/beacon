/**
 * Profound AEO-gap trigger tests (2026-06-14) — `profound_aeo_gap`:
 * the FIRST trigger to consume Profound (the pivot's sole AEO source).
 * A topic where AI assistants cite a competitor while the tenant is
 * ABSENT, over a meaningful number of observed answers, earns one
 * add_answer_block directive anchored on the site root. Thin/empty
 * Profound data emits NOTHING.
 */

import { describe, expect, it } from "vitest";

import type { ProfoundTopicSignal } from "@/domains/recommendation-intelligence/profound-topic-signals";
import { buildOwnAliasSet } from "@/domains/recommendation-intelligence/profound-topic-signals";
import {
  MAX_PROFOUND_PAGE_GAPS,
  profoundAeoGap,
  profoundPageAeoGaps,
} from "@/domains/recommendation-intelligence/triggers/profound-aeo-gap";
import type { AeoActionPack } from "@/domains/profound-coverage/types";

const ROOT = "https://iranopedia.com/";

function topic(over: Partial<ProfoundTopicSignal> = {}): ProfoundTopicSignal {
  return {
    categoryId: "cat-nowruz",
    executions: 40,
    ownMentions: 0,
    ownShareOfVoice: 0,
    modelCount: 3,
    topCompetitor: { assetName: "Rival Wiki", mentions: 18, shareOfVoice: 0.62 },
    ...over,
  };
}

function run(
  signals: ProfoundTopicSignal[],
  siteRootUrl: string | null = ROOT,
) {
  return profoundAeoGap({
    tenantId: "tenant-a",
    signals,
    siteRootUrl,
    signalAt: "2026-06-14T04:00:00Z",
  });
}

function pack(over: Partial<AeoActionPack> = {}): AeoActionPack {
  return {
    action: "add_answer_block",
    priorityScore: 80,
    targetUrl: "https://iranopedia.com/nowruz",
    newPageSlug: null,
    title: "Nowruz",
    h1: "Nowruz",
    directAnswerBrief: "Answer the prompt directly.",
    sectionsToAdd: [],
    faqQuestions: [],
    schemaRecommendation: "Article",
    sourceReferences: ["https://example.org/source"],
    competitorPagesToBeat: ["https://example.org/winner"],
    internalLinks: [],
    measurementPlan: ["AI citations"],
    evidence: "executions=20; competitor_pages=2; own_citations=0",
    needsSerpValidation: false,
    promptId: "prompt-nowruz",
    prompt: "What is Nowruz?",
    ...over,
  };
}

describe("profoundAeoGap — emits on a clear, sourced gap", () => {
  it("emits one add_answer_block when a competitor wins a topic the tenant is absent from", () => {
    const out = run([topic()]);
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.trigger_signal).toBe("profound_aeo_gap");
    expect(c.action_type).toBe("add_answer_block");
    expect(c.generator_kind).toBe("deterministic");
    expect(c.target_url).toBe(ROOT);
    expect(c.topic_cluster_label).toBe("profound_topic:cat-nowruz");
    expect(c.confidence).toBe("medium");
    expect(c.safety_flags).toEqual([]);
    // Evidence + operator trace carry the sourced numbers.
    expect(c.evidence).toHaveLength(1);
    expect(c.evidence[0]!.detail).toContain("ai_answers=40");
    expect(c.evidence[0]!.detail).toContain("competitor=Rival Wiki");
    expect(c.operator_evidence).toContain("own_mentions=0");
    expect(c.operator_evidence).toContain("top_competitor=Rival Wiki");
    // Customer copy names the competitor + answer count, no internal tokens.
    expect(c.customer_copy).toContain("Rival Wiki");
    expect(c.customer_copy).toContain("40");
  });

  it("customer copy formats the AI-answer count and names the competitor", () => {
    const out = run([topic({ executions: 1234 })]);
    expect(out[0]!.customer_copy).toContain("1,234");
    expect(out[0]!.customer_copy).toContain("Rival Wiki");
  });

  it("picks the worst gap (strongest competitor) when several topics qualify", () => {
    const out = run([
      topic({ categoryId: "cat-a", topCompetitor: { assetName: "Weak Co", mentions: 5, shareOfVoice: 0.2 } }),
      topic({ categoryId: "cat-b", topCompetitor: { assetName: "Strong Co", mentions: 30, shareOfVoice: 0.7 } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.topic_cluster_label).toBe("profound_topic:cat-b");
    expect(out[0]!.customer_copy).toContain("Strong Co");
  });
});

describe("profoundAeoGap — abstains on thin / non-gap data", () => {
  it("emits NOTHING on empty signals", () => {
    expect(run([])).toEqual([]);
  });

  it("abstains when too few AI answers were observed (below the executions floor)", () => {
    expect(run([topic({ executions: 9 })])).toEqual([]);
  });

  it("abstains when the tenant is already present on the topic (ownMentions > 0)", () => {
    expect(run([topic({ ownMentions: 4 })])).toEqual([]);
  });

  it("abstains when there is no competitor on the topic", () => {
    expect(run([topic({ topCompetitor: null })])).toEqual([]);
  });

  it("abstains when the only competitor is below the mention floor (noise)", () => {
    expect(
      run([topic({ topCompetitor: { assetName: "Blip", mentions: 1, shareOfVoice: 0.05 } })]),
    ).toEqual([]);
  });

  it("abstains when the tenant has no configured domain (no URL to anchor)", () => {
    expect(run([topic()], null)).toEqual([]);
    expect(run([topic()], "")).toEqual([]);
  });
});

describe("profoundPageAeoGaps — best-page mapping", () => {
  it("emits distinct page-specific candidates instead of collapsing on the homepage", () => {
    const out = profoundPageAeoGaps({
      tenantId: "tenant-a",
      signalAt: "2026-07-17T00:00:00Z",
      packs: [
        pack(),
        pack({
          promptId: "prompt-food",
          prompt: "What is ghormeh sabzi?",
          targetUrl: "https://iranopedia.com/ghormeh-sabzi",
          priorityScore: 70,
        }),
      ],
    });
    expect(out).toHaveLength(2);
    expect(out.map((x) => x.target_url)).toEqual([
      "https://iranopedia.com/nowruz",
      "https://iranopedia.com/ghormeh-sabzi",
    ]);
    expect(new Set(out.map((x) => x.cooldown_key)).size).toBe(2);
  });

  it("keeps only the strongest prompt per page and caps the queue at five pages", () => {
    const packs = [
      pack({ prompt: "Weak same-page prompt", priorityScore: 10 }),
      pack({ prompt: "Strong same-page prompt", priorityScore: 95 }),
      ...Array.from({ length: 8 }, (_, i) =>
        pack({
          promptId: `prompt-${i}`,
          prompt: `Prompt ${i}`,
          targetUrl: `https://iranopedia.com/page-${i}`,
          priorityScore: 80 - i,
        }),
      ),
    ];
    const out = profoundPageAeoGaps({
      tenantId: "tenant-a",
      signalAt: "2026-07-17T00:00:00Z",
      packs,
    });
    expect(out).toHaveLength(MAX_PROFOUND_PAGE_GAPS);
    expect(out.filter((x) => x.target_url === "https://iranopedia.com/nowruz")).toHaveLength(1);
    expect(out.find((x) => x.target_url === "https://iranopedia.com/nowruz")?.customer_copy).toContain(
      "Strong same-page prompt",
    );
  });

  it("ignores new-page and link-only packs because this trigger edits existing pages", () => {
    expect(
      profoundPageAeoGaps({
        tenantId: "tenant-a",
        signalAt: "2026-07-17T00:00:00Z",
        packs: [
          pack({ action: "create_new_page", targetUrl: null }),
          pack({ action: "add_internal_links" }),
        ],
      }),
    ).toEqual([]);
  });
});

describe("buildOwnAliasSet — config-driven owned-brand identification", () => {
  it("includes the brand name, its first word, and the domain host + label", () => {
    const aliases = buildOwnAliasSet({ brandName: "Ritz Builders", domain: "https://www.ritzbuilders.com/" });
    expect(aliases.has("ritz builders")).toBe(true);
    expect(aliases.has("ritz")).toBe(true);
    expect(aliases.has("ritzbuilders.com")).toBe(true);
    expect(aliases.has("ritzbuilders")).toBe(true);
  });

  it("drops sub-3-char fragments and is empty when nothing usable is configured", () => {
    expect(buildOwnAliasSet({ brandName: null, domain: null }).size).toBe(0);
    expect(buildOwnAliasSet({ brandName: "AB", domain: "" }).size).toBe(0);
  });

  it("single-word brand does not add a redundant first-word alias", () => {
    const aliases = buildOwnAliasSet({ brandName: "Iranopedia", domain: "iranopedia.com" });
    expect(aliases.has("iranopedia")).toBe(true);
    expect(aliases.has("iranopedia.com")).toBe(true);
  });
});
