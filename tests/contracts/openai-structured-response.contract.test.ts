/**
 * N40 contract test - OpenAI Chat Completions structured (json_schema) response.
 *
 * Feeds a checked-in fixture of the REAL chat-completions envelope (choices[0]
 * .message.content carrying the stringified structured bundle, plus usage
 * token counts) through the ACTUAL provider (generateOpenAIBundle with an
 * injected fetchImpl - the same function the LLM draft gateway calls), so a
 * silent upstream change (moved content field, renamed usage keys, refusal
 * shape) fails a named test here instead of surfacing as forever-empty
 * bundles. NO live calls: the provider REFUSES to run under vitest without an
 * explicit fetchImpl, and this test always injects one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSpecificEditEvidencePacket } from "@/domains/recommendations/specific-edit-evidence";
import { generateOpenAIBundle } from "@/domains/recommendations/providers/openai";

const FROZEN_NOW = new Date("2026-07-03T12:00:00Z");

function fixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, "fixtures", "openai-chat-completion.json"), "utf-8"),
  ) as Record<string, unknown>;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makePacket() {
  return buildSpecificEditEvidencePacket({
    tenantId: "tenant-contract-test",
    recId: "rec-contract-2026-07-03",
    clusterLabel: "Koobideh kabob recipe",
    clusterKind: "topic",
    affectedPromptIds: [],
    promptOpportunities: [],
    trackedPrompts: [],
    primarySummaries: [],
    ownedPageInventory: [],
    pageElementInventory: [],
    observations: [],
    singleTargetUrl: null,
    now: FROZEN_NOW,
  });
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key-contract");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenAI structured-response contract", () => {
  it("parses choices[0].message.content (stringified JSON) into a full bundle with usage-priced cost", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(fixture())) as unknown as typeof fetch;

    const bundle = await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });

    expect(bundle.providerName).toBe("openai");
    expect(bundle.recommendations).toHaveLength(1);

    const edit = bundle.recommendations[0]!;
    expect(edit.actionType).toBe("edit_title");
    expect(edit.targetUrl).toBe("https://www.iranopedia.com/koobideh-kabob");
    // The gateway extracts proposed text from targetElement - the load-bearing field.
    expect(edit.targetElement?.proposedText).toBe(
      "Koobideh Kabob Recipe: Authentic Persian Ground Meat Kabob",
    );
    expect(edit.why.length).toBeGreaterThan(0);
    expect(edit.evidence).toHaveLength(2);
    expect(edit.difficulty).toBe("low");
    expect(edit.confidence).toBe("medium");
    expect(Array.isArray(edit.risks)).toBe(true);
    expect(edit.providerName).toBe("openai");

    // Cost derives from usage.prompt_tokens / usage.completion_tokens - if
    // OpenAI renames those keys, this pin catches it (cost would fall to 0).
    expect(bundle.totalCostUsd).toBeGreaterThan(0);
    expect(edit.costUsd).toBeGreaterThan(0);
  });

  it("a refusal in choices[0].message.refusal yields the SAFE empty bundle, not a throw", async () => {
    const body = fixture();
    (body.choices as Array<{ message: Record<string, unknown> }>)[0]!.message = {
      content: null,
      refusal: "I can't help with that.",
    };
    const fetchImpl = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;

    const bundle = await generateOpenAIBundle(makePacket(), { fetchImpl, now: FROZEN_NOW });
    expect(bundle.recommendations).toEqual([]);
  });

  it("a shape drift (missing choices) yields the SAFE empty bundle, not a throw", async () => {
    const body = fixture();
    delete body.choices;
    const fetchImpl = vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch;

    const bundle = await generateOpenAIBundle(makePacket(), { fetchImpl, now: FROZEN_NOW });
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.totalCostUsd).toBe(0);
  });
});
