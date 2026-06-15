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
import { profoundAeoGap } from "@/domains/recommendation-intelligence/triggers/profound-aeo-gap";

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
