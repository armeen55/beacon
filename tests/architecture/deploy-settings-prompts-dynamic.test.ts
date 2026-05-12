/**
 * Deploy hardening (2026-05-12) — source-level pin for /settings/prompts.
 *
 * The May 12 production build `beacon-39yl32o35` failed during static
 * page generation:
 *   `Error occurred prerendering page "/settings/prompts"`
 *   `Error: Supabase query failed on prompt_answer_observations:
 *    canceling statement due to statement timeout`
 *
 * Root cause: the page had no `export const dynamic` declaration AND
 * no `searchParams` / dynamic-segment in its function signature, so
 * Next.js attempted prerender at build time. The prerender resolved
 * `currentTenantId()` via the env fallback and issued Supabase reads
 * from a fresh-lambda context, exceeding the 8s statement timeout on
 * `prompt_answer_observations`.
 *
 * This guardrail prevents the regression:
 *   1. `/settings/prompts` declares `export const dynamic = "force-dynamic"`.
 *   2. The page does NOT call the canonical-store seed APIs
 *      (`ensureCanonicalStoresSeeded`, `loadFreshCanonicalData`,
 *      `getPromptAnswerObservations`, `getDailyMetricSnapshots`) that
 *      previously triggered the heavy parallel read.
 *   3. The page DOES use the direct tenant-repo `getTrackedPrompts`
 *      reader — a single-table query, not a fan-out.
 *
 * Source-level pins survive JSX refactors and don't need build env.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("Deploy hardening — /settings/prompts must be dynamic-only", () => {
  const src = read("src/app/(shell)/settings/prompts/page.tsx");
  const stripped = stripComments(src);

  it("declares `export const dynamic = \"force-dynamic\"`", () => {
    expect(stripped).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });

  it("does NOT call canonical-store seed / fan-out APIs at render", () => {
    // These APIs trigger the parallel read of `tracked_prompts`,
    // `prompt_answer_observations`, `tracked_entities`, and
    // `daily_metric_snapshots`. The PAO query is the one that
    // timed out during prerender on May 12.
    expect(stripped).not.toMatch(/\bensureCanonicalStoresSeeded\s*\(/);
    expect(stripped).not.toMatch(/\bloadFreshCanonicalData\s*\(/);
    expect(stripped).not.toMatch(/\bgetPromptAnswerObservations\s*\(/);
    expect(stripped).not.toMatch(/\bgetDailyMetricSnapshots\s*\(/);
  });

  it("uses the direct tenant-repo `getTrackedPrompts()` reader", () => {
    expect(stripped).toMatch(
      /getRepository\(\)[\s\S]*?\.forTenant\([^)]+\)[\s\S]*?\.getTrackedPrompts\(\s*\)/,
    );
  });
});

describe("Deploy hardening — companion authenticated routes that read live tenant canonical data", () => {
  // Routes that consume canonical-store / large Supabase tables AND
  // could plausibly be prerendered. These either declare
  // `force-dynamic` explicitly or auto-opt-out by reading
  // `searchParams` / dynamic-segment `params` in their function
  // signature. Pinned so a future edit that removes BOTH signals
  // surfaces here.
  const routes = [
    "src/app/(shell)/page.tsx", // /today
    "src/app/(shell)/prompts/page.tsx", // /prompts
    "src/app/(shell)/prompts/[id]/page.tsx", // /prompts/[id]
    "src/app/(shell)/settings/prompts/page.tsx", // /settings/prompts (this bundle)
  ];

  for (const rel of routes) {
    it(`${rel} declares force-dynamic OR reads searchParams/params at the function boundary`, () => {
      const src = stripComments(read(rel));
      const hasExplicitDynamic = /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(
        src,
      );
      // `await searchParams` / `await params` inside the function body
      // is the Next.js 16 convention; the type annotation
      // `searchParams: Promise<...>` or `searchParams?: Promise<...>`
      // is the static signal.
      const hasSearchParamsSignature = /searchParams\s*\??\s*:\s*Promise</.test(
        src,
      );
      const hasParamsSignature = /\bparams\s*\??\s*:\s*Promise</.test(src);
      const safe =
        hasExplicitDynamic || hasSearchParamsSignature || hasParamsSignature;
      expect(
        safe,
        `${rel} has neither force-dynamic nor searchParams/params signature; prerender attempt risks Supabase statement-timeout failure`,
      ).toBe(true);
    });
  }
});
