/**
 * Architecture invariant — Section 5.A / compute-repeat-citation
 * pure-module purity (2026-05-16).
 *
 * Pins that `src/domains/citation-lifecycle/compute-repeat-citation.ts`
 * stays argument-fed and free of every I/O / cache / global-helper
 * import. Mirrors the pure-module discipline applied to
 * `compute-time-to-citation.ts` and the C6a Mode-A / Mode-B compute
 * modules.
 *
 * Two contracts:
 *   1. NEGATIVE — comment-stripped active source must NOT import:
 *      `getRepository` / `@/lib/persistence/repositories`,
 *      `@/lib/business-config`, `@/lib/connector-store`,
 *      `@/lib/persistence/cold-store`, `currentTenantId` /
 *      `currentTenantSlug` / `@/lib/tenant-context`, `next/cache`,
 *      `@/storage/canonical-store`, `@/lib/url/normalize`
 *      (`normalizeUrl` — Section 5 must use the host-aware
 *      `canonicalizeCitationUrl`), `@/domains/pages/classify`
 *      (`normalizePageUrl`), or any LLM-provider identifier
 *      (`OpenAI`, `Anthropic`, `openai`, `anthropic`,
 *      `BEACON_LLM_PROVIDER`).
 *   2. POSITIVE — the module MUST import `canonicalizeCitationUrl`
 *      from `./canonicalize-url` AND `getTimeToCitationEligibility`
 *      from `./eligibility`. Drift on either is the structural
 *      signal that Section 5 has diverged from Section 2's locked
 *      contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TARGET = "src/domains/citation-lifecycle/compute-repeat-citation.ts";

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(readFileSync(resolve(REPO_ROOT, TARGET), "utf-8"));

const FORBIDDEN_IMPORTS: ReadonlyArray<{ pattern: string; rationale: string }> = [
  { pattern: "@/lib/persistence/repositories", rationale: "Pure module must not touch the repo." },
  { pattern: "getRepository", rationale: "Pure module must not call getRepository." },
  { pattern: "@/lib/business-config", rationale: "Pure module must not read business-config." },
  { pattern: "@/lib/connector-store", rationale: "Pure module must not read connector tokens." },
  { pattern: "@/lib/persistence/cold-store", rationale: "Cold-store reads happen in the loader, not the pure compute." },
  { pattern: "@/lib/tenant-context", rationale: "Pure module must not consult tenant context — tenantId flows in via inputs." },
  { pattern: "currentTenantId", rationale: "Pure module must not call currentTenantId." },
  { pattern: "currentTenantSlug", rationale: "Pure module must not call currentTenantSlug." },
  { pattern: "next/cache", rationale: "Caching belongs in the loader." },
  { pattern: "@/storage/canonical-store", rationale: "Pinned by section5-no-canonical-store-observation-runs-bridge invariant." },
  { pattern: "@/lib/url/normalize", rationale: "Section 5 must use canonicalizeCitationUrl (host-aware), NOT normalizeUrl (path-only)." },
  { pattern: "normalizeUrl", rationale: "Same as @/lib/url/normalize ban — path-only canonicalization corrupts host discrimination." },
  { pattern: "@/domains/pages/classify", rationale: "normalizePageUrl strips only utm_*; Section 5 needs the full canonicalize contract." },
  { pattern: "normalizePageUrl", rationale: "Same as @/domains/pages/classify ban." },
  { pattern: "OpenAI", rationale: "LLM-free." },
  { pattern: "Anthropic", rationale: "LLM-free." },
  { pattern: "openai", rationale: "LLM-free." },
  { pattern: "anthropic", rationale: "LLM-free." },
  { pattern: "BEACON_LLM_PROVIDER", rationale: "LLM-free." },
];

describe("Architecture — compute-repeat-citation pure-module purity (negative imports)", () => {
  for (const { pattern, rationale } of FORBIDDEN_IMPORTS) {
    it(`active source does NOT contain '${pattern}'`, () => {
      if (ACTIVE.includes(pattern)) {
        const idx = ACTIVE.indexOf(pattern);
        const start = Math.max(0, idx - 40);
        const end = Math.min(ACTIVE.length, idx + pattern.length + 40);
        throw new Error(
          `${TARGET}: forbidden '${pattern}' in active source (offset ${idx}).\n` +
            `Rationale: ${rationale}\n` +
            `Excerpt: ...${ACTIVE.slice(start, end)}...`,
        );
      }
      expect(ACTIVE.includes(pattern)).toBe(false);
    });
  }
});

describe("Architecture — compute-repeat-citation pure-module purity (positive imports)", () => {
  it("imports canonicalizeCitationUrl from ./canonicalize-url", () => {
    const re =
      /import\s+\{[^}]*canonicalizeCitationUrl[^}]*\}\s+from\s+["']\.\/canonicalize-url["']/;
    expect(ACTIVE).toMatch(re);
  });

  it("imports getTimeToCitationEligibility from ./eligibility", () => {
    const re =
      /import\s+\{[^}]*getTimeToCitationEligibility[^}]*\}\s+from\s+["']\.\/eligibility["']/;
    expect(ACTIVE).toMatch(re);
  });
});
