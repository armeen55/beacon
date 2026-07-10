import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * ask/providers/denylist (W9 slice 1, 2026-07-09) - ARCHITECTURE PIN, permanent guard.
 *
 * Locked operator decisions this test enforces structurally, not just by convention:
 *   - own-tenant only, cached/durable data only (no paid lookups, no live connector calls)
 *   - no connector tokens, raw LLM payloads, or budget-ledger contents anywhere near
 *     Ask's model context
 *   - internal spend/lab numbers hidden from the operator
 *
 * This greps every source file under src/domains/ask/ (recursively, including
 * providers/) for an import of any denylisted module and fails the moment one appears -
 * a future provider (Slice 2's planner, or any later addition) can never quietly wire a
 * secret, a live poll, or a budget-ledger internal into Ask's context without this test
 * failing loudly first. Same grep-based pattern as
 * src/domains/outreach/outreach-pipeline.test.ts's architecture pin.
 */

const ASK_DOMAIN_DIR = join(process.cwd(), "src/domains/ask");

type BannedImport = { label: string; specifier: string };

const BANNED_IMPORTS: BannedImport[] = [
  { label: "connector-store - raw connector OAuth tokens", specifier: "@/lib/connector-store" },
  { label: "google-auth - OAuth secrets/signed state", specifier: "@/lib/connectors/google-auth" },
  { label: "adjudicator-budget - LLM budget ledger internals", specifier: "@/domains/recommendations/adjudicator-budget" },
  { label: "budget-ledger-supabase - LLM spend ledger dual-write internals", specifier: "@/lib/cost/budget-ledger-supabase" },
  { label: "verify-budget-ledger - LLM spend ledger internals", specifier: "@/lib/cost/verify-budget-ledger" },
  { label: "run-engine-poll - raw AI-engine poll / live model calls", specifier: "@/domains/ai-visibility/run-engine-poll" },
  { label: "visibility-observation-explicit-store - raw per-observation answer payloads", specifier: "@/domains/observations/visibility-observation-explicit-store" },
  { label: "profound raw client - direct connector fetch, bypasses cache + budget", specifier: "@/lib/connectors/profound/client" },
];

function tsFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      out.push(...tsFilesRecursive(full));
      continue;
    }
    if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function importsSpecifier(source: string, specifier: string): boolean {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`from\\s+["']${escaped}["']`).test(source);
}

describe("architecture pin - src/domains/ask never imports a denylisted secret/budget/raw-payload module", () => {
  const files = tsFilesRecursive(ASK_DOMAIN_DIR);

  it("sanity check: the walker actually found the ask domain's source files", () => {
    // Guards against a rot where a future refactor moves/renames the directory and this
    // test silently starts passing on an empty file list.
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("fact-assembly.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith(join("providers", "registry.ts")))).toBe(true);
  });

  for (const banned of BANNED_IMPORTS) {
    it(`no file under src/domains/ask imports ${banned.specifier} (${banned.label})`, () => {
      const offenders = files
        .filter((f) => importsSpecifier(readFileSync(f, "utf8"), banned.specifier))
        .map((f) => f.slice(process.cwd().length + 1));
      expect(offenders).toEqual([]);
    });
  }
});
