/**
 * Architecture invariant — Slice 4.5.E.α₁b₂-A (2026-05-21):
 * LLM-draft gateway render isolation + single-caller contract.
 *
 * EVOLVED from the α₁b₁ "no caller yet" boundary to the α₁b₂-A
 * "exactly one allowlisted caller" boundary. The single caller
 * is the operator-only server action:
 *   src/app/(shell)/diagnostics/recommendation-triggers/actions.ts
 *
 * α₁b₂-A ships the action + this evolved invariant + action tests.
 * The page UI consumer (LLM-Draft Preview section + result banner)
 * lands in α₁b₂-B. Until α₁b₂-B lands, the action is reachable only
 * by hand-crafted POST (still operator + env-flag gated).
 *
 * Pattern mirrors `recommendation-intelligence-promotion-live-
 * write-guards` (single-file allowlist + global negative scan +
 * source-text contract on the allowlisted file).
 *
 * This invariant pins THREE things:
 *
 *   1. Source-text scan on the diagnostic page
 *      `src/app/(shell)/diagnostics/recommendation-triggers/page.tsx`:
 *      • does NOT import `@/domains/recommendation-intelligence/
 *        llm-draft-gateway`
 *      • does NOT reference `draftProposedTextForCandidate`
 *      • does NOT import `@/domains/recommendations/providers/openai`
 *      • does NOT reference `openaiProvider`
 *      • does NOT reference `openaiProvider.generate`
 *      • does NOT call `fetch(`
 *      Page render NEVER invokes the LLM.
 *
 *   2. Source-text contract on the allowlisted action file
 *      `src/app/(shell)/diagnostics/recommendation-triggers/actions.ts`:
 *      • imports + references `isOperatorModeServer` (operator gate)
 *      • imports + references `isLlmDraftGatewayEnabled` (env gate)
 *      • imports + references `buildThinPacketForCandidate`
 *      • imports + references `draftProposedTextForCandidate`
 *      • does NOT import `recommended-edits-persistence`
 *      • does NOT reference `runProviderAndPersist`
 *      • does NOT import `@/domains/recommendations/providers/openai`
 *      • does NOT reference `openaiProvider`
 *      • does NOT contain a direct Supabase `recommended_edits`
 *        write shape (defense-in-depth alongside
 *        `recommendation-intelligence-no-queue-write`)
 *
 *   3. Global allowlist scan on every `src/app/**` file (excluding
 *      test files): EXACTLY ONE file is allowed to
 *      • import `@/domains/recommendation-intelligence/llm-draft-
 *        gateway`
 *      • call `draftProposedTextForCandidate(`
 *      The allowlisted file is the action file above. Any other
 *      offender trips the invariant.
 *
 * Defense-in-depth alongside `recommendation-intelligence-llm-draft-
 * gateway-contract` (pins the gateway module's internal contract)
 * and `recommendation-intelligence-no-queue-write` (separately pins
 * persistence-import + Supabase-write boundaries across the whole
 * intel tree + this same action file).
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
const ACTION_FILE = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "recommendation-triggers",
  "actions.ts",
);
const APP_DIR = resolve(REPO_ROOT, "src", "app");

const GATEWAY_IMPORT_PATH =
  "@/domains/recommendation-intelligence/llm-draft-gateway";
const GATEWAY_FN_NAME = "draftProposedTextForCandidate";
const OPENAI_PROVIDER_IMPORT_PATH =
  "@/domains/recommendations/providers/openai";
const OPENAI_PROVIDER_SYMBOL = "openaiProvider";

const RECOMMENDED_EDITS_WRITE = new RegExp(
  "\\.from\\(\\s*[\"']recommended_edits[\"']\\s*\\)" +
    "\\s*\\.(?:insert|upsert|update|delete)\\s*\\(",
  "u",
);

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

  it("operator-only action file exists at the expected path", () => {
    expect(
      existsSync(ACTION_FILE),
      `Expected action file at ${ACTION_FILE.replace(REPO_ROOT + "/", "")}`,
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

    it("does NOT reference openaiProvider.generate", () => {
      expect(active).not.toContain(`${OPENAI_PROVIDER_SYMBOL}.generate`);
    });

    it("does NOT call fetch(", () => {
      expect(active).not.toMatch(/\bfetch\s*\(/);
    });
  });

  describe("source-text contract on the allowlisted action file", () => {
    const active = stripComments(read(ACTION_FILE));

    it("operator gate: imports + references isOperatorModeServer", () => {
      expect(active).toContain("@/lib/operator-mode");
      expect(active).toContain("isOperatorModeServer");
    });

    it("env gate: imports + references isLlmDraftGatewayEnabled", () => {
      expect(active).toContain("@/lib/llm-draft-gateway-flag");
      expect(active).toContain("isLlmDraftGatewayEnabled");
    });

    it("imports + references buildThinPacketForCandidate", () => {
      expect(active).toContain(
        "@/domains/recommendation-intelligence/build-thin-packet",
      );
      expect(active).toContain("buildThinPacketForCandidate");
    });

    it("imports + references draftProposedTextForCandidate", () => {
      expect(active).toContain(GATEWAY_IMPORT_PATH);
      expect(active).toContain(GATEWAY_FN_NAME);
    });

    it("does NOT import @/domains/recommendations/recommended-edits-persistence", () => {
      expect(active).not.toContain(
        "@/domains/recommendations/recommended-edits-persistence",
      );
      expect(active).not.toContain("recommended-edits-persistence");
    });

    it("does NOT reference runProviderAndPersist", () => {
      expect(active).not.toContain("runProviderAndPersist");
    });

    it("does NOT import @/domains/recommendations/providers/openai", () => {
      expect(active).not.toContain(OPENAI_PROVIDER_IMPORT_PATH);
    });

    it("does NOT reference openaiProvider", () => {
      expect(active).not.toContain(OPENAI_PROVIDER_SYMBOL);
    });

    it("does NOT contain a direct Supabase recommended_edits write shape", () => {
      expect(RECOMMENDED_EDITS_WRITE.test(active)).toBe(false);
    });
  });

  describe("global allowlist scan across src/app/**", () => {
    it("EXACTLY ONE file imports @/domains/recommendation-intelligence/llm-draft-gateway: the action file", () => {
      const importers: string[] = [];
      for (const file of walk(APP_DIR)) {
        const active = stripComments(read(file));
        if (active.includes(GATEWAY_IMPORT_PATH)) {
          importers.push(file);
        }
      }
      const relPaths = importers.map((p) =>
        p.replace(REPO_ROOT + "/", ""),
      );
      expect(
        relPaths,
        `α₁b₂-A requires EXACTLY ONE allowlisted importer (the operator-only action). Importers found: ${relPaths.join(", ")}`,
      ).toEqual([ACTION_FILE.replace(REPO_ROOT + "/", "")]);
    });

    it("EXACTLY ONE file calls draftProposedTextForCandidate(: the action file", () => {
      const callers: string[] = [];
      for (const file of walk(APP_DIR)) {
        const active = stripComments(read(file));
        if (active.includes(`${GATEWAY_FN_NAME}(`)) {
          callers.push(file);
        }
      }
      const relPaths = callers.map((p) => p.replace(REPO_ROOT + "/", ""));
      expect(
        relPaths,
        `α₁b₂-A requires EXACTLY ONE allowlisted caller of ${GATEWAY_FN_NAME}( (the operator-only action). Callers found: ${relPaths.join(", ")}`,
      ).toEqual([ACTION_FILE.replace(REPO_ROOT + "/", "")]);
    });
  });
});
