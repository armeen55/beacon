/**
 * Architecture invariant — Section 8 J3 (2026-05-18).
 *
 * Pins:
 *   1. `quota-stagger.ts` is a PURE module. No imports from Supabase,
 *      no `fetch`, no I/O, no LLM, no `currentTenantId` (every
 *      stagger call MUST receive an explicit `tenantId`).
 *   2. The `staggerSlotHour(tenantId)` API takes the tenant_id as its
 *      sole input — there is no ambient tenant read.
 *   3. The 6-bucket / 4-hour window constants are pinned at the
 *      source-text level so a future refactor can't silently drift
 *      the schedule.
 *   4. No `Math.random` / `Date.now` direct reads — determinism
 *      requirement.
 *
 * Retirement: permanent. Multi-tenant quota safety is a structural
 * contract; the stagger pins the slot allocation by tenant_id hash
 * so two tenants can never share a quota window by accident.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const STAGGER_PATH = resolve(
  REPO_ROOT,
  "src",
  "lib",
  "connectors",
  "gsc",
  "quota-stagger.ts",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Architecture — gsc/quota-stagger tenant-isolation + purity (Section 8 J3)", () => {
  const src = readFileSync(STAGGER_PATH, "utf-8");
  const stripped = stripComments(src);

  // ─────────────────────────────────────────────────────────────────
  // Pin 1: purity — no I/O imports
  // ─────────────────────────────────────────────────────────────────

  it("does not import Supabase, fetch helpers, or tenant-context", () => {
    expect(stripped).not.toMatch(/from\s+["']@\/lib\/persistence\/supabase["']/);
    expect(stripped).not.toMatch(/from\s+["']@\/lib\/tenant-context["']/);
    expect(stripped).not.toMatch(/\bfetch\s*\(/);
    expect(stripped).not.toMatch(/\bcurrentTenantId\b/);
    expect(stripped).not.toMatch(/\bgetSupabaseAdmin\b/);
  });

  it("does not import any connector-store, LLM, or paid-API module", () => {
    expect(stripped).not.toMatch(/from\s+["']@\/lib\/connector-store["']/);
    expect(stripped).not.toMatch(/from\s+["']@\/lib\/connectors\/google-auth["']/);
    expect(stripped).not.toMatch(/\bOpenAI\b/);
    expect(stripped).not.toMatch(/\bAnthropic\b/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 2: tenant_id is the sole input to staggerSlotHour
  // ─────────────────────────────────────────────────────────────────

  it("staggerSlotHour signature takes tenantId: string", () => {
    expect(stripped).toMatch(
      /export\s+function\s+staggerSlotHour\s*\(\s*tenantId\s*:\s*string\s*\)/,
    );
  });

  it("isStaggerSlotActive takes { tenantId, now } only — no ambient reads", () => {
    expect(stripped).toMatch(
      /export\s+function\s+isStaggerSlotActive\s*\(\s*args\s*:\s*\{/,
    );
    // The args object must include both keys explicitly.
    expect(stripped).toMatch(/tenantId\s*:\s*string/);
    expect(stripped).toMatch(/now\s*:\s*Date\s*\|\s*number/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 3: locked 6-bucket / 4-hour constants
  // ─────────────────────────────────────────────────────────────────

  it("declares STAGGER_BUCKETS = 6 at the source level", () => {
    expect(stripped).toMatch(/STAGGER_BUCKETS\s*=\s*6/);
  });

  it("declares STAGGER_WINDOW_HOURS = 24 / STAGGER_BUCKETS", () => {
    // Source uses the expression form so the two constants stay in
    // lockstep if either is tuned in a future slice.
    expect(stripped).toMatch(/STAGGER_WINDOW_HOURS\s*=\s*24\s*\/\s*STAGGER_BUCKETS/);
  });

  it("declares MAX_RETRIES_ON_429 = 3 (locked policy)", () => {
    expect(stripped).toMatch(/MAX_RETRIES_ON_429\s*=\s*3/);
  });

  // ─────────────────────────────────────────────────────────────────
  // Pin 4: determinism — no Math.random / no direct Date.now()
  //
  // `Date.now()` is forbidden inside helpers so test injection of
  // `now` stays the only clock source. Production callers thread
  // their own `now` per Beacon's clock-injection convention.
  // ─────────────────────────────────────────────────────────────────

  it("does not call Math.random()", () => {
    expect(stripped).not.toMatch(/Math\.random\s*\(/);
  });

  it("does not call Date.now() inline (clock injection only)", () => {
    expect(stripped).not.toMatch(/Date\.now\s*\(/);
  });
});
