/**
 * Architecture invariant — Section 7 C7c no-persistence + no-external-
 * call contract (2026-05-16).
 *
 * Scans active (comment-stripped) source across the three C7c
 * production files:
 *
 *   - `src/domains/off-site-authority/recommendation-rules.ts`
 *   - `src/domains/off-site-authority/load-recommendation-candidates.ts`
 *   - `src/app/(shell)/diagnostics/off-site-authority/page.tsx`
 *
 * and forbids:
 *   - persistence write patterns: `runProviderAndPersist`,
 *     `saveRecommendedEdit`, `getRecommendedEdits`, `.insert(`,
 *     `.upsert(`, `.update(`
 *   - external write-API hosts: `mybusiness.googleapis.com`,
 *     `api.yelp.com`, `houzz.com/api`, `angi.com/api`, `bbb.org/api`
 *   - automation language: `auto-claim`, `auto-post`,
 *     `auto-review-request`, `automated outreach`
 *   - HTTP-client identifiers: `fetch(`, `axios`, `httpsAgent`
 *   - LLM-provider identifiers: `OpenAI`, `Anthropic`,
 *     `BEACON_LLM_PROVIDER`
 *
 * Carries Section 7 locked invariants #1 (read-only/manual), #4 (no
 * paid APIs without explicit approval), #5 (no review-gating /
 * policy-risky automation), and #7 (no LLM call) into a structural
 * check that survives drive-by edits.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7C_FILES = [
  "src/domains/off-site-authority/recommendation-rules.ts",
  "src/domains/off-site-authority/load-recommendation-candidates.ts",
  "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
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
  // Persistence write patterns.
  { phrase: "runProviderAndPersist", rationale: "Persistence orchestrator — C7c writes zero recommended_edits rows." },
  { phrase: "saveRecommendedEdit", rationale: "Persistence write — C7c is preview-only." },
  { phrase: "getRecommendedEdits", rationale: "C7c does not read the queue; it computes candidates from the snapshot." },
  { phrase: ".insert(", rationale: "Supabase write pattern — C7c is read-only." },
  { phrase: ".upsert(", rationale: "Supabase write pattern — C7c is read-only." },
  { phrase: ".update(", rationale: "Supabase write pattern — C7c is read-only." },
  // External write-API hosts.
  { phrase: "mybusiness.googleapis.com", rationale: "GBP API host — no write paths in C7c." },
  { phrase: "api.yelp.com", rationale: "Yelp Fusion API — no paid call in C7c." },
  { phrase: "houzz.com/api", rationale: "Houzz API — no call in C7c." },
  { phrase: "angi.com/api", rationale: "Angi API — no call in C7c." },
  { phrase: "bbb.org/api", rationale: "BBB API — no call in C7c." },
  // Automation language.
  { phrase: "auto-claim", rationale: "Section 7 invariant #1: Beacon RECOMMENDS, never PERFORMS." },
  { phrase: "auto-post", rationale: "Section 7 invariant #1." },
  { phrase: "auto-review-request", rationale: "Section 7 invariant #5: no review-gating / policy-risky automation." },
  { phrase: "automated outreach", rationale: "Section 7 invariant #1: no automated outreach." },
  // HTTP-client identifiers.
  { phrase: "fetch(", rationale: "C7c is pure compute + thin wrapper — no HTTP client." },
  { phrase: "axios", rationale: "C7c is pure compute + thin wrapper — no HTTP client." },
  { phrase: "httpsAgent", rationale: "HTTP client identifier." },
  // LLM-provider identifiers.
  { phrase: "OpenAI", rationale: "C7c is LLM-free." },
  { phrase: "Anthropic", rationale: "C7c is LLM-free." },
  { phrase: "BEACON_LLM_PROVIDER", rationale: "C7c is LLM-free." },
];

describe("Architecture — Section 7 C7c no-persistence + no-external-call", () => {
  for (const rel of C7C_FILES) {
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
