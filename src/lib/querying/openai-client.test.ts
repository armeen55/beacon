import { describe, it, expect } from "vitest";
import { parseOpenAIResponse } from "./openai-client";

describe("parseOpenAIResponse", () => {
  it("extracts answer text and url citations from a full Responses API payload", () => {
    const body = {
      id: "resp_123",
      model: "gpt-4o-2024-xx",
      output: [
        { type: "web_search_call", id: "ws_1", status: "completed" },
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: "Ritz Builders and Supple Homes are top picks.",
              annotations: [
                {
                  type: "url_citation",
                  start_index: 0,
                  end_index: 50,
                  url: "https://www.ritzbuilders.com/about",
                  title: "About Ritz Builders",
                },
                {
                  type: "url_citation",
                  start_index: 51,
                  end_index: 80,
                  url: "https://supplehomesinc.com",
                  title: null,
                },
                {
                  type: "url_citation",
                  start_index: 81,
                  end_index: 90,
                  url: "https://houzz.com/some/path",
                },
              ],
            },
          ],
        },
      ],
    };

    const result = parseOpenAIResponse(body, "gpt-4o");

    expect(result.answer_text).toBe(
      "Ritz Builders and Supple Homes are top picks.",
    );
    expect(result.model).toBe("gpt-4o-2024-xx");
    expect(result.citations).toHaveLength(3);

    // www. is stripped from the domain; full URL preserved
    expect(result.citations[0]).toMatchObject({
      url: "https://www.ritzbuilders.com/about",
      domain: "ritzbuilders.com",
      title: "About Ritz Builders",
      position: 1,
    });
    expect(result.citations[1]).toMatchObject({
      url: "https://supplehomesinc.com",
      domain: "supplehomesinc.com",
      title: null,
      position: 2,
    });
    expect(result.citations[2]).toMatchObject({
      url: "https://houzz.com/some/path",
      domain: "houzz.com",
      title: null, // title missing in input → null
      position: 3,
    });
  });

  it("returns empty citations when the message has no annotations", () => {
    const body = {
      model: "gpt-4o-2024-xx",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Bare answer with no sources." }],
        },
      ],
    };
    const result = parseOpenAIResponse(body, "gpt-4o");
    expect(result.answer_text).toBe("Bare answer with no sources.");
    expect(result.citations).toEqual([]);
  });

  it("filters non-url_citation annotations and falls back when model is missing", () => {
    const body = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "Mixed annotations.",
              annotations: [
                { type: "file_citation", file_id: "file_1" }, // ignored
                {
                  type: "url_citation",
                  url: "https://example.com",
                  title: "ex",
                },
                { type: "url_citation" }, // no url → filtered out
              ],
            },
          ],
        },
      ],
    };
    const result = parseOpenAIResponse(body, "gpt-4o");
    expect(result.model).toBe("gpt-4o"); // fell back to provided default
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].domain).toBe("example.com");
  });

  it("handles empty output (degenerate responses)", () => {
    const result = parseOpenAIResponse({ model: "gpt-4o" }, "gpt-4o");
    expect(result.answer_text).toBe("");
    expect(result.citations).toEqual([]);
  });
});

// ─ Sprint 6A.2g.D — max-extraction tests ────────────────────────────────

describe("parseOpenAIResponse — max-extraction (Sprint 6A.2g.D)", () => {
  it("extracts every signal from a fully populated Responses API payload", () => {
    const body = {
      id: "resp_max_extraction",
      model: "gpt-5-mini-2026",
      system_fingerprint: "fp_abc123",
      service_tier: "scale",
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "completed",
          action: {
            type: "search",
            query: "best whole home remodel builders bay area",
          },
        },
        {
          type: "web_search_call",
          id: "ws_2",
          status: "completed",
          action: {
            type: "open_page",
            url: "https://www.ritzbuilders.com/services/whole-home-remodel",
          },
        },
        {
          type: "web_search_call",
          id: "ws_3",
          status: "completed",
          action: {
            type: "open_page",
            url: "https://supplehomesinc.com",
          },
        },
        {
          type: "message",
          role: "assistant",
          finish_reason: "stop",
          content: [
            {
              type: "output_text",
              text: "Final answer.",
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 800,
        total_tokens: 2300,
        input_tokens_details: { cached_tokens: 1024 },
        output_tokens_details: { reasoning_tokens: 320 },
      },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    const usage = result.usage;
    expect(usage).toBeDefined();
    if (!usage) return;

    expect(usage.inputTokens).toBe(1500);
    expect(usage.outputTokens).toBe(800);
    expect(usage.webSearchCalls).toBe(3);
    expect(usage.systemFingerprint).toBe("fp_abc123");
    expect(usage.serviceTier).toBe("scale");
    expect(usage.reasoningTokens).toBe(320);
    expect(usage.cachedTokens).toBe(1024);
    expect(usage.refusalText).toBeNull();
    expect(usage.finishReason).toBe("stop");

    expect(usage.webSearchQueries).toEqual([
      {
        id: "ws_1",
        status: "completed",
        actionType: "search",
        query: "best whole home remodel builders bay area",
        url: undefined,
      },
      {
        id: "ws_2",
        status: "completed",
        actionType: "open_page",
        query: undefined,
        url: "https://www.ritzbuilders.com/services/whole-home-remodel",
      },
      {
        id: "ws_3",
        status: "completed",
        actionType: "open_page",
        query: undefined,
        url: "https://supplehomesinc.com",
      },
    ]);

    expect(usage.openPageUrls).toEqual([
      "https://www.ritzbuilders.com/services/whole-home-remodel",
      "https://supplehomesinc.com",
    ]);

    expect(usage.providerRaw).toBeDefined();
    expect(usage.providerRaw?.responseId).toBe("resp_max_extraction");
    expect(usage.providerRaw?.truncated).toBe(false);
    expect(usage.providerRaw?.toolCalls).toHaveLength(3);
  });

  it("caps providerRaw.toolCalls at 20 + flips truncated when >20 web_search_call items", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      type: "web_search_call",
      id: `ws_${i}`,
      status: "completed",
      action: { type: "search", query: `q${i}` },
    }));
    const body = {
      id: "resp_truncate",
      model: "gpt-5-mini",
      output: [
        ...items,
        {
          type: "message",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    const usage = result.usage;
    expect(usage).toBeDefined();
    if (!usage) return;
    // webSearchCalls counts ALL items (full 25). The cap only bounds the
    // forensic blob — the extracted/normalized arrays carry full data.
    expect(usage.webSearchCalls).toBe(25);
    expect(usage.webSearchQueries).toHaveLength(25);
    expect(usage.providerRaw?.toolCalls).toHaveLength(20);
    expect(usage.providerRaw?.truncated).toBe(true);
  });

  it("preserves status: 'in_progress' rows verbatim (does not filter)", () => {
    const body = {
      id: "resp_in_progress",
      model: "gpt-5-mini",
      output: [
        {
          type: "web_search_call",
          id: "ws_1",
          status: "in_progress",
          action: { type: "search", query: "started but not done" },
        },
        {
          type: "web_search_call",
          id: "ws_2",
          status: "completed",
          action: { type: "search", query: "this one finished" },
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    const usage = result.usage;
    expect(usage).toBeDefined();
    if (!usage) return;
    expect(usage.webSearchQueries).toHaveLength(2);
    expect(usage.webSearchQueries?.[0].status).toBe("in_progress");
    expect(usage.webSearchQueries?.[0].query).toBe("started but not done");
    expect(usage.webSearchQueries?.[1].status).toBe("completed");
    expect(usage.webSearchCalls).toBe(2);
  });

  it("captures refusal text when the model declines via content[].refusal", () => {
    const body = {
      id: "resp_refusal",
      model: "gpt-5-mini",
      output: [
        {
          type: "message",
          finish_reason: "content_filter",
          content: [
            { type: "refusal", refusal: "I can't help with that request." },
          ],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 10 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    const usage = result.usage;
    expect(usage).toBeDefined();
    if (!usage) return;
    expect(usage.refusalText).toBe("I can't help with that request.");
    expect(usage.finishReason).toBe("content_filter");
  });

  it("returns empty extracted arrays + null fields when web_search_call + extras are absent", () => {
    const body = {
      id: "resp_minimal",
      model: "gpt-5-mini",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "Plain answer." }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    const usage = result.usage;
    expect(usage).toBeDefined();
    if (!usage) return;
    expect(usage.webSearchCalls).toBe(0);
    expect(usage.webSearchQueries).toEqual([]);
    expect(usage.openPageUrls).toEqual([]);
    expect(usage.systemFingerprint).toBeNull();
    expect(usage.serviceTier).toBeNull();
    expect(usage.reasoningTokens).toBe(0);
    expect(usage.cachedTokens).toBe(0);
    expect(usage.refusalText).toBeNull();
    expect(usage.finishReason).toBeNull();
    expect(usage.providerRaw?.toolCalls).toEqual([]);
    expect(usage.providerRaw?.truncated).toBe(false);
    expect(usage.providerRaw?.responseId).toBe("resp_minimal");
  });

  it("falls back to top-level finish_reason when message item omits it", () => {
    const body = {
      id: "resp_finish_top",
      model: "gpt-5-mini",
      finish_reason: "length",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "truncated answer..." }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 200 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    expect(result.usage?.finishReason).toBe("length");
  });

  it("dedupes openPageUrls (same URL opened twice → one entry)", () => {
    const body = {
      id: "resp_dedupe",
      model: "gpt-5-mini",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "open_page",
            url: "https://example.com/page",
          },
        },
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "open_page",
            url: "https://example.com/page",
          },
        },
        {
          type: "message",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    expect(result.usage?.openPageUrls).toEqual(["https://example.com/page"]);
  });

  it("preserves webSearchCalls count behavior (existing 6A.3a contract)", () => {
    // Regression guard — the count was the original signal, the rest is
    // additive. Make sure we didn't break it.
    const body = {
      id: "resp_count",
      model: "gpt-5-mini",
      output: [
        { type: "web_search_call", status: "completed" },
        { type: "web_search_call", status: "completed" },
        { type: "web_search_call", status: "completed" },
        {
          type: "message",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    expect(result.usage?.webSearchCalls).toBe(3);
  });

  it("emits usage = undefined when the API omits the usage object entirely (legacy mock contract)", () => {
    const body = {
      id: "resp_no_usage",
      model: "gpt-5-mini",
      system_fingerprint: "fp_xyz", // present but irrelevant — no usage means no extraction
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "answer" }],
        },
      ],
    };
    const result = parseOpenAIResponse(body, "gpt-5-mini");
    expect(result.usage).toBeUndefined();
  });
});
