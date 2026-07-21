/**
 * CONSTITUTION §2 — Authentication + secret boundaries.
 *
 * Consolidated from google-oauth-scope-split + operator-mode-helpers.
 * Pins:
 *   1. OAuth scope split: per-kind SCOPES map, signed state roundtrip,
 *      GSC vs GBP scopes never conflated, callback routes by validated
 *      state; the legacy combined `google` provider key is gone.
 *   2. Operator-mode is the SOLE gate for privileged surfaces — no
 *      production file reads BEACON_OPERATOR_MODE / NEXT_PUBLIC_OPERATOR_MODE
 *      directly (no env-fallback bypass), and the helper compares strictly
 *      against the literal "true" so unset === customer default (false).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// ── OAuth scope split ───────────────────────────────────────────────
const AUTH_CODE = stripComments(
  readFileSync(join(REPO_ROOT, "src/lib/connectors/google-auth.ts"), "utf-8"),
);
const CALLBACK_CODE = stripComments(
  readFileSync(
    join(REPO_ROOT, "src/app/api/connectors/google/callback/route.ts"),
    "utf-8",
  ),
);

describe("google-auth — OAuth scope split + signed state", () => {
  it("buildGoogleAuthUrl requires kind + state; GSC/GBP scopes are distinct", () => {
    expect(
      /export\s+function\s+buildGoogleAuthUrl\s*\(\s*kind\s*:\s*GoogleConnectorKind/.test(
        AUTH_CODE,
      ),
    ).toBe(true);
    expect(/state\s*:\s*string/.test(AUTH_CODE)).toBe(true);
    expect(/webmasters\.readonly/.test(AUTH_CODE)).toBe(true);
    expect(/business\.manage/.test(AUTH_CODE)).toBe(true);
  });

  it("uses a per-kind SCOPES map; the combined GOOGLE_OAUTH_SCOPES constant is removed", () => {
    expect(
      /SCOPES\s*:\s*Record<GoogleConnectorKind/.test(AUTH_CODE) ||
        /const\s+SCOPES\s*:\s*Record<GoogleConnectorKind/.test(AUTH_CODE),
    ).toBe(true);
    expect(/\bGOOGLE_OAUTH_SCOPES\b/.test(AUTH_CODE)).toBe(false);
  });

  it("signs/decodes state from BEACON_OAUTH_STATE_SECRET", () => {
    expect(/export\s+function\s+encodeOAuthState\s*\(/.test(AUTH_CODE)).toBe(true);
    expect(/export\s+function\s+decodeOAuthState\s*\(/.test(AUTH_CODE)).toBe(true);
    expect(/BEACON_OAUTH_STATE_SECRET/.test(AUTH_CODE)).toBe(true);
  });

  it("callback validates state and routes to google_gsc / google_gbp (not legacy 'google')", () => {
    expect(/\bdecodeOAuthState\b/.test(CALLBACK_CODE)).toBe(true);
    expect(/google_gsc/.test(CALLBACK_CODE)).toBe(true);
    expect(/google_gbp/.test(CALLBACK_CODE)).toBe(true);
    expect(/invalid_state/.test(CALLBACK_CODE)).toBe(true);
    expect(/provider\s*:\s*["']google["']/.test(CALLBACK_CODE)).toBe(false);
  });
});

// ── Operator-mode env-read boundary ─────────────────────────────────
const HELPER_PATH = join(REPO_ROOT, "src/lib/operator-mode.ts");
const HELPER_SRC = readFileSync(HELPER_PATH, "utf-8");

function walkSrcAndScripts(): string[] {
  const out: string[] = [];
  const roots = [join(REPO_ROOT, "src"), join(REPO_ROOT, "scripts")];
  const extOK = (n: string) =>
    n.endsWith(".ts") ||
    n.endsWith(".tsx") ||
    n.endsWith(".cjs") ||
    n.endsWith(".mjs") ||
    n.endsWith(".js");
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (extOK(name)) out.push(p);
    }
  }
  for (const r of roots) walk(r);
  return out;
}

const ALLOW_ABS = new Set<string>([HELPER_PATH]);
const ALLOW_PREFIXES = [join(REPO_ROOT, "tests/")];
const isAllowed = (p: string) =>
  ALLOW_ABS.has(p) || ALLOW_PREFIXES.some((x) => p.startsWith(x));

describe("operator-mode — the SOLE gate; no direct env reads outside the helper", () => {
  it("helper exports strict server + client gates keyed off the operator env vars", () => {
    expect(HELPER_SRC).toMatch(
      /export function isOperatorModeServer\(\)[\s\S]{0,200}process\.env\.BEACON_OPERATOR_MODE\s*===\s*"true"/,
    );
    expect(HELPER_SRC).toMatch(
      /export function isOperatorModeClient\(\)[\s\S]{0,400}process\.env\.NEXT_PUBLIC_OPERATOR_MODE\s*===\s*"true"/,
    );
    // Strict === "true" ⇒ unset / "" / "false" all resolve to the
    // customer default (no operator surface without an intentional flag).
    expect(HELPER_SRC).toMatch(/BEACON_OPERATOR_MODE\s*===\s*"true"/);
  });

  for (const envVar of ["BEACON_OPERATOR_MODE", "NEXT_PUBLIC_OPERATOR_MODE"]) {
    it(`no production file reads process.env.${envVar} directly`, () => {
      const offenders: string[] = [];
      for (const f of walkSrcAndScripts()) {
        if (isAllowed(f)) continue;
        if (new RegExp(`process\\.env\\.${envVar}`).test(readFileSync(f, "utf-8")))
          offenders.push(relative(REPO_ROOT, f));
      }
      expect(offenders, offenders.join(", ")).toEqual([]);
    });
  }

  it("a real server gate imports + uses isOperatorModeServer (non-vacuous)", () => {
    const rel = "src/app/(shell)/settings/exit-gates-settings-hint.tsx";
    const src = readFileSync(join(REPO_ROOT, rel), "utf-8");
    expect(src).toContain("isOperatorModeServer");
    expect(src).toMatch(/from\s+["']@\/lib\/operator-mode["']/);
    expect(src).not.toMatch(/process\.env\.BEACON_OPERATOR_MODE/);
  });
});
