/**
 * Architecture invariant — Slice 9.A2β (2026-05-19).
 *
 * Customer-facing Changes detail Mode A path MUST NOT trigger a
 * live GA4 Data API call on render. The customer surface reads
 * cached `ga4_url_traffic` rows via Supabase admin ONLY; the only
 * way fresh GA4 data lands in production is operator-clicked
 * Refresh on `/diagnostics/outcome-attribution` (9.A2γ).
 *
 * Bounded orphan sweep (2026-07-20): the Changes detail v2 client
 * (`change-detail-v2-client.tsx`), the Act 3 Mode A component
 * (`outcome-attribution-act3.tsx`), and the Mode A loader
 * (`load-mode-a-for-changes-detail.ts`) were deleted — nothing in
 * production renders them since `/changes/[id]` collapsed to a
 * canonical-Results redirect (2026-07-17, commit `19d292c1`). Their
 * GA4-surface pins retired with the deleted bodies. The one invariant
 * that still applies to a LIVE file is kept below.
 *
 * Pins per file:
 *
 * 1) `src/app/(shell)/changes/[id]/page.tsx`:
 *    • NO import of `@/lib/connectors/ga4/*` (runtime OR type).
 *    • NO bare identifier `runGa4UrlTrafficReport` /
 *      `persistGa4UrlTraffic` / `refreshTenantGa4Traffic` /
 *      `normalizeGa4PagePathToFullUrl`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const PAGE_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/[id]/page.tsx",
);

const PAGE_RAW = readFileSync(PAGE_PATH, "utf-8");

const PAGE_CODE = stripComments(PAGE_RAW);

const FORBIDDEN_GA4_IDENTIFIERS: ReadonlyArray<string> = [
  "runGa4UrlTrafficReport",
  "persistGa4UrlTraffic",
  "refreshTenantGa4Traffic",
  "normalizeGa4PagePathToFullUrl",
];

// ─────────────────────────────────────────────────────────────────────
// Server page: src/app/(shell)/changes/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────

describe("Changes detail server page — no GA4 connector import", () => {
  it("does NOT import from @/lib/connectors/ga4/* (runtime OR type)", () => {
    expect(/from\s+["']@\/lib\/connectors\/ga4\//.test(PAGE_CODE)).toBe(false);
  });

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(PAGE_CODE)).toBe(false);
    });
  }

  // Surface collapse + dead-body removal (2026-07-20): /changes/[id] no
  // longer renders the Mode A Act 3 sub-line — it resolves the changelog
  // entry and redirects to the canonical Results proof card. The former
  // `loadModeAForChangesDetail` positive-sanity pin was retired with the
  // deleted body. The negative GA4 invariants above remain live: this
  // route must still never pull in a GA4 connector on render.
});
