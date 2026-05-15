/**
 * Architecture invariant — Prompts detail prerender safety (2026-05-15).
 *
 * The Section 6 C5 commit added a tenant-scoped Supabase read on
 * `/prompts/[id]` (via `computePromptPrimaryShare`). Static prerender
 * would execute that read at `next build` and risk the same
 * statement-timeout flake we hit on `/diagnostics` (commit 730a6de
 * → fixed in 2bc08aa).
 *
 * This invariant pins:
 *   1. `src/app/(shell)/prompts/[id]/page.tsx` declares
 *      `export const dynamic = "force-dynamic"`.
 *   2. The existing invalid-id guard (`decodePromptRouteId` → null →
 *      `<PromptDetailV2NotFound />` short-circuit) remains intact —
 *      defense-in-depth so a future drive-by can't drop the guard
 *      while flipping render mode.
 *
 * Companion invariant `tests/architecture/diagnostics-page-dynamic.test.ts`
 * pins the same contract on the diagnostics page family. C5
 * extends the contract to the customer-facing prompt detail.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

const PAGE_SRC = read("src/app/(shell)/prompts/[id]/page.tsx");

describe("Architecture — /prompts/[id] force-dynamic (Section 6 C5)", () => {
  it("declares export const dynamic = \"force-dynamic\"", () => {
    expect(PAGE_SRC).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });

  it("retains the invalid-id guard (decodePromptRouteId → null → PromptDetailV2NotFound)", () => {
    expect(PAGE_SRC).toMatch(/decodePromptRouteId\s*\(/);
    expect(PAGE_SRC).toMatch(/PromptDetailV2NotFound/);
  });
});
