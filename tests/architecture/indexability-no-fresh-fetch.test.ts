/**
 * Architecture invariant — Phase A.3 Step 3b (2026-05-14).
 *
 * The indexability loader is READ-ONLY. It may consume stored
 * signals (page snapshots, sitemap reconciliation, robots state)
 * but MUST NOT initiate fresh HTTP fetches, MUST NOT trigger scans,
 * and MUST NOT call any LLM / paid-API / GSC / Supabase-write
 * surface.
 *
 * The "fresh-fetch via scan" surface is doubly dangerous because
 * existing helpers in `src/domains/pages/robots-parser.ts` (e.g.,
 * `fetchAndParseRobots`, `refreshRobotsState`) issue real HTTP
 * requests to the tenant's domain. The loader shares a module file
 * with read-only helpers (`readRobotsState`, `evaluateAiBotAccess`,
 * `evaluateGooglebotAccess`) and a less-disciplined refactor could
 * easily import a fetching helper by mistake. This invariant pins
 * the boundary at the source-text level.
 *
 * Forbidden tokens (case-sensitive substring match on the
 * comment-stripped source):
 *   • `fetch(` — global Fetch API.
 *   • `fetchAndParseRobots` — robots-parser fresh-fetch helper.
 *   • `refreshRobotsState` — robots-parser fresh-fetch + write helper.
 *   • `axios` — popular HTTP client.
 *   • `superagent` — HTTP client.
 *   • `node-fetch` — HTTP client.
 *   • `got(` — HTTP client (call expression; bare word `got` could
 *     appear in unrelated identifiers).
 *
 * Forbidden import paths:
 *   • `@/lib/llm/*`
 *   • `@/lib/cost/*`
 *   • `@/domains/recommendations/cross-tenant-brain/*`
 *   • Any path containing `gsc` (GSC is reserved for A.3.b1; not
 *     wired in v1).
 *
 * Retirement: refines (does NOT retire) when A.3.b1 lands the GSC
 * connector — at that point the loader will gain a NEW read-only
 * dependency on a GSC client; the forbidden-fetch-token list stays,
 * but the GSC-path ban relaxes to a specific allowed module.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "indexability",
  "load-indexability.ts",
);

const SRC = readFileSync(LOADER_PATH, "utf-8");
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

const FORBIDDEN_TOKENS = [
  "fetch(",
  "fetchAndParseRobots",
  "refreshRobotsState",
  "axios",
  "superagent",
  "node-fetch",
  "got(",
] as const;

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["']@\/lib\/llm\//,
  /from\s+["']@\/lib\/cost\//,
  /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\//,
  /from\s+["'][^"']*gsc[^"']*["']/i,
];

describe("Architecture — indexability loader no-fresh-fetch (Phase A.3 §3b)", () => {
  for (const token of FORBIDDEN_TOKENS) {
    it(`loader source does NOT contain the fresh-fetch token '${token}'`, () => {
      expect(
        SRC_STRIPPED,
        `forbidden token '${token}' appeared in load-indexability.ts source`,
      ).not.toContain(token);
    });
  }

  it("loader source does NOT import any LLM module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[0]);
  });

  it("loader source does NOT import any cost-ledger module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[1]);
  });

  it("loader source does NOT import any cross-tenant-brain module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[2]);
  });

  it("loader source does NOT import any GSC module (reserved for A.3.b1)", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[3]);
  });

  it("loader source does NOT import any module ending in '-client' (HTTP-client convention)", () => {
    // Defensive: most Beacon HTTP clients live under
    // `src/lib/.../*-client.ts`. Reject anything in that shape.
    expect(SRC_STRIPPED).not.toMatch(/from\s+["'][^"']*-client["']/);
  });

  it("loader source does NOT import the raw dotdata I/O layer (must use store wrappers)", () => {
    // The store wrappers (snapshot-store, sitemap-reconciliation-store)
    // are the allowed entry points. Bypassing them with a direct
    // dotdata-json import would skip the classification layer's
    // routing dispatch.
    expect(SRC_STRIPPED).not.toMatch(
      /from\s+["']@\/lib\/persistence\/dotdata-json["']/,
    );
  });
});
