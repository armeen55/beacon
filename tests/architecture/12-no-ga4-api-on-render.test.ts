/**
 * CONSTITUTION §3 — No paid provider calls during render (GA4 half).
 *
 * Pins that no customer/render surface triggers a live GA4 Data API
 * call — cached `ga4_url_traffic` rows via Supabase admin only; fresh
 * GA4 lands only on an operator-clicked Refresh.
 *
 * CORE 100K (2026-07-21): the outcome-attribution domain (Today
 * outcomes loader + Mode A pure-compute) was deleted as unreachable,
 * taking its loader/Mode-A pins with it. The surviving render surface
 * that historically regressed here is the Changes detail server page;
 * its guard stays.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const FORBIDDEN_GA4_IDENTIFIERS = [
  "runGa4UrlTrafficReport",
  "persistGa4UrlTraffic",
  "refreshTenantGa4Traffic",
  "normalizeGa4PagePathToFullUrl",
];

// ── Changes detail server page ──────────────────────────────────────
const PAGE_CODE = stripComments(
  readFileSync(
    join(REPO_ROOT, "src/app/(shell)/changes/[id]/page.tsx"),
    "utf-8",
  ),
);

describe("Changes detail server page — no GA4 connector import on render", () => {
  it("does NOT import from @/lib/connectors/ga4/* (runtime OR type)", () => {
    expect(/from\s+["']@\/lib\/connectors\/ga4\//.test(PAGE_CODE)).toBe(false);
  });
  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      expect(new RegExp(`\\b${id}\\b`).test(PAGE_CODE)).toBe(false);
    });
  }
});
