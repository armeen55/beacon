/**
 * Architecture test — operator-mode helper unification (C1, 2026-05-09).
 *
 * Pins the contract for `src/lib/operator-mode.ts`:
 *
 *   • Production code must call `isOperatorModeServer()` /
 *     `isOperatorModeClient()` instead of reading
 *     `process.env.BEACON_OPERATOR_MODE` /
 *     `process.env.NEXT_PUBLIC_OPERATOR_MODE` directly.
 *
 *   • Server-only gates (server components, route handlers, server
 *     actions, scripts) use the server helper.
 *
 *   • Client-only debug surfaces (data-attrs, debug panels) use the
 *     client helper.
 *
 *   • Default customer mode (both env vars unset) is `false`.
 *
 *   • The two flags are documented as both-must-be-set for operator
 *     mode.
 *
 * Allow-listed direct env reads (places where the literal env-var
 * string MUST appear, by definition):
 *   - src/lib/operator-mode.ts        (the helper itself)
 *   - tests/                          (assertions about the helper)
 *   - .github/workflows/              (yaml secrets passed to runners)
 *   - .env.local.example, README, docs/, ops/                  (docs)
 *   - src/domains/today/command-center-data.test.ts            (test mutates env)
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const HELPER_PATH = join(REPO_ROOT, "src/lib/operator-mode.ts");

// ─── Allow-list ─────────────────────────────────────────────────────────

const ALLOW_LIST_ABS = new Set<string>([
  // The helper itself.
  join(REPO_ROOT, "src/lib/operator-mode.ts"),
  // command-center-data.test.ts mutates the env var to assert the
  // resolved boolean — that's the right shape for that test.
  join(REPO_ROOT, "src/domains/today/command-center-data.test.ts"),
  // live-changes-block.test.tsx mutates NEXT_PUBLIC_OPERATOR_MODE +
  // NODE_ENV to assert the data-rec-id leak gate strips the attribute
  // in customer mode (2026-05-10 demo-path fix). Same allow-list
  // pattern as command-center-data.test.ts above.
  join(REPO_ROOT, "src/components/today/live-changes-block.test.tsx"),
]);

const ALLOW_LIST_PREFIXES = [
  // Architecture tests must reference the literal strings to assert them.
  join(REPO_ROOT, "tests/"),
];

function isAllowed(absPath: string): boolean {
  if (ALLOW_LIST_ABS.has(absPath)) return true;
  return ALLOW_LIST_PREFIXES.some((p) => absPath.startsWith(p));
}

// ─── File walker ────────────────────────────────────────────────────────

function walkSrcAndScripts(): string[] {
  const out: string[] = [];
  const roots = [join(REPO_ROOT, "src"), join(REPO_ROOT, "scripts")];
  const extOK = (n: string) =>
    n.endsWith(".ts") || n.endsWith(".tsx") || n.endsWith(".cjs") ||
    n.endsWith(".mjs") || n.endsWith(".js");
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (extOK(name)) out.push(p);
    }
  }
  for (const r of roots) walk(r);
  return out;
}

// ─── Invariant 1 — helper module exists with correct shape ─────────────

describe("Operator-mode helpers — Invariant 1: helper module shape", () => {
  it("src/lib/operator-mode.ts exists", () => {
    expect(existsSync(HELPER_PATH)).toBe(true);
  });

  const HELPER_SRC = existsSync(HELPER_PATH) ? readFileSync(HELPER_PATH, "utf-8") : "";

  it("exports isOperatorModeServer reading BEACON_OPERATOR_MODE", () => {
    expect(HELPER_SRC).toMatch(
      /export function isOperatorModeServer\(\)[\s\S]{0,200}process\.env\.BEACON_OPERATOR_MODE\s*===\s*"true"/,
    );
  });

  it("exports isOperatorModeClient reading NEXT_PUBLIC_OPERATOR_MODE (with NODE_ENV=test extension)", () => {
    expect(HELPER_SRC).toMatch(
      /export function isOperatorModeClient\(\)[\s\S]{0,400}process\.env\.NEXT_PUBLIC_OPERATOR_MODE\s*===\s*"true"/,
    );
    expect(HELPER_SRC).toMatch(/NODE_ENV\s*===\s*"test"/);
  });

  it("documents the 'customer-default unset; operator-must-set-both' contract", () => {
    // A few keywords from the JSDoc that should not silently rot.
    expect(HELPER_SRC).toMatch(/customer/i);
    expect(HELPER_SRC).toMatch(/default[^.]{0,80}unset/i);
    expect(HELPER_SRC).toMatch(/server-only/i);
    expect(HELPER_SRC).toMatch(/client/i);
  });
});

// ─── Invariant 2 — no direct env reads outside allow-list ──────────────

describe("Operator-mode helpers — Invariant 2: no direct env reads outside allow-list", () => {
  const FILES = walkSrcAndScripts();

  it("no production file reads process.env.BEACON_OPERATOR_MODE directly", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (isAllowed(f)) continue;
      const src = readFileSync(f, "utf-8");
      if (/process\.env\.BEACON_OPERATOR_MODE/.test(src)) {
        offenders.push(relative(REPO_ROOT, f));
      }
    }
    expect(offenders, `expected no direct reads, got: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no production file reads process.env.NEXT_PUBLIC_OPERATOR_MODE directly", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (isAllowed(f)) continue;
      const src = readFileSync(f, "utf-8");
      if (/process\.env\.NEXT_PUBLIC_OPERATOR_MODE/.test(src)) {
        offenders.push(relative(REPO_ROOT, f));
      }
    }
    expect(offenders, `expected no direct reads, got: ${offenders.join(", ")}`).toEqual([]);
  });
});

// ─── Invariant 3 — diagnostics server gates use the server helper ──────

describe("Operator-mode helpers — Invariant 3: server gates use isOperatorModeServer", () => {
  const PAGES = [
    "src/app/(shell)/diagnostics/page.tsx",
    "src/app/(shell)/diagnostics/brain/page.tsx",
    "src/app/(shell)/diagnostics/spikes/page.tsx",
    "src/app/(shell)/settings/exit-gates-settings-hint.tsx",
    "src/domains/today/command-center-data.ts",
  ];

  for (const rel of PAGES) {
    it(`${rel} imports and uses isOperatorModeServer`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf-8");
      expect(src).toContain("isOperatorModeServer");
      expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
    });

    it(`${rel} does not read BEACON_OPERATOR_MODE directly`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf-8");
      expect(src).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
    });
  }
});

// ─── Invariant 4 — client debug gates use the client helper ────────────

describe("Operator-mode helpers — Invariant 4: client debug gates use isOperatorModeClient", () => {
  const CLIENT_FILES = [
    "src/app/(shell)/recommendations/recommendations-client.tsx",
    "src/app/(shell)/changes/scorecard-client.tsx",
    "src/app/(shell)/settings/import/import-page.tsx",
  ];

  for (const rel of CLIENT_FILES) {
    it(`${rel} imports and uses isOperatorModeClient`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf-8");
      expect(src).toContain("isOperatorModeClient");
      expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
    });

    it(`${rel} does not read NEXT_PUBLIC_OPERATOR_MODE directly`, () => {
      const src = readFileSync(join(REPO_ROOT, rel), "utf-8");
      expect(src).not.toMatch(/process\.env\.NEXT_PUBLIC_OPERATOR_MODE/);
    });
  }
});

// ─── Invariant 5 — unset env defaults to false ─────────────────────────

describe("Operator-mode helpers — Invariant 5: customer default is false when unset", () => {
  // We cannot directly import the helper here without re-running its
  // module init, but we can simulate the contract: with both env vars
  // unset and NODE_ENV !== "test", both helpers must return false.
  // The literal source assertion on the helper is the strongest static
  // proof we have without crossing the boundary into runtime tests of
  // the helper module itself (covered separately).

  const HELPER_SRC = existsSync(HELPER_PATH) ? readFileSync(HELPER_PATH, "utf-8") : "";

  it("isOperatorModeServer compares strictly against the literal 'true'", () => {
    // === "true" means undefined / "" / "false" / anything else → false.
    expect(HELPER_SRC).toMatch(/BEACON_OPERATOR_MODE\s*===\s*"true"/);
  });

  it("isOperatorModeClient compares strictly against the literal 'true' for the public flag", () => {
    expect(HELPER_SRC).toMatch(/NEXT_PUBLIC_OPERATOR_MODE\s*===\s*"true"/);
  });
});

// ─── Invariant 6 — docs/comments make the contract explicit ────────────

describe("Operator-mode helpers — Invariant 6: contract is documented", () => {
  const HELPER_SRC = existsSync(HELPER_PATH) ? readFileSync(HELPER_PATH, "utf-8") : "";

  it("helper file documents 'both must be intentionally set' rule", () => {
    expect(HELPER_SRC).toMatch(/both/i);
    expect(HELPER_SRC).toMatch(/intentional/i);
  });

  it("helper file documents the no-mixing rule for server vs client", () => {
    // Match either of two phrasings the doc uses for "don't read the
    // server-only flag from a client component" / "don't depend on
    // the client flag for server-only gates."
    expect(HELPER_SRC).toMatch(
      /(?:client component|client bundle|client-only)[\s\S]{0,200}(?:never|do not|undefined|silently)/i,
    );
  });
});
