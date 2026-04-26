/**
 * Sprint 6A.2a (2026-04-26) — tests for the LLM provider config gate.
 *
 * Pin the contract documented in src/lib/llm/config.ts. No real network
 * calls, no real SDK imports, no live OpenAI activation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("resolveLLMProvider — Sprint 6A.2a config gate", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Start from a clean env every test — env reads happen at call time
    // so we don't need vi.resetModules().
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BEACON_LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to 'deterministic' when BEACON_LLM_PROVIDER is unset", async () => {
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("deterministic");
  });

  it("defaults to 'deterministic' when BEACON_LLM_PROVIDER is empty string", async () => {
    process.env.BEACON_LLM_PROVIDER = "";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("deterministic");
  });

  it("trims whitespace; an env of '   ' resolves to default", async () => {
    process.env.BEACON_LLM_PROVIDER = "   ";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("deterministic");
  });

  it("explicit 'deterministic' returns 'deterministic' (no API key required)", async () => {
    process.env.BEACON_LLM_PROVIDER = "deterministic";
    // Intentionally NOT setting OPENAI_API_KEY — deterministic must not require it.
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("deterministic");
  });

  it("'openai' resolves when OPENAI_API_KEY is set", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("openai");
  });

  it("'openai' throws when OPENAI_API_KEY is missing", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    delete process.env.OPENAI_API_KEY;
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(() => resolveLLMProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it("'openai' throws when OPENAI_API_KEY is whitespace-only", async () => {
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "   ";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(() => resolveLLMProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it("invalid provider name throws with allowed-values list", async () => {
    process.env.BEACON_LLM_PROVIDER = "totally-bogus";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    let caught: unknown;
    try {
      resolveLLMProvider();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/invalid BEACON_LLM_PROVIDER/);
    expect(msg).toMatch(/"deterministic"/);
    expect(msg).toMatch(/"openai"/);
  });

  it("'anthropic' is rejected even though it appears in SpecificEditProviderName", async () => {
    process.env.BEACON_LLM_PROVIDER = "anthropic";
    // Set the OpenAI key so the failure isn't an OPENAI_API_KEY throw —
    // we want to prove anthropic is rejected at the allowed-values gate.
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    let caught: unknown;
    try {
      resolveLLMProvider();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    expect(msg).toMatch(/invalid BEACON_LLM_PROVIDER/);
    expect(msg).toMatch(/"deterministic"/);
    expect(msg).toMatch(/"openai"/);
  });

  it("'anthropic' error message names Sprint 6A.2 + suggests fallback", async () => {
    process.env.BEACON_LLM_PROVIDER = "anthropic";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(() => resolveLLMProvider()).toThrow(/Sprint 6A\.2/);
  });

  it("isAllowedProvider type-guards the union", async () => {
    const { isAllowedProvider } = await import("@/lib/llm/config");
    expect(isAllowedProvider("deterministic")).toBe(true);
    expect(isAllowedProvider("openai")).toBe(true);
    expect(isAllowedProvider("anthropic")).toBe(false);
    expect(isAllowedProvider("nonsense")).toBe(false);
    expect(isAllowedProvider("")).toBe(false);
  });
});
