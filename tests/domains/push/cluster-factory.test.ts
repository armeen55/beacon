/**
 * 2026-06-10 — page-factory tests (§master goal step 3).
 * Pins: LLM gate (deterministic refuses loudly), per-run item cap,
 * happy-path draft shape (create card + JSON fields + slug), and the
 * content-rule validator (flagged terms, word caps, empty fields) —
 * violations FLAG into risks[], the human gate enforces.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  generateClusterCards,
  validateDraftFields,
  MAX_ITEMS_PER_RUN,
  type ClusterPlan,
} from "@/domains/push/cluster-factory";

function plan(over: Partial<ClusterPlan> = {}): ClusterPlan {
  return {
    name: "Persian Food",
    dataCollectionId: "Foods",
    slugField: "slug",
    urlPrefix: "/persian-food",
    siteBaseUrl: "https://www.iranopedia.com",
    fields: [
      { field: "title", instruction: "Dish name", maxWords: 8 },
      { field: "description", instruction: "What it is + key ingredients", maxWords: 120 },
    ],
    items: [{ slug: "ghormeh-sabzi", title: "Ghormeh Sabzi", brief: "the herb stew" }],
    contentRules: ["Call the language Persian, never Farsi."],
    flaggedTerms: ["Farsi"],
    ...over,
  };
}

function llmResponse(fields: Record<string, string>) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(fields) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200 },
    }),
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubEnv("BEACON_LLM_PROVIDER", "deterministic");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateClusterCards — gates", () => {
  it("refuses loudly in deterministic mode (no fake content, ever)", async () => {
    const r = await generateClusterCards(plan());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("llm_disabled");
  });

  it("caps items per run", async () => {
    const r = await generateClusterCards(
      plan({
        items: Array.from({ length: MAX_ITEMS_PER_RUN + 1 }, (_, i) => ({
          slug: `s${i}`, title: `T${i}`, brief: "b",
        })),
      }),
      { apiKey: "k", fetchImpl: (async () => llmResponse({})) as unknown as typeof fetch },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("too_many_items");
  });
});

describe("generateClusterCards — drafts", () => {
  it("produces a create card with slug + fields JSON and the cluster URL", async () => {
    const r = await generateClusterCards(plan(), {
      apiKey: "k",
      fetchImpl: (async () =>
        llmResponse({
          title: "Ghormeh Sabzi",
          description: "A slow-cooked Persian herb stew with kidney beans and dried lime.",
        })) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.drafts).toHaveLength(1);
    const d = r.drafts[0]!;
    expect(d.action_type).toBe("create_page");
    expect(d.target_element_key).toBe("create:Foods");
    expect(d.target_url).toBe("https://www.iranopedia.com/persian-food/ghormeh-sabzi");
    const parsed = JSON.parse(d.proposed_text ?? "{}") as Record<string, string>;
    expect(parsed.slug).toBe("ghormeh-sabzi");
    expect(parsed.description).toContain("herb stew");
    expect(d.risks).toEqual([]);
    expect(r.totalCostUsd).toBeGreaterThan(0);
  });

  it("flags content-rule violations into risks[] (Farsi term, word cap, empty)", async () => {
    const r = await generateClusterCards(plan(), {
      apiKey: "k",
      fetchImpl: (async () =>
        llmResponse({
          title: "How to cook Ghormeh Sabzi the famous Farsi national herb stew dish",
          description: "",
        })) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const risks = r.drafts[0]!.risks;
    expect(risks.some((x) => x.includes('"Farsi"'))).toBe(true);
    expect(risks.some((x) => x.includes("words"))).toBe(true);
    expect(risks.some((x) => x.includes("empty"))).toBe(true);
    expect(r.flagged).toBe(1);
  });

  it("validateDraftFields is pure and word-cap exact", () => {
    const risks = validateDraftFields(
      { title: "one two three", description: "fine" },
      { fields: [{ field: "title", instruction: "", maxWords: 2 }, { field: "description", instruction: "" }], flaggedTerms: [] },
    );
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain("3 words");
  });
});
