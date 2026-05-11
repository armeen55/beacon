/**
 * /prompts/[id] v2B — route-id encode/decode contract.
 *
 * Pins that the encoder is a `encodeURIComponent` pass-through
 * (so unsafe chars in any future provenance id round-trip safely)
 * and that the decoder rejects empty / non-string / whitespace
 * inputs as `null` (caller treats as not-found).
 */
import { describe, expect, it } from "vitest";

import {
  encodePromptRouteId,
  decodePromptRouteId,
} from "@/components/prompts/v2/prompt-route-id";

describe("encodePromptRouteId", () => {
  it("returns ASCII identifiers unchanged when they're already path-safe", () => {
    expect(encodePromptRouteId("p-winning")).toBe("p-winning");
    expect(encodePromptRouteId("abc.123_x-y")).toBe("abc.123_x-y");
  });

  it("encodes characters that are unsafe in URL path segments", () => {
    expect(encodePromptRouteId("a/b")).toBe("a%2Fb");
    expect(encodePromptRouteId("a b")).toBe("a%20b");
    expect(encodePromptRouteId("ns:slug[new]")).toBe("ns%3Aslug%5Bnew%5D");
  });

  it("encodes non-ASCII characters", () => {
    expect(encodePromptRouteId("résumé")).toBe("r%C3%A9sum%C3%A9");
  });

  it("round-trips through decodeURIComponent (Next.js's contract)", () => {
    const raw = "create_cluster_page:geo:Los Altos__add_faq__faq_question[new]:abc";
    expect(decodeURIComponent(encodePromptRouteId(raw))).toBe(raw);
  });
});

describe("decodePromptRouteId", () => {
  it("returns the trimmed string for well-formed input", () => {
    expect(decodePromptRouteId("p-winning")).toBe("p-winning");
    expect(decodePromptRouteId("  p-trim  ")).toBe("p-trim");
  });

  it("returns null for empty / non-string / whitespace-only input", () => {
    expect(decodePromptRouteId("")).toBe(null);
    expect(decodePromptRouteId("   ")).toBe(null);
    expect(decodePromptRouteId(null)).toBe(null);
    expect(decodePromptRouteId(undefined)).toBe(null);
    expect(decodePromptRouteId(42)).toBe(null);
    expect(decodePromptRouteId({})).toBe(null);
  });
});
