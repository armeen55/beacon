/**
 * 2026-07-01 - AI-referral source classification tests (BEACON_500 item 6).
 *
 * Pins the two-tier match in src/lib/connectors/ga4/ai-sources.ts:
 *   - EXACT host tier (post lowercase + trim + strip "www.") including the
 *     variant collapses (chat.openai.com -> chatgpt.com, bard -> gemini)
 *   - CONTAINS fallback for wild variants (m.chatgpt.com)
 *   - short hosts (you.com, meta.ai) match ONLY exactly, so thankyou.com and
 *     similar false positives stay out
 *   - never throws; unknown/empty/null -> null
 *   - aiSourceLabel maps persisted domains to operator names, falls back raw
 */

import { describe, it, expect } from "vitest";

import {
  classifyAiSource,
  aiSourceLabel,
  AI_SOURCE_FILTER_TERMS,
} from "@/lib/connectors/ga4/ai-sources";

describe("classifyAiSource - exact tier", () => {
  it("maps the canonical assistant hosts", () => {
    expect(classifyAiSource("chatgpt.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("perplexity.ai")?.domain).toBe("perplexity.ai");
    expect(classifyAiSource("gemini.google.com")?.domain).toBe("gemini.google.com");
    expect(classifyAiSource("copilot.microsoft.com")?.domain).toBe("copilot.microsoft.com");
    expect(classifyAiSource("claude.ai")?.domain).toBe("claude.ai");
    expect(classifyAiSource("you.com")?.domain).toBe("you.com");
    expect(classifyAiSource("meta.ai")?.domain).toBe("meta.ai");
  });

  it("collapses variants into one canonical bucket", () => {
    expect(classifyAiSource("chat.openai.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("openai.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("bard.google.com")?.domain).toBe("gemini.google.com");
  });

  it("normalizes case, whitespace, and a www. prefix", () => {
    expect(classifyAiSource("  ChatGPT.com  ")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("www.perplexity.ai")?.domain).toBe("perplexity.ai");
    expect(classifyAiSource("WWW.CLAUDE.AI")?.domain).toBe("claude.ai");
  });
});

describe("classifyAiSource - contains fallback", () => {
  it("catches subdomain and composite variants", () => {
    expect(classifyAiSource("m.chatgpt.com")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("chatgpt.com / referral")?.domain).toBe("chatgpt.com");
    expect(classifyAiSource("de.perplexity.ai")?.domain).toBe("perplexity.ai");
    expect(classifyAiSource("gemini.google.co.uk")?.domain).toBe("gemini.google.com");
    expect(classifyAiSource("copilot.microsoft.cn")?.domain).toBe("copilot.microsoft.com");
  });

  it("does NOT substring-match the short exact-only hosts", () => {
    // "you.com" is inside "thankyou.com"; "meta.ai" is inside "zermeta.ai".
    expect(classifyAiSource("thankyou.com")).toBeNull();
    expect(classifyAiSource("zermeta.ai")).toBeNull();
    expect(classifyAiSource("bayou.com")).toBeNull();
  });
});

describe("classifyAiSource - non-AI and junk input", () => {
  it("returns null for ordinary referrers", () => {
    expect(classifyAiSource("google")).toBeNull();
    expect(classifyAiSource("google.com")).toBeNull();
    expect(classifyAiSource("(direct)")).toBeNull();
    expect(classifyAiSource("facebook.com")).toBeNull();
    expect(classifyAiSource("bing")).toBeNull();
  });

  it("never throws on null, undefined, or empty", () => {
    expect(classifyAiSource(null)).toBeNull();
    expect(classifyAiSource(undefined)).toBeNull();
    expect(classifyAiSource("")).toBeNull();
    expect(classifyAiSource("   ")).toBeNull();
  });
});

describe("aiSourceLabel", () => {
  it("maps persisted canonical domains to operator names", () => {
    expect(aiSourceLabel("chatgpt.com")).toBe("ChatGPT");
    expect(aiSourceLabel("perplexity.ai")).toBe("Perplexity");
    expect(aiSourceLabel("gemini.google.com")).toBe("Gemini");
    expect(aiSourceLabel("copilot.microsoft.com")).toBe("Copilot");
    expect(aiSourceLabel("claude.ai")).toBe("Claude");
  });

  it("falls back honestly for unknown or missing values", () => {
    expect(aiSourceLabel("mystery.ai")).toBe("mystery.ai");
    expect(aiSourceLabel(null)).toBe("an AI assistant");
    expect(aiSourceLabel("")).toBe("an AI assistant");
  });
});

describe("AI_SOURCE_FILTER_TERMS", () => {
  it("covers every canonical assistant so the request-side filter cannot under-fetch", () => {
    // Every exact-tier host must be matchable by at least one broad term.
    const hosts = [
      "chatgpt.com",
      "chat.openai.com",
      "perplexity.ai",
      "gemini.google.com",
      "bard.google.com",
      "copilot.microsoft.com",
      "claude.ai",
      "you.com",
      "meta.ai",
    ];
    for (const host of hosts) {
      const covered = AI_SOURCE_FILTER_TERMS.some((t) => host.includes(t));
      expect(covered, `${host} must be covered by a filter term`).toBe(true);
    }
  });
});
