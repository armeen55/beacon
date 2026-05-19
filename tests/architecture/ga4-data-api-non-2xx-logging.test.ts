/**
 * Architecture invariant — Slice 9.A2α (2026-05-19).
 *
 * Non-2xx logging discipline for the GA4 Data API client. Folds in
 * the 9.A1β-deferred logging fix: every Data API call site must
 * emit a `log.warn` with bounded body capture on non-2xx non-401
 * responses so opaque Google-side failures (e.g. "Data API has not
 * been used" 403 PERMISSION_DENIED) are visible in operator triage.
 *
 * Pins:
 *   1. `data-api.ts` calls `log.warn` with the `[ga4-data-api]`
 *      prefix at the non-2xx branch.
 *   2. The log payload includes `tenantId`, `status`, AND `body`
 *      fields.
 *   3. Body capture is bounded to ≤ 500 characters via `.slice(0,
 *      500)`.
 *   4. The substrate `client.ts` (extended in 9.A2α with the same
 *      pattern) also emits the symmetric `[ga4-client]` non-2xx log.
 *   5. Bounded body capture wrapper is wrapped in a try/catch so a
 *      broken response.text() never throws.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const DATA_API_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/data-api.ts");
const CLIENT_PATH = join(REPO_ROOT, "src/lib/connectors/ga4/client.ts");

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const DATA_API_CODE = stripComments(readFileSync(DATA_API_PATH, "utf-8"));
const CLIENT_CODE = stripComments(readFileSync(CLIENT_PATH, "utf-8"));

describe("ga4 data-api — non-2xx logging discipline", () => {
  it("data-api.ts emits log.warn with the [ga4-data-api] non-2xx prefix", () => {
    expect(
      /log\.warn\(\s*["'][^"']*\[ga4-data-api\][^"']*non-2xx/.test(DATA_API_CODE),
      "data-api.ts must call log.warn with the literal `[ga4-data-api]` prefix and `non-2xx` substring at the non-2xx response branch.",
    ).toBe(true);
  });

  it("data-api.ts log payload includes tenantId + status + body fields", () => {
    // The log call site shape:
    //   log.warn("[ga4-data-api] non-2xx response from GA4 Data API", {
    //     tenantId, status: response.status, body: errorBody,
    //   })
    const collapsed = DATA_API_CODE.replace(/\s+/g, " ");
    expect(
      /log\.warn\([^)]*\[ga4-data-api\][^)]*tenantId/.test(collapsed),
      "data-api.ts non-2xx log.warn payload must include `tenantId`.",
    ).toBe(true);
    expect(
      /log\.warn\([^)]*\[ga4-data-api\][^)]*status/.test(collapsed),
      "data-api.ts non-2xx log.warn payload must include `status`.",
    ).toBe(true);
    expect(
      /log\.warn\([^)]*\[ga4-data-api\][^)]*body/.test(collapsed),
      "data-api.ts non-2xx log.warn payload must include `body`.",
    ).toBe(true);
  });

  it("data-api.ts bounds body capture to ≤ 500 chars via .slice(0, 500)", () => {
    expect(
      /\.slice\(0,\s*500\)/.test(DATA_API_CODE),
      "data-api.ts must bound body capture to 500 chars via `.slice(0, 500)`.",
    ).toBe(true);
  });

  it("client.ts emits the symmetric [ga4-client] non-2xx log (9.A2α extension of 9.A1α substrate)", () => {
    expect(
      /log\.warn\(\s*["'][^"']*\[ga4-client\][^"']*non-2xx/.test(CLIENT_CODE),
      "client.ts must call log.warn with the literal `[ga4-client]` prefix at the non-2xx response branch — symmetric with data-api.ts, folds in the 9.A1β-deferred fix.",
    ).toBe(true);
  });

  it("client.ts also bounds body capture to ≤ 500 chars", () => {
    const collapsed = CLIENT_CODE.replace(/\s+/g, " ");
    expect(
      /\.slice\(\s*0\s*,\s*500\s*\)/.test(collapsed),
      "client.ts non-2xx body capture must be bounded to 500 chars.",
    ).toBe(true);
  });

  it("body capture is wrapped in try/catch (defensive against broken response.text())", () => {
    // The pattern: try { (await response.text()).slice(0, 500); } catch { ... }
    expect(
      /try\s*{[^}]*response\.text\(\)[^}]*\.slice\([^}]*}\s*catch/.test(
        DATA_API_CODE,
      ),
      "data-api.ts body capture must be wrapped in try/catch.",
    ).toBe(true);
  });
});
