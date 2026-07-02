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
   *
   *  PIVOT (2026-06-15): `lib/querying/openai-client.ts` (the native ChatGPT
   *  polling client via the Responses API) was deleted with the in-house AEO
   *  polling engine — Profound is now the sole AEO source. The surviving
   *  OpenAI egress is the recommendation-DRAFT path only. */
  const ALLOWED_OPENAI_CALLERS = new Set<string>([
    "src/domains/recommendations/adjudicate.ts",
    "src/domains/recommendations/providers/openai.ts",
  // §push page-factory (2026-06-10): the cluster generator is the second
  // documented OpenAI egress — gated by the same BEACON_LLM_PROVIDER
  // config, capped at MAX_ITEMS_PER_RUN per run, cost stamped per card.
  "src/domains/push/cluster-factory.ts",
  // why-narrative (2026-06-16): the LLM-synthesized rec "Why this matters"
  // (Act 2). READ-ONLY display text, never published; gated behind
  // BEACON_LLM_WHY (default off) + checkBudget + an 8s timeout; output is
  // white-label + no-invented-numbers sanitized, with the deterministic
  // synthesis as the always-present fallback.
  "src/domains/recommendations/llm-why-narrative.ts",
  // expert-strategist (2026-06-16, PHASE F): the LLM expert reasoning pass
  // (opportunity / why-now / best-action / alternatives / risks). READ-ONLY
  // analysis, never published; gated behind BEACON_LLM_STRATEGIST (default
  // off) + checkBudget + a hard timeout; output is white-label +
  // no-invented-numbers + AI-claims-need-AI-evidence sanitized; and the
  // DETERMINISTIC gate (enforceExpertConfidence) — not the LLM — sets the
  // final confidence/approve verdict and can reject.
  "src/domains/recommendations/llm-expert-strategist.ts",
  // page-surgeon judge (2026-06-18): the per-page atomic-change judge over the
  // evidence packet. The deterministic trust gate (applyDeterministicGate) — not
  // the LLM — is the sole authority on confidence/publishability; the judge only
  // proposes. Gated by OPENAI_API_KEY presence + a 90s timeout + json_object
  // response_format; any failure falls back to the deterministic page decision.
  "src/domains/recommendation-intelligence/page-surgeon/llm-judge.ts",
  // page-surgeon SERP hypothesis (2026-06-22, TASK 2): resolves "SERP unknown"
  // inside the Workbench with a clearly-labeled SYNTHETIC hypothesis of which
  // SERP features likely sit above the organic results. Workbench-only +
  // operator-triggered (never the broad scan); NO paid/live SERP fetch (model
  // general knowledge only); source is ALWAYS "synthetic" and serpStatus is
  // "suspected"/"unknown", never "observed"; confidence capped at "medium";
  // fail-soft to null (caller stays "unknown") on any error / missing key.
  "src/domains/recommendation-intelligence/page-surgeon/serp-hypothesis.ts",
  // demand-graph cockpit drafters (2026-06-24/25): on-demand answer-block +
  // FAQ-schema generators for a Today's Moves card. OFF unless
  // BEACON_LLM_PROVIDER=openai, operator-gated, checkBudget/recordSpend
  // (fail-closed monthly cap), numeric-fidelity firewall on every output,
  // gpt-5-mini reasoning_effort:"low", bounded timeout. Fire only on an explicit
  // click; deterministic brief is the fallback on any non-"ok" status.
  "src/domains/demand-graph/llm-answer-block.ts",
  // structured drafter (2026-06-25, Sprint 2A/P4): the schema-validated draft
  // engine + the first prod caller of the gated LLM pattern. OFF unless
  // BEACON_LLM_PROVIDER=openai, checkBudget/recordSpend (fail-closed monthly cap),
  // Zod-validate → retry-once → fail-closed, content firewalls (numeric-fidelity,
  // placeholder, superlative) on every output, gpt-5-mini reasoning_effort:"low",
  // bounded timeout. Never returns loose/unvalidated text as a product artifact.
  "src/domains/llm/structured-drafter.ts",
  // engine poll (2026-07-02, BEACON 500 item 4): the nightly 4-engine AI-answer
  // poll's NATIVE ChatGPT lane (web-search chat completions with url_citation
  // annotations). Read-only observation writes, never published content; capped
  // at NIGHTLY_PROMPT_CAP questions per night with a per-night already-ran
  // guard; skips silently when OPENAI_API_KEY is absent; per-engine 4xx
  // degrades to an honest error status. Gemini/Claude lanes go through the
  // budget-capped DataForSEO gauntlet instead, never this egress.
  "src/domains/ai-visibility/run-engine-poll.ts",
  // retrieval twin embeddings (2026-07-02, BEACON 500 item 50): the ONLY caller of OpenAI's
  // embeddings endpoint (text-embedding-3-small, ~$0.02/1M tokens). Read-only feature
  // extraction, never published content. Gated by OPENAI_API_KEY presence; every batch
  // re-checks src/domains/retrieval-twin/retrieval-budget.ts's checkBudget (fail-closed,
  // separate ledger surface from the adjudicator/drafting caps) before the call and
  // recordSpend immediately after. Cache-first: hash-keyed against the Supabase
  // retrieval_chunks table, so a re-run only pays for chunks whose text actually changed.
  // Operator-triggered only (no nightly auto-indexing this cycle); bounded batches of
  // <=100 inputs. Any failure (missing key, budget block, API error) fails soft to a
  // per-chunk "skipped" result, never a thrown exception.
  "src/domains/retrieval-twin/embeddings.ts",
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
