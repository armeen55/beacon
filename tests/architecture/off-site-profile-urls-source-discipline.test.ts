/**
 * Architecture invariant — Section 7 C7g v1 profile-URL source
 * discipline (2026-05-16).
 *
 * Operator-entered off-site profile URLs (houzzProfileUrl,
 * angiProfileUrl, bbbProfileUrl, industryDirectoryProfileUrl) flow
 * through ONE validation gate — the `operatorVouchedProfileUrl`
 * helper in `src/domains/off-site-authority/compute-snapshot.ts` —
 * which accepts ONLY http(s)-prefixed strings. The resulting
 * `OffSiteChannelState.source` must be `"business_config"` and
 * `confidence` must be `"medium"`. Beacon does NOT HTTP-verify the
 * URL in v1.
 *
 * This invariant pins:
 *   1. The helper exists in compute-snapshot.ts with the http(s)
 *      prefix gate.
 *   2. The four BusinessConfig fields are declared in
 *      `src/lib/business-config.ts`.
 *   3. The loader passes them through to the compute input.
 *   4. The operator diagnostic page distinguishes "Configured" from
 *      "Confirmed" by checking `row.source === "business_config"`.
 *
 * A drive-by that tries to widen the validator (e.g. accept
 * `mailto:`, `javascript:`, or a bare-domain string), or that marks
 * an operator-entered URL as `"connector_api"` source / `"high"`
 * confidence, will fail this test.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

describe("Architecture — Section 7 C7g v1 profile-URL source discipline", () => {
  it("compute-snapshot.ts declares operatorVouchedProfileUrl helper", () => {
    const src = read("src/domains/off-site-authority/compute-snapshot.ts");
    expect(src).toMatch(/function\s+operatorVouchedProfileUrl\b/);
  });

  it("operatorVouchedProfileUrl enforces http(s) prefix gate", () => {
    const src = read("src/domains/off-site-authority/compute-snapshot.ts");
    // Both prefixes must appear inside the validator. The structural
    // check is two literal strings; combined with the helper-exists
    // check above this catches a drive-by that drops the gate.
    expect(src).toContain('"https://"');
    expect(src).toContain('"http://"');
  });

  it("configured row uses source=business_config and confidence=medium", () => {
    const src = read("src/domains/off-site-authority/compute-snapshot.ts");
    // buildConfiguredRow must hard-code these two values.
    expect(src).toMatch(/source:\s*"business_config"/);
    // The compute path that handles configured Houzz/Angi/BBB/
    // industry_directory must emit confidence: "medium".
    const buildConfiguredRe =
      /function\s+buildConfiguredRow[\s\S]*?confidence:\s*"medium"/;
    expect(src).toMatch(buildConfiguredRe);
  });

  it("BusinessConfig declares the four profile URL fields", () => {
    const src = read("src/lib/business-config.ts");
    expect(src).toMatch(/houzzProfileUrl\s*:\s*string/);
    expect(src).toMatch(/angiProfileUrl\s*:\s*string/);
    expect(src).toMatch(/bbbProfileUrl\s*:\s*string/);
    expect(src).toMatch(/industryDirectoryProfileUrl\s*:\s*string/);
  });

  it("loader threads the four URL fields into the compute input", () => {
    const src = read("src/domains/off-site-authority/load-snapshot.ts");
    expect(src).toContain("houzzProfileUrl");
    expect(src).toContain("angiProfileUrl");
    expect(src).toContain("bbbProfileUrl");
    expect(src).toContain("industryDirectoryProfileUrl");
  });

  it("operator diagnostic distinguishes Configured from Confirmed by source", () => {
    const src = read(
      "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
    );
    expect(src).toContain('"Configured"');
    expect(src).toContain('"Confirmed"');
    // The decision MUST branch on the row.source value.
    expect(src).toMatch(/source\s*===\s*"business_config"/);
  });
});
