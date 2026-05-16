/**
 * Architecture invariant — Section 7 C7a no-paid-or-scan-or-LLM contract
 * (2026-05-16).
 *
 * Scans active (comment-stripped) source across every C7a file and
 * forbids:
 *   - HTTP-client identifiers (`fetch(`, `axios`, `httpsAgent`)
 *   - Paid-API URL hosts the off-site work might be tempted to call
 *     (`mybusiness.googleapis.com`, `api.yelp.com`, `searchanalytics`,
 *     `urlInspection`, `searchconsole`)
 *   - LLM-provider identifiers (`OpenAI`, `Anthropic`, `openai`,
 *     `anthropic`, `BEACON_LLM_PROVIDER`)
 *
 * Carries Section 7 invariant #4 ("no paid APIs in v1 without explicit
 * approval") into a structural check that survives drive-by edits.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7A_FILES = [
  "src/domains/off-site-authority/types.ts",
  "src/domains/off-site-authority/compute-snapshot.ts",
  "src/domains/off-site-authority/load-snapshot.ts",
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
  { phrase: "fetch(", rationale: "HTTP client — C7a is detection-from-existing-data only." },
  { phrase: "axios", rationale: "HTTP client — C7a is detection-from-existing-data only." },
  { phrase: "httpsAgent", rationale: "HTTP client identifier." },
  { phrase: "mybusiness.googleapis.com", rationale: "GBP API URL — paid/quota path not allowed in C7a." },
  { phrase: "api.yelp.com", rationale: "Yelp Fusion API URL — paid/quota path not allowed in C7a." },
  { phrase: "searchanalytics", rationale: "GSC Search Analytics API — not in scope for Section 7." },
  { phrase: "urlInspection", rationale: "GSC URL Inspection API — not in scope for Section 7." },
  { phrase: "searchconsole", rationale: "Google Search Console — not in scope." },
  { phrase: "OpenAI", rationale: "LLM provider identifier — Section 7 is LLM-free." },
  { phrase: "Anthropic", rationale: "LLM provider identifier — Section 7 is LLM-free." },
  { phrase: "openai", rationale: "LLM provider identifier." },
  { phrase: "anthropic", rationale: "LLM provider identifier." },
  { phrase: "BEACON_LLM_PROVIDER", rationale: "LLM provider env var — Section 7 is LLM-free." },
];

describe("Architecture — Section 7 C7a no paid / scan / LLM", () => {
  for (const rel of C7A_FILES) {
    const active = stripComments(read(rel));
    for (const rule of FORBIDDEN) {
      it(`${rel}: does NOT contain '${rule.phrase}'`, () => {
        const idx = active.indexOf(rule.phrase);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(active.length, idx + rule.phrase.length + 40);
          throw new Error(
            `${rel}: forbidden phrase '${rule.phrase}' present (offset ${idx}).\n` +
              `Rationale: ${rule.rationale}\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
