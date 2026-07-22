/**
 * Sprint 6A.2b (2026-04-26) — OpenAI SpecificEditProvider live tests.
 *
 * NO REAL NETWORK CALLS. Every test injects a mocked `fetchImpl`.
 * `process.env.VITEST === "true"` is set automatically by vitest;
 * `generateOpenAIBundle` refuses to run without an explicit fetchImpl
 * in that environment, so accidental real calls would throw before
 * touching the wire.
 *
 * Coverage:
 *   - Vitest detection guard (no fetchImpl → throw)
 *   - Vercel build guard (VERCEL=1 → throw unless BEACON_LLM_BUILD_OK=1)
 *   - Missing OPENAI_API_KEY → throw
 *   - Strict-mode JSON schema is built from the packet:
 *     - actionType enum = packet.allowedActionTypes
 *     - targetUrl enum = packet.allowedTargetUrls + needs_new_page
 *   - Success path: response_format.json_schema in request body;
 *     parsed bundle stamps source/providerName/model and per-edit cost
 *   - 5xx → empty bundle (no throw)
 *   - Network error → empty bundle (no throw)
 *   - Malformed JSON in content → empty bundle
 *   - Missing content → empty bundle
 *   - Refusal → empty bundle
 *   - Cost compute respects token usage and model rates
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { buildSpecificEditEvidencePacket } from "../specific-edit-evidence";
import type { SpecificEditEvidencePacket } from "../specific-edit-evidence";
import {
  buildOpenAISpecificEditSchema,
  estimateCost,
  generateOpenAIBundle,
  openaiProvider,
} from "./openai";

const FROZEN_NOW = new Date("2026-04-26T12:00:00Z");

function makePacket(
  overrides: Partial<SpecificEditEvidencePacket> = {},
): SpecificEditEvidencePacket {
  const base = buildSpecificEditEvidencePacket({
    tenantId: "tenant-test",
    recId: "rec-2026-04-26-1",
    clusterLabel: "Atherton kitchen remodel",
    clusterKind: "geo",
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
  return { ...base, ...overrides };
}

/**
 * Build an OpenAI Chat Completions API response with the given parsed
 * content + token usage. The provider parses `choices[0].message.content`
 * as JSON.
 */
function makeChatResponse(opts: {
  content: unknown | string;
  promptTokens?: number;
  completionTokens?: number;
}): Response {
  const contentStr =
    typeof opts.content === "string" ? opts.content : JSON.stringify(opts.content);
  const body = {
    choices: [
      {
        message: { content: contentStr, refusal: null },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: opts.promptTokens ?? 1000,
      completion_tokens: opts.completionTokens ?? 500,
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.VERCEL;
  delete process.env.NEXT_PHASE;
  delete process.env.BEACON_LLM_BUILD_OK;
  process.env.OPENAI_API_KEY = "sk-test-fixture";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("openai provider — Vitest safety gate", () => {
  it("throws when fetchImpl is omitted under vitest", async () => {
    // VITEST is set automatically by the runner.
    expect(process.env.VITEST).toBe("true");
    await expect(generateOpenAIBundle(makePacket())).rejects.toThrow(
      /fetchImpl is required/,
    );
  });

  it("openaiProvider.generate(packet) (no options) also throws under vitest", async () => {
    await expect(openaiProvider.generate(makePacket())).rejects.toThrow(
      /fetchImpl is required/,
    );
  });
});

describe("openai provider — production-BUILD guard (not runtime)", () => {
  it("throws during the Next.js production build (NEXT_PHASE) when BEACON_LLM_BUILD_OK is not set", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const fetchImpl = vi.fn();
    await expect(
      generateOpenAIBundle(makePacket(), { fetchImpl }),
    ).rejects.toThrow(/production build/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("permits the call during the build when BEACON_LLM_BUILD_OK=1", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    process.env.BEACON_LLM_BUILD_OK = "1";
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    const bundle = await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });
    expect(bundle.recommendations).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("PERMITS a hosted RUNTIME call when VERCEL=1 but NOT building (2026-06-15 golden-path fix)", async () => {
    // The old guard gated on VERCEL===1, which is true at runtime too, so it
    // wrongly refused every hosted LLM request. The guard now keys on the
    // build phase only, so a real Vercel runtime invocation must succeed.
    process.env.VERCEL = "1";
    delete process.env.NEXT_PHASE;
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    const bundle = await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });
    expect(bundle.recommendations).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("openai provider — config gate", () => {
  it("throws when OPENAI_API_KEY is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchImpl = vi.fn();
    await expect(
      generateOpenAIBundle(makePacket(), { fetchImpl }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("throws when OPENAI_API_KEY is whitespace", async () => {
    process.env.OPENAI_API_KEY = "   ";
    const fetchImpl = vi.fn();
    await expect(
      generateOpenAIBundle(makePacket(), { fetchImpl }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("openai provider — JSON schema is packet-derived", () => {
  it("constrains actionType to packet.allowedActionTypes", () => {
    const packet = makePacket({
      allowedActionTypes: ["edit_title", "add_h2_section", "add_faq"],
    });
    const schema = buildOpenAISpecificEditSchema(packet) as unknown as {
      properties: { recommendations: { items: { properties: { actionType: { enum: string[] } } } } };
    };
    const enumValues = schema.properties.recommendations.items.properties.actionType.enum;
    expect(enumValues).toEqual(["edit_title", "add_h2_section", "add_faq"]);
  });

  it("constrains targetUrl to packet.allowedTargetUrls plus needs_new_page", () => {
    const packet = makePacket({
      allowedTargetUrls: ["https://example.com/a", "https://example.com/b"],
    });
    const schema = buildOpenAISpecificEditSchema(packet) as unknown as {
      properties: { recommendations: { items: { properties: { targetUrl: { enum: string[] } } } } };
    };
    const enumValues = schema.properties.recommendations.items.properties.targetUrl.enum;
    expect(enumValues).toContain("https://example.com/a");
    expect(enumValues).toContain("https://example.com/b");
    expect(enumValues).toContain("needs_new_page");
  });

  it("does NOT duplicate needs_new_page when packet already includes it", () => {
    const packet = makePacket({
      allowedTargetUrls: ["https://example.com/a", "needs_new_page"],
    });
    const schema = buildOpenAISpecificEditSchema(packet) as unknown as {
      properties: { recommendations: { items: { properties: { targetUrl: { enum: string[] } } } } };
    };
    const enumValues = schema.properties.recommendations.items.properties.targetUrl.enum;
    const sentinelCount = enumValues.filter((v) => v === "needs_new_page").length;
    expect(sentinelCount).toBe(1);
  });

  it("forbids additional properties on the edit object (strict mode)", () => {
    const schema = buildOpenAISpecificEditSchema(makePacket()) as unknown as {
      properties: { recommendations: { items: { additionalProperties: boolean; required: string[] } } };
    };
    expect(schema.properties.recommendations.items.additionalProperties).toBe(false);
    expect(schema.properties.recommendations.items.required).toContain("actionType");
    expect(schema.properties.recommendations.items.required).toContain("targetUrl");
  });
});

describe("openai provider — success path", () => {
  it("calls fetch with a strict-mode json_schema response_format", async () => {
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    await generateOpenAIBundle(makePacket(), { fetchImpl, now: FROZEN_NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer sk-/);
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe("specific_edit_bundle");
  });

  it("returns a bundle with empty recommendations when the model returns []", async () => {
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    const bundle = await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });
    expect(bundle.providerName).toBe("openai");
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.tenantId).toBe("tenant-test");
    expect(bundle.recId).toBe("rec-2026-04-26-1");
    expect(bundle.evidenceHash).toBe(makePacket().evidenceHash);
    expect(bundle.schemaVersion).toBe("specific-edit-bundle/v1");
  });

  it("stamps source/providerName/model and per-edit costUsd", async () => {
    const recommendation = {
      actionType: "edit_title",
      targetUrl: "https://example.com/a",
      targetElement: {
        elementKey: "title[0]:abc",
        displayLabel: "Page title",
        currentText: "Old title",
        proposedText: "New title with city",
      },
      why: "Cited prompt indicates city missing in title",
      evidence: [
        { type: "prompt", promptId: "p-1" },
      ],
      expectedImpact: null,
      difficulty: "low",
      confidence: "medium",
      measurementPlan: null,
      risks: [],
    };
    const packet = makePacket({
      allowedTargetUrls: ["https://example.com/a"],
      allowedActionTypes: ["edit_title"],
    });
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({
        content: { recommendations: [recommendation] },
        promptTokens: 2000,
        completionTokens: 1000,
      }),
    );
    const bundle = await generateOpenAIBundle(packet, {
      fetchImpl,
      now: FROZEN_NOW,
    });
    expect(bundle.recommendations).toHaveLength(1);
    const edit = bundle.recommendations[0];
    expect(edit.source).toBe("openai");
    expect(edit.providerName).toBe("openai");
    expect(edit.model).toBe("gpt-5-mini");
    expect(edit.costUsd).not.toBeNull();
    expect(edit.costUsd!).toBeGreaterThan(0);
    // gpt-5-mini: 2000/1M * 0.25 + 1000/1M * 2.0 = 0.0005 + 0.002 = 0.0025
    expect(bundle.totalCostUsd).toBeCloseTo(0.0025, 6);
  });

  it("respects model override", async () => {
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
      model: "gpt-5-nano",
    });
    const init = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init[1].body as string);
    expect(body.model).toBe("gpt-5-nano");
  });
});

describe("openai provider — failure modes return empty bundle (no throw)", () => {
  const FAILURE_MODES: ReadonlyArray<[string, () => Promise<Response>]> = [
    ["5xx response", async () => new Response("internal error", { status: 500 })],
    ["4xx response", async () => new Response("rate limited", { status: 429 })],
    [
      "network error",
      async () => {
        throw new Error("ENETDOWN");
      },
    ],
    ["malformed top-level JSON in HTTP body", async () => new Response("not-json", { status: 200 })],
    [
      "malformed JSON inside `choices[0].message.content`",
      async () => makeChatResponse({ content: "{not valid json" }),
    ],
    [
      "missing message.content",
      async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
        }),
    ],
    [
      "model refusal",
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { refusal: "policy violation" } }],
          }),
          { status: 200 },
        ),
    ],
    [
      "recommendations is not an array",
      async () => makeChatResponse({ content: { recommendations: "oops" } }),
    ],
  ];

  it.each(FAILURE_MODES)("%s → empty bundle", async (_name, impl) => {
    const fetchImpl = vi.fn(impl);
    const bundle = await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });
    expect(bundle.recommendations).toEqual([]);
    expect(bundle.providerName).toBe("openai");
    expect(bundle.totalCostUsd).toBe(0);
  });
});

// ── Sprint 6A.2f follow-up — system prompt content is pinned ────────────

describe("openai provider — system prompt hardening (Sprint 6A.2f)", () => {
  // Read the source file directly so the tests pin the prompt text
  // without exporting it (keeping the public API surface minimal).
  // If the prompt is restructured we want this test to fail loud so
  // the operator re-reviews the safety contract.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const PROVIDER_PATH = path.resolve(
    __dirname,
    "openai.ts",
  );
  const providerSrc = fs.readFileSync(PROVIDER_PATH, "utf8");

  it("instructs the model to copy promptIds verbatim (full UUID)", () => {
    expect(providerSrc).toMatch(/FULL UUID/);
    expect(providerSrc).toMatch(/copied verbatim/);
  });

  it("explicitly forbids abbreviating / truncating promptIds", () => {
    // The abbreviation guard wording — caught the live --write bug
    // where the model truncated UUIDs to first-8-hex.
    expect(providerSrc).toMatch(
      /abbreviated.*truncated|first 8 hex|first 8 characters/i,
    );
  });

  it("includes a good and bad UUID example", () => {
    // Pin the example so future edits keep the demonstrate-by-contrast
    // teaching moment in place.
    expect(providerSrc).toMatch(/GOOD:\s*"promptId":"[0-9a-f]{8}-/);
    expect(providerSrc).toMatch(/BAD\s*:\s*"promptId":"[0-9a-f]{8}"/);
  });

  it("requires proposedText to be final website-ready copy when possible", () => {
    expect(providerSrc).toMatch(/final website-ready copy/);
  });

  it("forbids meta-instructional proposedText phrasings", () => {
    // The exact phrases observed in the dry-run that the operator
    // flagged as not-final-copy. Keeping them in the test pins the
    // anti-pattern.
    expect(providerSrc).toMatch(/this section should explain/);
    expect(providerSrc).toMatch(/include a clear statement/);
    expect(providerSrc).toMatch(/outline common scopes/);
  });

  it("distinguishes edit_title (HTML <title>) from change_h1 (visible H1)", () => {
    // [\s\S] spans newlines (some TS targets reject the /s flag, see
    // 6A.2a config-test fix for the same workaround).
    expect(providerSrc).toMatch(/edit_title[\s\S]*<title>/);
    expect(providerSrc).toMatch(/change_h1[\s\S]*visible on-page H1/);
    // The mismatch warning the validator catches.
    expect(providerSrc).toMatch(/element_type[\s\S]*actionType[\s\S]*mismatch/i);
  });

  it("preserves the prior 8 rules + adds rule 9, 10, 11", () => {
    // Pre-existing rules — quick smoke that we didn't truncate them.
    expect(providerSrc).toMatch(/HARD RULES:/);
    expect(providerSrc).toMatch(/1\. actionType MUST be one of allowedActionTypes/);
    expect(providerSrc).toMatch(/8\. \*\*targetElement is REQUIRED/);
    // New rules from this fix.
    expect(providerSrc).toMatch(/9\. \*\*evidence\[\]\.promptId MUST/);
    expect(providerSrc).toMatch(/10\. \*\*edit_title vs change_h1/);
    expect(providerSrc).toMatch(/11\. \*\*proposedText must be final/);
  });

  // Sprint 6A.2g.B (2026-04-26) — competitor public-copy rule pin.
  it("Sprint 6A.2g.B — Rule 12 competitor-names-are-evidence-not-copy", () => {
    expect(providerSrc).toMatch(/12\. \*\*Competitor names are EVIDENCE, not public copy\.\*\*/);
    // Operator-facing slots where competitor names ARE allowed.
    expect(providerSrc).toMatch(/the "why" field \(operator-facing reasoning\)/);
    expect(providerSrc).toMatch(/evidence refs \(type="competitor", competitorName\)/);
    // Visitor-readable slots where competitor names are forbidden.
    expect(providerSrc).toMatch(/NEVER include a competitor name/);
    expect(providerSrc).toMatch(/proposedText \(the copy that ships to the live site\)/);
    expect(providerSrc).toMatch(/targetElement\.displayLabel/);
    // Pinned BAD/GOOD example demonstrating the differentiator-in-why
    // pattern.
    expect(providerSrc).toMatch(/BAD\s*:\s*proposedText\s*=\s*"Why teams choose us over De Mattei/);
    expect(providerSrc).toMatch(/GOOD:\s*proposedText\s*=\s*"Why Bay Area homeowners choose/);
    // Suffix-stripped variant guarantee.
    expect(providerSrc).toMatch(/safe[\s\S]*suffix-stripped variants/);
  });

  // Sprint 6A.2g.C (2026-04-26) — FAQ intent rewriting rule pin.
  it("Sprint 6A.2g.C — Rule 13 FAQ-must-not-lift-prompt-text + ends-in-?", () => {
    expect(providerSrc).toMatch(/13\. \*\*FAQ questions must NOT lift synthetic prompt text verbatim\.\*\*/);
    // Both BAD/GOOD examples are pinned so future edits can't lose the
    // teach-by-contrast pair.
    expect(providerSrc).toMatch(
      /BAD\s*:\s*"best whole home remodel builders bay area"/,
    );
    expect(providerSrc).toMatch(
      /GOOD:\s*"Who are the best whole home remodel builders[\s\S]*Bay Area\?"/,
    );
    // Required hygiene: question must end with ?, ≤200 chars, cover
    // an affected prompt's intent, NOT lift the stem.
    expect(providerSrc).toMatch(/proposedText MUST end with "\?"/);
    expect(providerSrc).toMatch(/proposedText MUST be \u2264 200 characters/);
    expect(providerSrc).toMatch(/MUST NOT begin with the synthetic prompt text/);
    // faq_answer is explicitly carved out.
    expect(providerSrc).toMatch(/faq_answer targetElement, this[\s\S]*rule does NOT apply/);
  });

  // Sprint 6A.2g.E (2026-04-26) — evidence-priority rule pin.
  it("Sprint 6A.2g.E — Rule 14 EVIDENCE PRIORITY ORDER + 4-level enumeration", () => {
    expect(providerSrc).toMatch(/14\. \*\*EVIDENCE PRIORITY ORDER\.\*\*/);
    expect(providerSrc).toMatch(/\(1\) packet\.affectedPrompts\[\*\]\.actualSearchQueries/);
    expect(providerSrc).toMatch(/\(2\) packet\.affectedPrompts\[\*\]\.citedSourcePages/);
    expect(providerSrc).toMatch(/\(3\) packet\.affectedPrompts\[\*\]\.descriptorWindows/);
    expect(providerSrc).toMatch(/\(4\) packet\.affectedPrompts\[\*\]\.promptText/);
    // The fallback wording is the operationally critical part — the model
    // must NOT lift synthetic prompt text into copy when richer evidence
    // is available.
    expect(providerSrc).toMatch(/Fall back to this ONLY when/);
    expect(providerSrc).toMatch(/NOT how a customer would[\s\S]*phrase/);
    // The why-citation requirement.
    expect(providerSrc).toMatch(/which level you drew evidence from/);
  });
});

describe("estimateCost — public for budget gate in 6A.2c", () => {
  it("computes gpt-5-mini cost from input + output tokens", () => {
    // 1M in × $0.25 + 1M out × $2.0 = $0.25 + $2.00 = $2.25
    expect(estimateCost("gpt-5-mini", 1_000_000, 1_000_000)).toBeCloseTo(2.25, 6);
  });

  it("computes gpt-5-nano cost from input + output tokens", () => {
    // 1M in × $0.05 + 1M out × $0.40 = $0.05 + $0.40 = $0.45
    expect(estimateCost("gpt-5-nano", 1_000_000, 1_000_000)).toBeCloseTo(0.45, 6);
  });

  it("falls back to gpt-5-mini rates when model is unknown", () => {
    expect(estimateCost("unknown-model", 1_000_000, 1_000_000)).toBeCloseTo(2.25, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCost("gpt-5-mini", 0, 0)).toBe(0);
  });

  it("rounds to 6 decimal places", () => {
    // Construct an input that would otherwise produce 7+ decimals.
    const cost = estimateCost("gpt-5-mini", 12345, 6789);
    const decimals = cost.toString().split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(6);
  });
});

// ── W3 Step 3.4 — SYSTEM_PROMPT v2 sections ────────────────────────────

describe("W3 Step 3.4 — SYSTEM_PROMPT v2 references the new evidence packet sections", () => {
  /**
   * The W3 Step 3.2 packet ships three new aggregated blocks
   * (aiSearchSignal / competitorPageBlueprints / crossTenantPatterns)
   * AND the operator's 7 grounding rules. The LLM MUST be told to
   * use them or it falls back to the synthetic prompt text and
   * generic advice. These tests inspect the system message the
   * provider sends to OpenAI and pin every operator-locked section
   * by phrase. If the prompt drifts away from the contract, the
   * test fails — preventing silent regression of the trust contract.
   */

  async function readSystemPrompt(): Promise<string> {
    const fetchImpl = vi.fn(async () =>
      makeChatResponse({ content: { recommendations: [] } }),
    );
    await generateOpenAIBundle(makePacket(), {
      fetchImpl,
      now: FROZEN_NOW,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    const sysMsg = body.messages.find(
      (m: { role: string; content: string }) => m.role === "system",
    );
    return sysMsg.content as string;
  }

  it("references packet.aiSearchSignal.topSearchQueries", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/aiSearchSignal\.topSearchQueries/);
    expect(prompt).toMatch(/MIRROR these phrasings/i);
  });

  it("references packet.aiSearchSignal.topDescriptors", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/aiSearchSignal\.topDescriptors/);
    expect(prompt).toMatch(/ECHO these descriptors/i);
  });

  it("references packet.aiSearchSignal.topCompetitorCoMentions and treats names as evidence-only", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/aiSearchSignal\.topCompetitorCoMentions/);
    // Word "evidence-only" may wrap across a line break — collapse
    // whitespace before testing the phrase intent.
    const collapsed = prompt.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/evidence-?\s*only/i);
  });

  it("references packet.competitorPageBlueprints with a structure-not-name instruction", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/competitorPageBlueprints/);
    expect(prompt).toMatch(/STRUCTURE \/ ANGLE/);
    // Apostrophe + line wrap in "competitor's name" — collapse
    // whitespace and use a flexible apostrophe match.
    const collapsed = prompt.replace(/\s+/g, " ");
    expect(collapsed).toMatch(/Do NOT mention the competitor.s name/);
  });

  it("references packet.crossTenantPatterns and notes the empty-stub state", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/crossTenantPatterns/);
    expect(prompt).toMatch(/EMPTY by design/);
  });

  it("instructs the model to abstain on thin evidence rather than emit generic copy", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/RETURN \[\] FOR THIS PACKET/);
    expect(prompt).toMatch(/Better empty than generic/i);
  });

  it("instructs the model to never emit placeholder copy (matches the W3 Step 3.1 phrase set)", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/Draft answer/);
    expect(prompt).toMatch(/\bTBD\b/);
    expect(prompt).toMatch(/operator: rewrite/);
    expect(prompt).toMatch(/rewrite below/);
    expect(prompt).toMatch(/\[insert/);
    expect(prompt).toMatch(/\bplaceholder\b/);
    expect(prompt).toMatch(/\bTODO:/);
  });

  it("preserves Rule 12 (no competitor names in public copy)", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/Competitor names are EVIDENCE/i);
    expect(prompt).toMatch(/NEVER include a competitor name/);
  });

  it("preserves Rule 14 evidence priority order (per-prompt arrays still drive copy choice)", async () => {
    const prompt = await readSystemPrompt();
    expect(prompt).toMatch(/EVIDENCE PRIORITY ORDER/);
    expect(prompt).toMatch(/actualSearchQueries/);
    expect(prompt).toMatch(/citedSourcePages/);
    expect(prompt).toMatch(/descriptorWindows/);
  });
});
