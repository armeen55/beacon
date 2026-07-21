/**
 * CONSTITUTION §6 — Destructive-action safety: indexing hold.
 *
 * (2026-07-21) The read-only indexability loader and its pins died with the
 * trigger->promotion producer pipeline; what remains — and must never
 * regress — is the accept-path half: the type-driven indexing HOLD posture
 * on every LIVE one-tap accept surface.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function raw(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

// #310 / destructive-action safety — the type-driven indexing HOLD posture must
// survive on every LIVE one-tap accept surface, not only the ported proof card.
// A crawl/index directive (robots.txt, meta noindex, canonical, redirect/status)
// can DEINDEX a live site if applied with a wrong value, so a wrong value must
// never be one tap away. This pins that both live accept surfaces reference the
// single source-of-truth guard (isIndexingDirectiveActionType) — an import-
// presence scan, so the guard can never be silently dropped from a surface and
// regress a directive back into a one-tap change. Preserves the suite's idiom
// (raw-source string scans, no rendering).
describe("indexing hold — every live one-tap accept surface references the guard (§6)", () => {
  const GUARD = "isIndexingDirectiveActionType";
  const GUARD_MODULE = "@/domains/recommendations/action-types";
  const LIVE_ACCEPT_SURFACES = [
    "src/app/(shell)/changes-list-client.tsx",
    "src/app/(shell)/today-moves-card.tsx",
  ] as const;

  for (const rel of LIVE_ACCEPT_SURFACES) {
    it(`${rel} imports + references ${GUARD}`, () => {
      const src = raw(rel);
      // Imported from the single source of truth, not re-implemented locally.
      expect(src).toContain(GUARD_MODULE);
      // Referenced at least twice: the import binding + at least one live call
      // site (the actual hold decision).
      expect((src.match(new RegExp(GUARD, "g")) ?? []).length).toBeGreaterThanOrEqual(2);
    });
  }
});
