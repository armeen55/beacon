/**
 * R16 (P6 LLM engine pack) - the SCHEMA REGISTRY pin.
 *
 * src/domains/llm/schemas.ts:LLM_OUTPUT_SCHEMAS names every structured LLM
 * output shape used anywhere in the product (drafter kinds + FAQ pairs + title
 * variants + judge verdict + strategist take + critic review + SERP
 * hypothesis). This suite enumerates the registry and asserts each schema
 * parses its recorded fixture - so a schema edit that breaks a real recorded
 * output fails a NAMED test here, and a new registry entry without a fixture
 * fails loudly. No live LLM calls.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { LLM_OUTPUT_SCHEMAS, type LlmOutputSchemaName } from "@/domains/llm/schemas";

const FIXTURE_DIR = resolve(__dirname, "fixtures", "schemas");

const names = Object.keys(LLM_OUTPUT_SCHEMAS) as LlmOutputSchemaName[];

describe("LLM schema registry - every entry parses its recorded fixture", () => {
  it("the registry is complete (all drafter kinds + the hand-rolled parser contracts)", () => {
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
        `Missing fixture tests/llm-regression/fixtures/schemas/${name}.json - every LLM_OUTPUT_SCHEMAS entry needs a recorded fixture.`,
      ).toBe(true);
      const value = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      const parsed = LLM_OUTPUT_SCHEMAS[name].safeParse(value);
      expect(
        parsed.success,
        parsed.success ? "" : `Fixture for "${name}" no longer parses: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      ).toBe(true);
    });
  }

  it("no orphan schema fixtures (every file maps to a registry entry)", () => {
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json"));
    const known = new Set<string>(names.map((n) => `${n}.json`));
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });

  it("fixtures carry no em or en dashes (the hard copy rule holds in recorded outputs)", () => {
    for (const name of names) {
      const raw = readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf-8");
      expect(raw, `${name}.json contains an em/en dash`).not.toMatch(/[–—]/);
    }
  });
});
