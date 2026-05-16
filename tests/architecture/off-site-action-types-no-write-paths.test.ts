/**
 * Architecture invariant — Section 7 C7b no-write-paths contract
 * (2026-05-16).
 *
 * Section 7 locked invariant #1 (read-only/manual) + #4 (no paid APIs
 * in v1) + #5 (no policy-risky automation) — pinned by a source-text
 * scan across the two production files C7b modifies:
 *
 *   - `src/domains/recommendations/action-types.ts`
 *   - `src/domains/recommendations/recommendation-action-rows.ts`
 *
 * Forbidden phrases in active (comment-stripped) source:
 *   - external write API hosts: `mybusiness.googleapis.com`,
 *     `api.yelp.com`, `houzz.com/api`, `angi.com/api`, `bbb.org/api`
 *   - automation language: `auto-claim`, `auto-post`,
 *     `auto-review-request`, `automated outreach`
 *   - HTTP-client identifiers: `fetch(`, `axios`, `httpsAgent`
 *   - LLM-provider identifiers: `OpenAI`, `Anthropic`,
 *     `BEACON_LLM_PROVIDER`
 *
 * Defense-in-depth — these phrases would only appear in C7b's
 * scope if a future drive-by tried to wire automation into the
 * registry or the row builder. The 7 locked off-site types are
 * recommendations Beacon GIVES, never actions Beacon PERFORMS.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7B_PRODUCTION_FILES = [
  "src/domains/recommendations/action-types.ts",
  "src/domains/recommendations/recommendation-action-rows.ts",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // External write-API hosts.
  { phrase: "mybusiness.googleapis.com", rationale: "GBP API host — no write paths in C7b." },
  { phrase: "api.yelp.com", rationale: "Yelp Fusion API host — no write paths in C7b." },
  { phrase: "houzz.com/api", rationale: "Houzz API host — no write paths in C7b." },
  { phrase: "angi.com/api", rationale: "Angi API host — no write paths in C7b." },
  { phrase: "bbb.org/api", rationale: "BBB API host — no write paths in C7b." },
  // Automation language.
  { phrase: "auto-claim", rationale: "Section 7 invariant #1: Beacon RECOMMENDS, never PERFORMS." },
  { phrase: "auto-post", rationale: "Section 7 invariant #1." },
  { phrase: "auto-review-request", rationale: "Section 7 invariant #5: no review-gating / policy-risky automation." },
  { phrase: "automated outreach", rationale: "Section 7 invariant #1: no automated outreach." },
  // HTTP-client identifiers.
  { phrase: "fetch(", rationale: "C7b adds registry entries only — no HTTP client." },
  { phrase: "axios", rationale: "C7b adds registry entries only — no HTTP client." },
  { phrase: "httpsAgent", rationale: "HTTP client identifier." },
  // LLM-provider identifiers.
  { phrase: "OpenAI", rationale: "C7b is LLM-free (generatorActive: false for all 7 off-site types)." },
  { phrase: "Anthropic", rationale: "C7b is LLM-free." },
  { phrase: "BEACON_LLM_PROVIDER", rationale: "LLM provider env var — out of scope." },
];

describe("Architecture — Section 7 C7b no-write-paths + no-auto-action source scan", () => {
  for (const rel of C7B_PRODUCTION_FILES) {
    const active = stripComments(read(rel));
    for (const rule of FORBIDDEN) {
      it(`${rel}: does NOT contain "${rule.phrase}"`, () => {
        const idx = active.indexOf(rule.phrase);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(active.length, idx + rule.phrase.length + 40);
          throw new Error(
            `${rel}: forbidden phrase "${rule.phrase}" present (offset ${idx}).\n` +
              `Rationale: ${rule.rationale}\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
