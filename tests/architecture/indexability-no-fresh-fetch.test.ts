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
 *   • `@/lib/connectors/gsc/*` — the GSC URL Inspection client is
 *     not imported directly; the loader's GSC integration routes
 *     through the bounded adapter `./load-gsc-signal`.
 *
 * GSC posture (A.3.b1.beta, 2026-05-17):
 *   The loader now imports `loadGscSignal` from the sibling
 *   `./load-gsc-signal` adapter, ONLY consulted when the caller
 *   passes `enableGsc: true`. Default callers (every customer-
 *   facing path) reach an early return BEFORE the GSC adapter is
 *   invoked — byte-equal pre-beta behavior. The adapter itself
 *   handles the per-render fresh-fetch cap, Supabase cache, and
 *   token/scope discipline. The loader's own source still issues
 *   ZERO HTTP fetches.
 *
 * Retirement: the fetch-token list + non-GSC forbidden paths are
 * permanent. GSC-specific guards refine when A.3.b3 lands additional
 * GSC APIs (Search Analytics, etc.).
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
  // A.3.b1.beta (2026-05-17) — the GSC client lives at
  // `@/lib/connectors/gsc/*`. The loader must NEVER import it
  // directly; GSC routes through the bounded adapter
  // `./load-gsc-signal` (which itself imports gscUrlInspect and
  // enforces the per-render cap + Supabase cache).
  /from\s+["']@\/lib\/connectors\/gsc\//,
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

  it("loader source does NOT import the GSC client directly — only the bounded adapter (A.3.b1.beta)", () => {
    // GSC reads route through ./load-gsc-signal, which enforces the
    // per-render fresh-fetch cap, Supabase cache, and token discipline.
    // Direct gscUrlInspect import from the loader would bypass the
    // bounded adapter's guard rails.
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[3]);
  });

  it("loader's GSC integration is opt-in only (enableGsc default false)", () => {
    // The loader signature carries `enableGsc?: boolean` (default
    // false). Customer-facing callers omit it and hit the early
    // return BEFORE any GSC code runs — byte-equal pre-beta behavior.
    expect(
      /enableGsc\?\s*:\s*boolean/.test(SRC_STRIPPED),
      "loader must declare enableGsc?: boolean as an OPTIONAL opt-in arg — default off preserves customer-surface byte-equality",
    ).toBe(true);
  });

  it("loader imports the GSC adapter from its sibling path (not the raw client)", () => {
    // The post-A.3.b1.beta loader imports `loadGscSignal` from the
    // sibling adapter. This is the ONLY allowed path to GSC data
    // from the loader.
    expect(
      /from\s+["']\.\/load-gsc-signal["']/.test(SRC_STRIPPED),
      "loader must import loadGscSignal from ./load-gsc-signal (bounded adapter)",
    ).toBe(true);
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
