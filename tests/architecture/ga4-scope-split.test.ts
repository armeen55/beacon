/**
 * Architecture invariant — Slice 9.A1 (2026-05-18).
 *
 * GA4 OAuth scope-split. The locked rule (operator-confirmed): each
 * Google connector kind (`gsc` | `gbp` | `ga4`) requests exactly ONE
 * scope set, and that scope is unique to the kind. A future drift
 * that merges scope sets — e.g., re-adding a combined
 * `GOOGLE_OAUTH_SCOPES` constant, OR adding `analytics.readonly` to
 * the `gsc` row of the `SCOPES` map — would force the GA4 consent
 * screen to ask for permissions a property picker doesn't need (or
 * the inverse). This test pins the contract at the source level.
 *
 * Positive invariants:
 *   • `GA4_SCOPE` constant exists with the exact
 *     `analytics.readonly` URL.
 *   • `SCOPES.ga4` is present in the SCOPES map.
 *   • `GoogleConnectorKind` union includes "ga4".
 *
 * Negative invariants:
 *   • `analytics.readonly` literal appears EXACTLY once in
 *     google-auth.ts (i.e., on the `GA4_SCOPE` constant line).
 *   • `GA4_SCOPE` is NOT referenced inside the GSC or GBP scope
 *     constants.
 *   • No combined-scopes constant has been re-introduced.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const AUTH_PATH = join(REPO_ROOT, "src/lib/connectors/google-auth.ts");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const AUTH_SRC = readFileSync(AUTH_PATH, "utf-8");
const AUTH_CODE = stripComments(AUTH_SRC);

describe("google-auth.ts — GA4 scope split", () => {
  it("declares the analytics.readonly scope as a top-level constant", () => {
    expect(
      /const\s+GA4_SCOPE\s*=\s*["']https:\/\/www\.googleapis\.com\/auth\/analytics\.readonly["']/.test(
        AUTH_CODE,
      ),
      "google-auth.ts must declare `const GA4_SCOPE = \"https://www.googleapis.com/auth/analytics.readonly\";`",
    ).toBe(true);
  });

  it("maps the ga4 kind to GA4_SCOPE in the SCOPES record", () => {
    expect(
      /SCOPES\s*:\s*Record<GoogleConnectorKind,\s*string>\s*=\s*\{[\s\S]*?\bga4\s*:\s*GA4_SCOPE/.test(
        AUTH_CODE,
      ),
      "SCOPES map must include `ga4: GA4_SCOPE` so buildGoogleAuthUrl('ga4', ...) requests analytics.readonly.",
    ).toBe(true);
  });

  it("GoogleConnectorKind union includes 'ga4'", () => {
    expect(
      /export\s+type\s+GoogleConnectorKind\s*=\s*[^;]*\bga4\b/.test(AUTH_CODE),
      "GoogleConnectorKind must include 'ga4'.",
    ).toBe(true);
  });

  it("analytics.readonly literal appears exactly once (on the GA4_SCOPE constant)", () => {
    const occurrences = AUTH_CODE.match(/analytics\.readonly/g) ?? [];
    expect(
      occurrences.length,
      "analytics.readonly should appear exactly once in google-auth.ts " +
        "(on the GA4_SCOPE constant). Multiple occurrences likely mean " +
        "scope bleed into the gsc/gbp constants.",
    ).toBe(1);
  });

  it("GSC + GBP scope constants do NOT include analytics.readonly", () => {
    // Match the GSC_SCOPE declaration and check it does not include
    // analytics.readonly. Same for GBP_SCOPE.
    const gscMatch = AUTH_CODE.match(/const\s+GSC_SCOPE\s*=\s*["']([^"']+)["']/);
    const gbpMatch = AUTH_CODE.match(/const\s+GBP_SCOPE\s*=\s*["']([^"']+)["']/);
    expect(gscMatch?.[1]).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    expect(gbpMatch?.[1]).toBe("https://www.googleapis.com/auth/business.manage");
  });

  it("no combined-scopes constant has been re-introduced", () => {
    expect(
      /\bGOOGLE_OAUTH_SCOPES\b/.test(AUTH_CODE),
      "GOOGLE_OAUTH_SCOPES (the pre-scope-split combined constant) must NOT " +
        "be present — drift guard from the locked scope-split invariant.",
    ).toBe(false);
  });
});
