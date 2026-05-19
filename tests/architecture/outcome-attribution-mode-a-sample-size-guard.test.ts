/**
 * Architecture invariant — Slice 9.A2α.2 (2026-05-19).
 *
 * Mode A sample-size guard discipline. Section 9 K4 lock:
 *   ≥ 7 days post-live AND (≥ 5 sessions OR ≥ 1 qualified call).
 *
 * Pins the three threshold constants at the source level so a
 * future refactor can't silently weaken the guard. CallRail
 * deferred indefinitely per K2; the qualified-call branch must
 * remain in the source so the guard is forward-compatible with
 * the future 9.B connector.
 *
 * Pins:
 *   1. `MODE_A_MIN_DAYS_POST_LIVE = 7` (exact integer).
 *   2. `MODE_A_MIN_SESSIONS = 5` (exact integer).
 *   3. `MODE_A_MIN_QUALIFIED_CALLS = 1` (exact integer).
 *   4. The K4 OR-branch
 *      (`!sessionsThresholdMet && !callsThresholdMet`)
 *      is present in source — both branches honored so CallRail
 *      can light up the call branch without a code change.
 *   5. `computeModeATrafficAttribution` exported as a pure
 *      (non-async) function.
 *   6. `import "server-only"` at top.
 *   7. No direct Supabase / fetch / GA4 Data API client imports —
 *      pure compute over caller-supplied rows.
 *   8. No ambient `currentTenantSlug()` / `currentTenantId()` reads.
 *   9. Defense in depth: K5 forbidden customer-vocab tokens
 *      (`drove` / `caused` / `generated` / `revenue` / `dollars`)
 *      absent from source — protects against future copy leaks
 *      when 9.A2β customer surfaces consume this result.
 *  10. No fetch / no XHR / no `fetch(` in source — Mode A NEVER
 *      reaches the network.
 *  11. No customer surface / page / component imports.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MODE_A_PATH = join(
  REPO_ROOT,
  "src/domains/outcome-attribution/mode-a-cited-here-traffic-here.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const MODE_A_CODE = stripComments(readFileSync(MODE_A_PATH, "utf-8"));

/**
 * Return only the RUNTIME `import { X } from "..."` lines from a
 * source file — strips `import type { X } from "..."` lines because
 * TypeScript erases type-only imports at compile time, so they have
 * zero runtime impact and CANNOT introduce a runtime dependency on
 * a connector / surface module. The invariant's intent is "no
 * runtime imports of connectors / customer surfaces"; type-only
 * imports for purely structural typing (e.g. `Ga4UrlTrafficRow`,
 * `RecommendedEditRow`) are allowed.
 */
function runtimeImportLines(code: string): string {
  return code
    .split("\n")
    .filter(
      (line) =>
        /\bfrom\s+["']/.test(line) && !/\bimport\s+type\b/.test(line),
    )
    .join("\n");
}

const MODE_A_RUNTIME_IMPORTS = runtimeImportLines(MODE_A_CODE);

// ─────────────────────────────────────────────────────────────────────
// Locked K4 thresholds
// ─────────────────────────────────────────────────────────────────────

describe("Mode A sample-size guard — locked thresholds", () => {
  it("pins MODE_A_MIN_DAYS_POST_LIVE = 7 as a top-level export", () => {
    expect(
      /export\s+const\s+MODE_A_MIN_DAYS_POST_LIVE\s*=\s*7\s*;/.test(MODE_A_CODE),
      "MODE_A_MIN_DAYS_POST_LIVE must be exactly `7` (Section 9 K4 lock).",
    ).toBe(true);
  });

  it("pins MODE_A_MIN_SESSIONS = 5 as a top-level export", () => {
    expect(
      /export\s+const\s+MODE_A_MIN_SESSIONS\s*=\s*5\s*;/.test(MODE_A_CODE),
      "MODE_A_MIN_SESSIONS must be exactly `5` (Section 9 K4 lock).",
    ).toBe(true);
  });

  it("pins MODE_A_MIN_QUALIFIED_CALLS = 1 as a top-level export", () => {
    expect(
      /export\s+const\s+MODE_A_MIN_QUALIFIED_CALLS\s*=\s*1\s*;/.test(MODE_A_CODE),
      "MODE_A_MIN_QUALIFIED_CALLS must be exactly `1` (Section 9 K4 lock; CallRail-ready).",
    ).toBe(true);
  });

  it("honors the K4 OR-branch (sessionsThresholdMet OR callsThresholdMet)", () => {
    // The K4 contract is: eligible when EITHER sessions threshold met
    // OR calls threshold met. The negated form in the guard:
    //   if (!sessionsThresholdMet && !callsThresholdMet) → still_learning
    const collapsed = MODE_A_CODE.replace(/\s+/g, " ");
    expect(
      /!\s*sessionsThresholdMet\s*&&\s*!\s*callsThresholdMet/.test(collapsed),
      "Mode A K4 guard must use `!sessionsThresholdMet && !callsThresholdMet` so the EITHER-condition is honored. CallRail-deferred per K2 but the branch stays present.",
    ).toBe(true);
  });

  it("computeModeATrafficAttribution exported as a non-async pure function", () => {
    expect(
      /export\s+function\s+computeModeATrafficAttribution/.test(MODE_A_CODE),
      "mode-a-cited-here-traffic-here.ts must export `computeModeATrafficAttribution` as a non-async pure function.",
    ).toBe(true);
    expect(
      /export\s+async\s+function\s+computeModeATrafficAttribution/.test(
        MODE_A_CODE,
      ),
      "computeModeATrafficAttribution must NOT be async — pure synchronous compute.",
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Purity + server-only posture
// ─────────────────────────────────────────────────────────────────────

describe("Mode A — purity + server-only posture", () => {
  it("imports 'server-only'", () => {
    expect(
      /import\s+["']server-only["']/.test(MODE_A_CODE),
      "mode-a-cited-here-traffic-here.ts must import 'server-only'.",
    ).toBe(true);
  });

  it("does NOT import Supabase admin / persistence repository directly", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(MODE_A_CODE),
      "Mode A is a pure compute module — Supabase reads happen at the consumer (operator diagnostic page); this module must not import getSupabaseAdmin.",
    ).toBe(false);
    expect(
      /from\s+["']@\/lib\/persistence\/repositories["']/.test(MODE_A_CODE),
      "Mode A must not import getRepository — pure compute over caller-supplied rows.",
    ).toBe(false);
  });

  it("does NOT import the GA4 Data API client (pure read-side; no API call from this module)", () => {
    expect(
      /from\s+["']@\/lib\/connectors\/ga4\/data-api["']/.test(MODE_A_CODE),
      "Mode A is pure compute over caller-supplied Ga4UrlTrafficRow[]; it must not import data-api.ts directly.",
    ).toBe(false);
  });

  it("does NOT runtime-import any connector module under @/lib/connectors/", () => {
    expect(
      /from\s+["']@\/lib\/connectors\//.test(MODE_A_RUNTIME_IMPORTS),
      "Mode A must not RUNTIME-import any connector. Type-only imports (`import type { X } from ...`) are allowed; this test scans only value imports.",
    ).toBe(false);
  });

  it("does NOT call fetch (no network access)", () => {
    expect(
      /\bfetch\s*\(/.test(MODE_A_CODE),
      "Mode A must not call fetch — pure compute, no network access.",
    ).toBe(false);
  });

  it("does NOT call ambient currentTenantSlug() / currentTenantId()", () => {
    expect(/\bcurrentTenantSlug\s*\(/.test(MODE_A_CODE)).toBe(false);
    expect(/\bcurrentTenantId\s*\(/.test(MODE_A_CODE)).toBe(false);
  });

  it("does NOT runtime-import any customer surface / page / component module", () => {
    // Scans RUNTIME imports only — type-only imports (e.g.
    // `import type { RecommendedEditRow } from
    // "@/domains/recommendations/recommended-edits-persistence"`)
    // are allowed because TypeScript erases them at compile time.
    const forbiddenImports = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/changes["']/,
      /from\s+["']@\/domains\/changes\//,
      /from\s+["']@\/domains\/prompts["']/,
      /from\s+["']@\/domains\/prompts\//,
    ];
    for (const pat of forbiddenImports) {
      expect(
        pat.test(MODE_A_RUNTIME_IMPORTS),
        `Mode A must NOT runtime-import customer surfaces. Forbidden pattern: ${pat.source}`,
      ).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Customer-vocab K5 defense in depth
// ─────────────────────────────────────────────────────────────────────

describe("Mode A — customer-vocab K5 forbidden tokens (defense in depth)", () => {
  // Even though this module emits no customer copy directly, the
  // discriminated union it returns IS consumed by 9.A2β's Changes
  // detail copy. Banning K5 tokens in source keeps the contract
  // visible at the type level.
  //
  // Note: the literal `$` character is NOT pinned here because
  // TypeScript template literals use `${expr}` syntax — banning `$`
  // would be a false positive against `${y}-${m}-${day}` etc. The
  // currency-rendering concern is correctly pinned at the render
  // boundary (operator diagnostic + future 9.A2β customer copy
  // tests).
  const FORBIDDEN = ["drove", "caused", "generated", "revenue", "dollars"];

  for (const word of FORBIDDEN) {
    it(`does NOT use the K5 forbidden word "${word}" anywhere in source`, () => {
      const lower = MODE_A_CODE.toLowerCase();
      expect(
        lower.includes(word),
        `mode-a-cited-here-traffic-here.ts must NOT contain the K5 forbidden word "${word}" — defense in depth against future copy leaks.`,
      ).toBe(false);
    });
  }
});
