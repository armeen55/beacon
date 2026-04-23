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
