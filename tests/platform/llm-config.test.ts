/**
 * PLATFORM — LLM provider config gate + structured-output schema registry
 * (Core 100K terminal suite; merged from tests/lib/llm/config.test.ts and
 * tests/llm-regression/schema-registry.test.ts).
 *
 * No real network calls, no real SDK imports, no live provider activation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LLM_OUTPUT_SCHEMAS, type LlmOutputSchemaName } from "@/domains/llm/schemas";

describe("resolveLLMProvider config gate", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BEACON_LLM_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to 'deterministic' when unset, empty, or whitespace", async () => {
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    expect(resolveLLMProvider()).toBe("deterministic");
    process.env.BEACON_LLM_PROVIDER = "   ";
    expect(resolveLLMProvider()).toBe("deterministic");
  });

  it("'openai' resolves only when OPENAI_API_KEY is set; missing/blank key throws", async () => {
    const { resolveLLMProvider } = await import("@/lib/llm/config");
    process.env.BEACON_LLM_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    expect(resolveLLMProvider()).toBe("openai");
    process.env.OPENAI_API_KEY = "   ";
    expect(() => resolveLLMProvider()).toThrow(/OPENAI_API_KEY/);
    delete process.env.OPENAI_API_KEY;
    expect(() => resolveLLMProvider()).toThrow(/OPENAI_API_KEY/);
  });

  it("an invalid or unactivated provider name throws with the allowed-values list", async () => {
    const { resolveLLMProvider, isAllowedProvider } = await import("@/lib/llm/config");
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    for (const bad of ["totally-bogus", "anthropic"]) {
      process.env.BEACON_LLM_PROVIDER = bad;
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
    }
    expect(isAllowedProvider("deterministic")).toBe(true);
    expect(isAllowedProvider("openai")).toBe(true);
    expect(isAllowedProvider("anthropic")).toBe(false);
  });
});

// ── Schema registry: every structured LLM output shape parses its fixture ──

const FIXTURE_DIR = resolve(__dirname, "fixtures", "schemas");
const names = Object.keys(LLM_OUTPUT_SCHEMAS) as LlmOutputSchemaName[];

describe("LLM schema registry — every entry parses its recorded fixture", () => {
  it("the registry is complete (drafter kinds + the hand-rolled parser contracts)", () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
    for (const required of [
      "answer_block",
      "faq_pairs",
      "title_variants",
      "judge_verdict",
      "strategist_take",
      "critic_review",
      "batch_adjudication",
    ]) {
      expect(names).toContain(required);
    }
  });

  for (const name of names) {
    it(`schema "${name}" has a fixture and parses it`, () => {
      const path = resolve(FIXTURE_DIR, `${name}.json`);
      expect(
        existsSync(path),
        `Missing fixture tests/platform/fixtures/schemas/${name}.json - every LLM_OUTPUT_SCHEMAS entry needs a recorded fixture.`,
      ).toBe(true);
      const value = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      const parsed = LLM_OUTPUT_SCHEMAS[name].safeParse(value);
      expect(
        parsed.success,
        parsed.success ? "" : `Fixture for "${name}" no longer parses: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      ).toBe(true);
    });
  }

  it("no orphan schema fixtures, and no em/en dashes in any recorded output", () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
    const known = new Set<string>(names.map((n) => `${n}.json`));
    expect(files.filter((f) => !known.has(f))).toEqual([]);
    for (const name of names) {
      const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf-8");
      expect(raw, `${name}.json contains an em/en dash`).not.toMatch(/[–—]/);
    }
  });
});
