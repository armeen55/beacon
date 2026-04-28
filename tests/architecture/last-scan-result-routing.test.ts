/**
 * Phase 5 hosted-cron fix architecture invariant (2026-04-28).
 *
 * Pin the writer/reader path alignment for `last-scan-result.json`.
 * The split-brain (writer = root, reader = global) caused the first
 * GH Actions Daily Scheduled Scan to fail at `read_last_scan_result`
 * step with "missing or invalid after CLI" — the CLI HAD written the
 * file, just to a different directory than the reader expected.
 *
 * Pure source-scan — no I/O.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const LSR_SRC = read("src/domains/scanning/last-scan-result.ts");
const ORCHESTRATE_SRC = read("src/domains/scanning/orchestrate-scan.ts");
const SCAN_CLI_SRC = read("scripts/scan-owned-pages.ts");
const STORE_CLASS_SRC = read("src/lib/persistence/store-classification.ts");

describe("Phase 5 — last-scan-result writer/reader path alignment", () => {
  it("classification: last-scan-result is GLOBAL_STORES (single source of truth)", () => {
    // Pin so a future migration that re-classifies last-scan-result
    // also forces an audit of this writer/reader pairing.
    const globalBlock = STORE_CLASS_SRC.match(
      /GLOBAL_STORES\s*=\s*new Set<string>\(\[[\s\S]*?\]\)/,
    );
    expect(globalBlock, "GLOBAL_STORES set not found").not.toBeNull();
    expect(globalBlock![0]).toMatch(/["']last-scan-result["']/);
  });

  it("writeLastScanResultFile uses writeDotDataJson (auto-routes via classification)", () => {
    expect(LSR_SRC).toMatch(
      /export async function writeLastScanResultFile[\s\S]{0,200}writeDotDataJson\(/,
    );
  });

  it("writeLastScanResultFile is async (signature returns Promise<void>)", () => {
    expect(LSR_SRC).toMatch(
      /export async function writeLastScanResultFile\([^)]*\):\s*Promise<void>/,
    );
  });

  it("writeLastScanResultFile does NOT write directly to root .data via writeFileSync", () => {
    // Defense against silent regression to the bug pattern. Anchor on
    // an actual call (`writeFileSync(`), not docstring backtick
    // mentions of the symbol name.
    expect(LSR_SRC).not.toMatch(/writeFileSync\(/);
  });

  it("readLastScanResult routes via readDotDataJson (consistent with writer)", () => {
    // Anchor: the function call site `readDotDataJson<` (which only
    // appears in the typed call inside readLastScanResult, not in the
    // docstring backtick mentions).
    expect(LSR_SRC).toMatch(/readDotDataJson<LastScanResultPayload>/);
  });

  it("orchestrate-scan.ts awaits every writeLastScanResultFile call", () => {
    // Find each call site and assert it's preceded by `await`. Three
    // call sites in orchestrate-scan.ts (CLI failure path, missing-payload
    // fallback, success/merged path).
    const calls = [
      ...ORCHESTRATE_SRC.matchAll(/writeLastScanResultFile\(/g),
    ];
    expect(calls.length).toBe(3);
    for (const m of calls) {
      const idx = m.index!;
      const prefix = ORCHESTRATE_SRC.slice(Math.max(0, idx - 16), idx);
      expect(prefix, `call at offset ${idx} not awaited`).toMatch(/await\s+$/);
    }
  });

  it("scripts/scan-owned-pages.ts awaits every writeLastScanResultFile call", () => {
    const calls = [...SCAN_CLI_SRC.matchAll(/writeLastScanResultFile\(/g)];
    // 5 call sites in the CLI: sitemap-fetch fail, no-canonical-match
    // abort, dry-run success, end-of-scan final, top-level uncaught
    // crash handler.
    expect(calls.length).toBe(5);
    for (const m of calls) {
      const idx = m.index!;
      const prefix = SCAN_CLI_SRC.slice(Math.max(0, idx - 16), idx);
      expect(prefix, `call at offset ${idx} not awaited`).toMatch(/await\s+$/);
    }
  });
});

describe("Phase 5 — scanLogTrigger maps cron + import to 'auto'", () => {
  it("cron + import map to 'auto'; today/pages/cli map to 'manual'", () => {
    // Pin the production-log mapping fix so a future refactor doesn't
    // silently put cron back into 'manual'. The first hosted Daily
    // Scheduled Scan logged "trigger=manual" even though the script
    // called runWebsiteScan with trigger:"cron"; this fix corrected it.
    const fnMatch = ORCHESTRATE_SRC.match(
      /function scanLogTrigger\([\s\S]{0,80}?\):\s*"manual"\s*\|\s*"auto"\s*\{[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/entry === "import" \|\| entry === "cron"/);
    expect(fnMatch![0]).toMatch(/\? "auto" : "manual"/);
  });
});
