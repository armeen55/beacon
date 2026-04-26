/**
 * Sprint 6A.2d (2026-04-26) — LLM safety architectural invariants.
 *
 * Pin the boundaries that keep accidental real LLM calls out of the
 * page-render path, the production build, and the test suite:
 *
 *   1. No `(shell)/**\/page.tsx` server component imports
 *      `openaiProvider` (the LLM provider) or `runProviderAndPersist`
 *      (the orchestration helper that reaches it). Both paths run only
 *      from CLI scripts + a future explicit operator-driven server
 *      action surface.
 *   2. No source file outside the documented OpenAI integration points
 *      makes a top-level fetch to `api.openai.com`. The existing
 *      adjudicator (`adjudicate.ts`) and the new `providers/openai.ts`
 *      are the only legal call sites.
 *   3. The OpenAI provider's Vercel-build guard is still pinned in
 *      source — `process.env.VERCEL === "1"` plus a `BEACON_LLM_BUILD_OK`
 *      escape hatch.
 *
 * No real network calls. The walk reads source text only.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(REPO_ROOT, "src");
const SHELL_ROOT = resolve(SRC_ROOT, "app", "(shell)");

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      yield* walk(full);
    } else if (
      entry.endsWith(".ts") ||
      entry.endsWith(".tsx") ||
      entry.endsWith(".mts")
    ) {
      yield full;
    }
  }
}

describe("Sprint 6A.2d — page render must NOT import LLM dispatch surfaces", () => {
  /** Files inside `(shell)/**\/page.tsx` are statically prerendered by
   *  Next 16. Importing the LLM provider or the orchestration helper
   *  pulls those modules into the render bundle and risks a build-time
   *  call. The CLI scripts (`scripts/build-edits-for-queue.ts`,
   *  `scripts/generate-specific-edits.ts`) are the only legal callers
   *  today; a future explicit operator-driven server action would
   *  live under `actions.ts`, not `page.tsx`. */
  function listShellPages(): string[] {
    const pages: string[] = [];
    for (const f of walk(SHELL_ROOT)) {
      if (f.endsWith("/page.tsx")) pages.push(f);
    }
    return pages;
  }

  const FORBIDDEN_IMPORTS = [
    "@/domains/recommendations/providers/openai",
    "@/domains/recommendations/providers/anthropic",
    "@/domains/recommendations/recommended-edits-persistence",
  ];

  it("no `(shell)/**\\/page.tsx` imports the OpenAI provider", () => {
    const offenders: string[] = [];
    for (const f of listShellPages()) {
      const src = readFileSync(f, "utf8");
      const hit = /from\s+["'][^"']*\bproviders\/openai\b[^"']*["']/.test(src);
      if (hit) offenders.push(f.slice(REPO_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("no `(shell)/**\\/page.tsx` imports the Anthropic provider", () => {
    const offenders: string[] = [];
    for (const f of listShellPages()) {
      const src = readFileSync(f, "utf8");
      const hit = /from\s+["'][^"']*\bproviders\/anthropic\b[^"']*["']/.test(src);
      if (hit) offenders.push(f.slice(REPO_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("no `(shell)/**\\/page.tsx` imports `runProviderAndPersist`", () => {
    const offenders: string[] = [];
    for (const f of listShellPages()) {
      const src = readFileSync(f, "utf8");
      // The orchestration helper is a value-only export. A symbol
      // reference or value-shape import means the page bundles the
      // module at runtime. Type-only imports (`import type {...}`) are
      // erased at compile and don't pull the persistence module in.
      const hasSymbol = /\brunProviderAndPersist\b/.test(src);
      const valueImport = new RegExp(
        String.raw`import\s*(?!type\s)\{[^}]*\}\s*from\s*["'][^"']*\brecommended-edits-persistence\b[^"']*["']`,
      ).test(src);
      if (hasSymbol || valueImport) offenders.push(f.slice(REPO_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("smoke: at least one shell page exists (sanity for the walker)", () => {
    expect(listShellPages().length).toBeGreaterThan(0);
  });
});

describe("Sprint 6A.2d — only documented files reach api.openai.com", () => {
  /** Files allowed to fetch OpenAI. Anything else is a surprise
   *  integration point and should fail loud.
   *  - `adjudicate.ts`: page-intent adjudicator (Phase v7)
   *  - `providers/openai.ts`: SpecificEditProvider (Sprint 6A.2b)
   *  - `lib/querying/openai-client.ts`: native polling client for
   *    ChatGPT via the Responses API (pre-Sprint-6A; legitimate
   *    different surface) */
  const ALLOWED_OPENAI_CALLERS = new Set<string>([
    "src/domains/recommendations/adjudicate.ts",
    "src/domains/recommendations/providers/openai.ts",
    "src/lib/querying/openai-client.ts",
  ]);

  it("no source file outside the allowlist references `api.openai.com`", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      // Skip the allowlist + .test.ts files (tests inject mocked
      // fetchImpl; they never make real calls but may reference the URL
      // in assertions).
      if (ALLOWED_OPENAI_CALLERS.has(rel)) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      const src = readFileSync(f, "utf8");
      if (/api\.openai\.com/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("smoke: the allowlisted files DO reference api.openai.com (otherwise the test is vacuous)", () => {
    for (const rel of ALLOWED_OPENAI_CALLERS) {
      const src = readFileSync(resolve(REPO_ROOT, rel), "utf8");
      expect(src).toMatch(/api\.openai\.com/);
    }
  });
});

describe("Sprint 6A.2d — OpenAI provider build-time guard is pinned in source", () => {
  const PROVIDER_PATH = resolve(
    SRC_ROOT,
    "domains/recommendations/providers/openai.ts",
  );

  it("checks process.env.VERCEL === '1'", () => {
    const src = readFileSync(PROVIDER_PATH, "utf8");
    expect(src).toMatch(/process\.env\.VERCEL\s*===\s*"1"/);
  });

  it("provides a BEACON_LLM_BUILD_OK escape hatch", () => {
    const src = readFileSync(PROVIDER_PATH, "utf8");
    expect(src).toMatch(/BEACON_LLM_BUILD_OK/);
  });

  it("checks process.env.VITEST === 'true' (test-runtime safety guard)", () => {
    const src = readFileSync(PROVIDER_PATH, "utf8");
    expect(src).toMatch(/process\.env\.VITEST\s*===\s*"true"/);
  });
});
