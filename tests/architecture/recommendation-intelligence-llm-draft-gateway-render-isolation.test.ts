/**
 * Architecture invariant — Slice 4.5.E.α₁b₁ (2026-05-21):
 * LLM-draft gateway render isolation.
 *
 * α₁b₁ ships the env-flag helper + thin packet builder + this
 * invariant — but NO caller yet. The gateway must STAY uncalled
 * from any customer-facing render path until α₁b₂ wires an
 * operator-only server action.
 *
 * This invariant pins TWO things:
 *
 *   1. Source-text scan on the diagnostic page
 *      `src/app/(shell)/diagnostics/recommendation-triggers/page.tsx`:
 *      • does NOT import `@/domains/recommendation-intelligence/
 *        llm-draft-gateway`
 *      • does NOT reference `draftProposedTextForCandidate`
 *      • does NOT import `@/domains/recommendations/providers/openai`
 *      • does NOT reference `openaiProvider`
 *
 *   2. Global negative scan on every `src/app/**` file (excluding
 *      test files): ZERO files
 *      • import `@/domains/recommendation-intelligence/llm-draft-
 *        gateway`
 *      • call `draftProposedTextForCandidate(`
 *
 *   α₁b₂ will REVISE this invariant to allow exactly one file
 *   (`src/app/(shell)/diagnostics/recommendation-triggers/actions.ts`)
 *   to be the single invoker — mirroring the live-write-guards
 *   pattern.
 *
 * Defense-in-depth alongside `recommendation-intelligence-llm-draft-
 * gateway-contract` (which pins the gateway's internal contract)
 * and the existing `recommendation-intelligence-no-queue-write`
 * (which pins forbidden-import shapes across the whole intel tree).
 */

import { describe, it, expect } from "vitest";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DIAGNOSTIC_PAGE = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "page.tsx",
);
const APP_DIR = resolve(REPO_ROOT, "src", "app");

const GATEWAY_IMPORT_PATH =
  "@/domains/recommendation-intelligence/llm-draft-gateway";
const GATEWAY_FN_NAME = "draftProposedTextForCandidate";
const OPENAI_PROVIDER_IMPORT_PATH =
  "@/domains/recommendations/providers/openai";
const OPENAI_PROVIDER_SYMBOL = "openaiProvider";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
    out.push(full);
  }
  return out;
}

describe("recommendation-intelligence-llm-draft-gateway-render-isolation", () => {
  it("diagnostic page file exists at the expected path", () => {
    expect(
      existsSync(DIAGNOSTIC_PAGE),
      `Expected diagnostic page at ${DIAGNOSTIC_PAGE.replace(REPO_ROOT + "/", "")}`,
    ).toBe(true);
  });

  describe("source-text contract on diagnostics/recommendation-triggers/page.tsx", () => {
    const active = stripComments(read(DIAGNOSTIC_PAGE));

    it("does NOT import @/domains/recommendation-intelligence/llm-draft-gateway", () => {
      expect(active).not.toContain(GATEWAY_IMPORT_PATH);
    });

    it("does NOT reference draftProposedTextForCandidate", () => {
      expect(active).not.toContain(GATEWAY_FN_NAME);
    });

    it("does NOT import @/domains/recommendations/providers/openai", () => {
      expect(active).not.toContain(OPENAI_PROVIDER_IMPORT_PATH);
    });

    it("does NOT reference openaiProvider", () => {
      expect(active).not.toContain(OPENAI_PROVIDER_SYMBOL);
    });
  });

  describe("global negative scan across src/app/**", () => {
    it("ZERO files import @/domains/recommendation-intelligence/llm-draft-gateway", () => {
      const offenders: string[] = [];
      for (const file of walk(APP_DIR)) {
        const active = stripComments(read(file));
        if (active.includes(GATEWAY_IMPORT_PATH)) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `α₁b₁ requires ZERO customer-facing imports of the LLM-draft gateway. α₁b₂ will allow exactly one operator-only server action. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    });

    it("ZERO files call draftProposedTextForCandidate(", () => {
      const offenders: string[] = [];
      for (const file of walk(APP_DIR)) {
        const active = stripComments(read(file));
        if (active.includes(`${GATEWAY_FN_NAME}(`)) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `α₁b₁ requires ZERO callers of draftProposedTextForCandidate across src/app/**. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  });
});
