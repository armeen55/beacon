/**
 * Architecture invariant — Section 7 C7g v1 no-fetch contract
 * (2026-05-16).
 *
 * C7g v1 introduces operator-entered off-site profile URLs as a
 * non-HTTP-verified signal. Beacon does NOT fetch the URL, does NOT
 * HEAD-check it, does NOT render it as a clickable link, and does
 * NOT pass it to any network or LLM identifier. The four URL fields
 * thread through:
 *   • src/lib/business-config.ts (schema)
 *   • src/domains/off-site-authority/load-snapshot.ts (loader)
 *   • src/domains/off-site-authority/compute-snapshot.ts (compute)
 *   • src/app/(shell)/diagnostics/off-site-authority/page.tsx (display)
 *
 * This invariant scans each file's comment-stripped active source
 * and forbids:
 *   • `fetch(`, `axios`, `httpsAgent` — HTTP client identifiers.
 *   • `<a href=` — render as an anchor tag. Profile URLs MUST
 *     render as plain text only in v1 (no live link, no preview).
 *
 * C7g v2 (HTTP HEAD verification) will revisit the fetch ban via
 * an additive invariant; this invariant pins the v1 posture.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7G_FILES = [
  "src/lib/business-config.ts",
  "src/domains/off-site-authority/load-snapshot.ts",
  "src/domains/off-site-authority/compute-snapshot.ts",
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
  { phrase: "fetch(", rationale: "HTTP client — C7g v1 does NOT HTTP-verify profile URLs." },
  { phrase: "axios", rationale: "HTTP client — C7g v1 does NOT HTTP-verify profile URLs." },
  { phrase: "httpsAgent", rationale: "HTTP client identifier — C7g v1 is detection-from-config only." },
  { phrase: "<a href=", rationale: "Profile URLs must render as plain text in v1 (no live link)." },
];

describe("Architecture — Section 7 C7g v1 no-fetch / no-link", () => {
  for (const rel of C7G_FILES) {
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
