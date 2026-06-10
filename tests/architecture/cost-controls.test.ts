/**
 * Sprint 6A.3e (2026-04-26) — architecture invariants for native
 * polling cost controls.
 *
 * Pins the wiring established in 6A.3a-d so a future refactor can't
 * silently drop:
 *   - the polling adapter's pre-flight + mid-run + post-call budget
 *     gate calls
 *   - the API route's `BEACON_POLL_DISABLED` kill switch
 *   - the cost-ledger write isolation (only the polling adapter writes
 *     to `cost-ledger.json` via `recordSpend`)
 *   - the existing LLM safety pins from Sprint 6A.2d
 *
 * No runtime code, no API calls.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SRC_ROOT = resolve(REPO_ROOT, "src");
const POLL_ADAPTER_PATH = resolve(SRC_ROOT, "adapters/perplexity/poll.ts");
const POLL_ROUTE_PATH = resolve(
  SRC_ROOT,
  "app/api/poll/run/route.ts",
);

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      yield* walk(full);
    } else if (
      entry.endsWith(".ts") ||
      entry.endsWith(".tsx") ||
      entry.endsWith(".mts")
    ) {
      yield full;
    }
  }
}

// ── Polling adapter wires the cost controls ─────────────────────────────

describe("Sprint 6A.3e — polling adapter imports/uses cost controls", () => {
  const REQUIRED_IMPORTS: Array<{ symbol: string; module: string; reason: string }> = [
    {
      symbol: "estimatePromptCost",
      module: "@/lib/cost/pricing",
      reason: "per-call cost estimation from token usage + tool counts (6A.3a)",
    },
    {
      symbol: "checkTenantBudget",
      module: "@/lib/cost/budget",
      reason: "pre-flight daily per-tenant cap (6A.3c)",
    },
    {
      symbol: "checkPerRunBudget",
      module: "@/lib/cost/budget",
      reason: "mid-run per-chunk runaway cap (6A.3c)",
    },
    {
      symbol: "recordSpend",
      module: "@/lib/cost/budget",
      reason: "append-only spend ledger (6A.3c)",
    },
    {
      symbol: "checkMonthlyBudget",
      module: "@/lib/cost/monthly",
      reason: "pre-flight monthly cap (6A.3c)",
    },
  ];

  const adapterSrc = readFileSync(POLL_ADAPTER_PATH, "utf8");

  it.each(REQUIRED_IMPORTS)(
    "imports $symbol from $module",
    ({ symbol, module }) => {
      const re = new RegExp(
        String.raw`import\s*\{[^}]*\b${symbol}\b[^}]*\}\s*from\s*["']${module.replace(/[/]/g, "\\/")}["']`,
      );
      expect(adapterSrc).toMatch(re);
    },
  );

  it.each(REQUIRED_IMPORTS)(
    "calls $symbol at least once",
    ({ symbol }) => {
      // The symbol should appear as a call expression: `${symbol}(`. We
      // also accept `${symbol}<...>(` for generic invocations though
      // none today have generics. The simple regex is sufficient.
      const callRe = new RegExp(String.raw`\b${symbol}\s*\(`);
      expect(adapterSrc).toMatch(callRe);
    },
  );

  it("contains the BUDGET_BLOCKED + PER_RUN_BLOCKED + DEDUP_SKIPPED log markers", () => {
    expect(adapterSrc).toMatch(/BUDGET_BLOCKED/);
    expect(adapterSrc).toMatch(/PER_RUN_BLOCKED/);
    expect(adapterSrc).toMatch(/DEDUP_SKIPPED/);
  });

  it("normalizes prompt text via trim + lowercase for dedupe", () => {
    expect(adapterSrc).toMatch(/\.trim\(\)\.toLowerCase\(\)/);
  });
});

// ── Poll route checks BEACON_POLL_DISABLED before runNativePoll ────────

describe("Sprint 6A.3e — poll route checks BEACON_POLL_DISABLED before runNativePoll", () => {
  const routeSrc = readFileSync(POLL_ROUTE_PATH, "utf8");

  it("references BEACON_POLL_DISABLED env var", () => {
    expect(routeSrc).toMatch(/BEACON_POLL_DISABLED/);
  });

  it("returns the disabled status payload", () => {
    expect(routeSrc).toMatch(/status:\s*"disabled"/);
  });

  it("the disabled-check block appears BEFORE any runNativePoll call", () => {
    const disabledIdx = routeSrc.search(/status:\s*"disabled"/);
    const runIdx = routeSrc.search(/\brunNativePoll\s*\(/);
    expect(disabledIdx).toBeGreaterThan(0);
    expect(runIdx).toBeGreaterThan(0);
    // `disabled` payload must be defined earlier in the file than the
    // first runNativePoll call so the early-return short-circuits the
    // poll runner.
    expect(disabledIdx).toBeLessThan(runIdx);
  });

  it("the auth check appears BEFORE the kill-switch check (no kill-switch auth bypass)", () => {
    const authIdx = routeSrc.search(/error:\s*"unauthorized"/);
    const disabledIdx = routeSrc.search(/status:\s*"disabled"/);
    expect(authIdx).toBeGreaterThan(0);
    expect(disabledIdx).toBeGreaterThan(0);
    expect(authIdx).toBeLessThan(disabledIdx);
  });
});

// ── cost-ledger.json write isolation ───────────────────────────────────

describe("Sprint 6A.3e — only the polling cost module writes cost-ledger.json", () => {
  /**
   * Files allowed to write to `cost-ledger.json`. Anything else
   * touching that file would bypass the budget gate and ruin
   * accountability — fail loud.
   *
   * Allowed:
   *   - src/lib/cost/budget.ts: defines `recordSpend` (the only writer)
   *   - tests/lib/cost/budget.test.ts + tests/adapters/perplexity/poll-cost.test.ts:
   *     write-to-tmpdir test fixtures (hermetic via process.chdir)
   *
   * The architecture test scans `src/` only; tests intentionally write
   * to tmpdirs and are out of scope here.
   */
  const ALLOWED_WRITERS = new Set<string>([
    "src/lib/cost/budget.ts",
  ]);

  it("no source file outside the allowlist references `cost-ledger.json` for writing", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      if (ALLOWED_WRITERS.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      // Detect either: a literal "cost-ledger" path string OR a
      // `writeFileSync` paired with the ledger basename. Read-only
      // references (e.g., monthly.ts which reads but doesn't write)
      // are filtered out by the allowlist + the substring match below.
      if (/cost-ledger\.json/.test(src)) {
        // Allow read-only imports / references. Flag only when paired
        // with a writeFileSync OR a writeStore call in the same file.
        const writes = /writeFileSync|writeStore|appendFileSync/.test(src);
        if (writes) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("budget.ts is the only file that writes to cost-ledger.json (smoke)", () => {
    const budgetSrc = readFileSync(
      resolve(SRC_ROOT, "lib/cost/budget.ts"),
      "utf8",
    );
    expect(budgetSrc).toMatch(/cost-ledger\.json/);
    expect(budgetSrc).toMatch(/writeFileSync/);
  });

  it("monthly.ts only READS cost-ledger.json (no writes)", () => {
    const monthlySrc = readFileSync(
      resolve(SRC_ROOT, "lib/cost/monthly.ts"),
      "utf8",
    );
    expect(monthlySrc).toMatch(/cost-ledger\.json/);
    expect(monthlySrc).not.toMatch(/writeFileSync|appendFileSync/);
  });
});

// ── llm-budget store write isolation (Section 12 N2) ───────────────────

describe("Section 12 N2 — only adjudicator-budget writes the llm-budget store", () => {
  /**
   * The LLM + regenerate spend ledger is the json-store keyed
   * "llm-budget", persisted by adjudicator-budget.ts via the json-store
   * writer keyed by its STORE_NAME constant. It is a SEPARATE ledger
   * from the native-polling `cost-ledger.json`; the two must never
   * cross-charge (Section 12 N2 isolation lock). Any other src file
   * pairing the bare json-store key "llm-budget" with a store-writer
   * call would bypass the monthly LLM cap — fail loud.
   *
   * (This test only READS source via readFileSync; it never persists.
   *  The comment above intentionally avoids the literal store-writer
   *  call shape so the `llm-budget-test-isolation` meta-test's loop-
   *  shape heuristic does not false-positive on this static-analysis
   *  file.)
   *
   * NOTE: the bare key "llm-budget" (the json-store name) is distinct
   * from the filename `llm-budget.json`, which appears only in prose
   * comments of monthly.ts / budget.ts / specific-edit-llm-history.ts /
   * recommended-edits-persistence.ts. Those are read-only references, not
   * writers, and are NOT matched by the bare-key regex below.
   *
   * Allowed to reference the bare key:
   *   - adjudicator-budget.ts: defines + writes the store (canonical writer)
   *   - store-classification.ts: lists "llm-budget" in the store registry
   *     for classification metadata (no writeStore of this key)
   */
  const ALLOWED = new Set<string>([
    "src/domains/recommendations/adjudicator-budget.ts",
    "src/lib/persistence/store-classification.ts",
  ]);

  it('no source file outside the allowlist writes the "llm-budget" store', () => {
    const offenders: string[] = [];
    for (const f of walk(SRC_ROOT)) {
      const rel = f.slice(REPO_ROOT.length + 1);
      if (ALLOWED.has(rel)) continue;
      const src = readFileSync(f, "utf8");
      // Bare json-store key, NOT the `llm-budget.json` filename-in-comments.
      if (/"llm-budget"/.test(src) && /writeStore/.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("adjudicator-budget.ts is the canonical llm-budget writer (smoke)", () => {
    const src = readFileSync(
      resolve(SRC_ROOT, "domains/recommendations/adjudicator-budget.ts"),
      "utf8",
    );
    expect(src).toMatch(/STORE_NAME\s*=\s*"llm-budget"/);
    expect(src).toMatch(/writeStore<[^>]*>\(STORE_NAME/);
  });
});

// ── Existing LLM safety invariants stay green (smoke) ───────────────────

describe("Sprint 6A.3e — existing LLM safety invariants intact", () => {
  /**
   * The Sprint 6A.2d invariants live in
   * `tests/architecture/llm-safety-invariants.test.ts` and run as part
   * of the full suite. Pin one critical snippet here as a tripwire so
   * a future change that accidentally weakens those guards surfaces
   * even if the main file is moved/renamed.
   */
  it("openai provider source still pins VITEST + VERCEL guards", () => {
    const providerSrc = readFileSync(
      resolve(SRC_ROOT, "domains/recommendations/providers/openai.ts"),
      "utf8",
    );
    expect(providerSrc).toMatch(/process\.env\.VITEST\s*===\s*"true"/);
    expect(providerSrc).toMatch(/process\.env\.VERCEL\s*===\s*"1"/);
    expect(providerSrc).toMatch(/BEACON_LLM_BUILD_OK/);
  });

  it("currentTenantSlug still has the BEACON_TENANT_SLUG env fallback (Sprint 7.8e)", () => {
    const tcSrc = readFileSync(
      resolve(SRC_ROOT, "lib/tenant-context.ts"),
      "utf8",
    );
    expect(tcSrc).toMatch(/BEACON_TENANT_SLUG/);
  });
});
