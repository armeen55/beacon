/**
 * Architecture invariant — connector-tokens-supabase-and-gsc-scope-split
 * (2026-05-16).
 *
 * Pins the OAuth scope split in `src/lib/connectors/google-auth.ts`:
 *   • Per-kind SCOPES map exists (or equivalent per-kind selection).
 *   • `buildGoogleAuthUrl` signature requires a `kind` parameter.
 *   • Combined `GOOGLE_OAUTH_SCOPES` constant from A.3.b1.alpha is
 *     removed (drift backstop — re-adding it conflates both scopes).
 *   • State signing helpers (`encodeOAuthState`, `decodeOAuthState`)
 *     are exported.
 *   • Callback route reads + decodes the state via `decodeOAuthState`
 *     and routes the persisted token to the correct provider key
 *     (google_gsc or google_gbp).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const AUTH_PATH = join(REPO_ROOT, "src/lib/connectors/google-auth.ts");
const CALLBACK_PATH = join(
  REPO_ROOT,
  "src/app/api/connectors/google/callback/route.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const AUTH_CODE = stripComments(readFileSync(AUTH_PATH, "utf-8"));
const CALLBACK_CODE = stripComments(readFileSync(CALLBACK_PATH, "utf-8"));

describe("google-auth — scope split shape", () => {
  it("buildGoogleAuthUrl signature includes a `kind` parameter", () => {
    expect(
      /export\s+function\s+buildGoogleAuthUrl\s*\(\s*kind\s*:\s*GoogleConnectorKind/.test(
        AUTH_CODE,
      ),
      "buildGoogleAuthUrl must accept `kind: GoogleConnectorKind` as " +
        "its first parameter so callers explicitly choose GSC or GBP.",
    ).toBe(true);
  });

  it("buildGoogleAuthUrl signature requires a `state` parameter", () => {
    expect(
      /state\s*:\s*string/.test(AUTH_CODE),
      "buildGoogleAuthUrl must accept a `state` parameter so each " +
        "OAuth flow carries a signed roundtrip token.",
    ).toBe(true);
  });

  it("GSC scope is `webmasters.readonly`", () => {
    expect(
      /webmasters\.readonly/.test(AUTH_CODE),
      "google-auth.ts must reference webmasters.readonly — the locked " +
        "GSC scope.",
    ).toBe(true);
  });

  it("GBP scope is `business.manage`", () => {
    expect(
      /business\.manage/.test(AUTH_CODE),
      "google-auth.ts must reference business.manage — the locked GBP " +
        "scope.",
    ).toBe(true);
  });

  it("Combined GOOGLE_OAUTH_SCOPES constant from A.3.b1.alpha is REMOVED", () => {
    expect(
      /\bGOOGLE_OAUTH_SCOPES\b/.test(AUTH_CODE),
      "google-auth.ts must NOT export a combined GOOGLE_OAUTH_SCOPES " +
        "constant. The A.3.b1.alpha combined-scopes posture is the " +
        "trust bug this slice fixes — each kind requests its own scope.",
    ).toBe(false);
  });

  it("Per-kind SCOPES map exists", () => {
    expect(
      /SCOPES\s*:\s*Record<GoogleConnectorKind/.test(AUTH_CODE) ||
        /const\s+SCOPES\s*:\s*Record<GoogleConnectorKind/.test(AUTH_CODE),
      "google-auth.ts must define a per-kind SCOPES map keyed by " +
        "GoogleConnectorKind so each kind selects exactly one scope.",
    ).toBe(true);
  });

  it("Exports `encodeOAuthState` and `decodeOAuthState`", () => {
    expect(/export\s+function\s+encodeOAuthState\s*\(/.test(AUTH_CODE)).toBe(true);
    expect(/export\s+function\s+decodeOAuthState\s*\(/.test(AUTH_CODE)).toBe(true);
  });

  it("Reads BEACON_OAUTH_STATE_SECRET from env", () => {
    expect(/BEACON_OAUTH_STATE_SECRET/.test(AUTH_CODE)).toBe(true);
  });
});

describe("callback route — state-validated provider routing", () => {
  it("imports decodeOAuthState", () => {
    expect(/\bdecodeOAuthState\b/.test(CALLBACK_CODE)).toBe(true);
  });

  it("routes valid kind='gsc' state to provider 'google_gsc'", () => {
    expect(/google_gsc/.test(CALLBACK_CODE)).toBe(true);
  });

  it("routes valid kind='gbp' state to provider 'google_gbp'", () => {
    expect(/google_gbp/.test(CALLBACK_CODE)).toBe(true);
  });

  it("redirects on invalid state with ?error=invalid_state", () => {
    expect(/invalid_state/.test(CALLBACK_CODE)).toBe(true);
  });

  it("does NOT use the deprecated single `google` provider key", () => {
    // The callback must NOT write under provider: "google" — that's
    // the A.3.b1.alpha key now superseded by google_gsc / google_gbp.
    expect(/provider\s*:\s*["']google["']/.test(CALLBACK_CODE)).toBe(false);
  });
});
