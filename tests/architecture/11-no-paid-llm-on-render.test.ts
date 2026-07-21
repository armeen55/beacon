/**
 * CONSTITUTION §3 — No paid provider calls during render (LLM half).
 *
 * Consolidated from llm-safety-invariants + cost-controls. Pins the
 * boundaries that keep real OpenAI/LLM spend off the GET/render path:
 *   1. No `(shell)/**\/page.tsx` imports an LLM provider or the
 *      runProviderAndPersist orchestration helper.
 *   2. Only allowlisted files reach api.openai.com (the one gateway +
 *      retrieval-twin embeddings).
 *   3. The OpenAI provider carries VERCEL/VITEST build-time guards.
 *   4. Cost-ledger + llm-budget stores have single-writer isolation, so
 *      no render path can bypass the fail-closed monthly cap.
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
      if (entry === "node_modules" || entry === ".next" || entry === "dist")
        continue;
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

function listShellPages(): string[] {
  const pages: string[] = [];
  for (const f of walk(SHELL_ROOT)) if (f.endsWith("/page.tsx")) pages.push(f);
  return pages;
}

describe("page render must NOT import LLM dispatch surfaces", () => {
  it("no `(shell)/**/page.tsx` imports the OpenAI or Anthropic provider", () => {
    const offenders: string[] = [];
    for (const f of listShellPages()) {
      const src = readFileSync(f, "utf8");
      if (
        /from\s+["'][^"']*\bproviders\/openai\b[^"']*["']/.test(src) ||
        /from\s+["'][^"']*\bproviders\/anthropic\b[^"']*["']/.test(src)
      )
        offenders.push(f.slice(REPO_ROOT.length + 1));
    }
    expect(offenders).toEqual([]);
  });

  it("no `(shell)/**/page.tsx` imports `runProviderAndPersist` (value import)", () => {
    const offenders: string[] = [];
    for (const f of listShellPages()) {
      const src = readFileSync(f, "utf8");
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

describe("only documented files reach api.openai.com", () => {
  const ALLOWED_OPENAI_CALLERS = new Set<string>([
    "src/domains/llm/gateway.ts",
    "src/domains/retrieval-twin/embeddings.ts",
  ]);

  it("no source file outside the allowlist references `api.openai.com`", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      if (ALLOWED_OPENAI_CALLERS.has(rel)) continue;
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      if (/api\.openai\.com/.test(readFileSync(f, "utf8"))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("smoke: the allowlisted files DO reference api.openai.com (non-vacuous)", () => {
    for (const rel of ALLOWED_OPENAI_CALLERS) {
      expect(readFileSync(resolve(REPO_ROOT, rel), "utf8")).toMatch(
        /api\.openai\.com/,
      );
    }
  });
});

describe("OpenAI provider build-time guard is pinned in source", () => {
  const PROVIDER_PATH = resolve(
    SRC_ROOT,
    "domains/recommendations/providers/openai.ts",
  );
  it("checks VERCEL, VITEST, and provides a BEACON_LLM_BUILD_OK escape hatch", () => {
    const src = readFileSync(PROVIDER_PATH, "utf8");
    expect(src).toMatch(/process\.env\.VERCEL\s*===\s*"1"/);
    expect(src).toMatch(/process\.env\.VITEST\s*===\s*"true"/);
    expect(src).toMatch(/BEACON_LLM_BUILD_OK/);
  });
});

describe("cost ledgers have single-writer isolation (fail-closed cap)", () => {
  it("only budget.ts writes cost-ledger.json", () => {
    const ALLOWED_WRITERS = new Set<string>(["src/lib/cost/budget.ts"]);
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      if (ALLOWED_WRITERS.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (
        /cost-ledger\.json/.test(src) &&
        /writeFileSync|writeStore|appendFileSync/.test(src)
      )
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    const budgetSrc = readFileSync(resolve(SRC_ROOT, "lib/cost/budget.ts"), "utf8");
    expect(budgetSrc).toMatch(/cost-ledger\.json/);
    expect(budgetSrc).toMatch(/writeFileSync/);
    const monthlySrc = readFileSync(resolve(SRC_ROOT, "lib/cost/monthly.ts"), "utf8");
    expect(monthlySrc).not.toMatch(/writeFileSync|appendFileSync/);
  });

  it('only adjudicator-budget.ts writes the "llm-budget" store', () => {
    const ALLOWED = new Set<string>([
      "src/domains/recommendations/adjudicator-budget.ts",
      "src/lib/persistence/store-classification.ts",
    ]);
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (/"llm-budget"/.test(src) && /writeStore/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    const src = readFileSync(
      resolve(SRC_ROOT, "domains/recommendations/adjudicator-budget.ts"),
      "utf8",
    );
    expect(src).toMatch(/STORE_NAME\s*=\s*"llm-budget"/);
    expect(src).toMatch(/writeStore<[^>]*>\(STORE_NAME/);
  });
});
