/**
 * Architecture invariant — Slice 9.A1β (2026-05-18) — operator-substrate
 * contract (tightened from 9.A1α substrate-only posture).
 *
 * GA4 calls happen ONLY via server actions, never on a customer page
 * render path. Mirrors the locked `gsc-no-customer-surface-import`
 * invariant. The check enforces:
 *
 *   • No file under `src/app/(shell)/<customer-surface>` directly
 *     imports `src/lib/connectors/ga4/*`.
 *   • No file under `src/components/<customer-surface>` directly
 *     imports `src/lib/connectors/ga4/*`.
 *   • POSITIVE sanity check: the settings server-actions seam at
 *     `src/app/(shell)/settings/connectors/actions.ts` DOES import
 *     `@/lib/connectors/ga4/` — server actions execute on POST, not
 *     on render, so the actions seam is the only allowed entry
 *     point. Slice 9.A1β added the positive check after the seam
 *     landed; 9.A1α intentionally omitted it because the connector
 *     was substrate-only with zero callers.
 *
 * Pinned customer surfaces (scope of the scan):
 *   src/app/(shell)/today/**
 *   src/app/(shell)/recommendations/**
 *   src/app/(shell)/changes/**
 *   src/app/(shell)/prompts/**
 *   src/app/(shell)/local/**
 *   src/app/(shell)/competitors/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const SCAN_ROOTS = [
  "src/app/(shell)/today",
  "src/app/(shell)/recommendations",
  "src/app/(shell)/changes",
  "src/app/(shell)/prompts",
  "src/app/(shell)/local",
  "src/app/(shell)/competitors",
  "src/components/today",
  "src/components/recommendations",
  "src/components/changes",
  "src/components/prompts",
  "src/components/local",
];

const FORBIDDEN_PATTERNS = [
  /from\s+["']@\/lib\/connectors\/ga4\//,
  /from\s+["']@\/lib\/connectors\/ga4["']/,
  /\bga4ApiFetch\b/,
  /\blistGa4PropertiesForTenant\b/,
];

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("ga4 connector — no page-load call from customer surfaces", () => {
  it("no customer surface file imports the GA4 connector", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = join(REPO_ROOT, root);
      for (const path of walk(abs)) {
        const code = stripComments(readFileSync(path, "utf-8"));
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(code)) {
            offenders.push(
              `${path.replace(REPO_ROOT + "/", "")} (matched ${pat.source})`,
            );
            break;
          }
        }
      }
    }
    expect(
      offenders,
      "These customer-surface files import the GA4 connector. The " +
        "connector is operator-substrate only in Slice 9.A1α; the only " +
        "allowed seam (added in Slice 9.A1β) will be a server action " +
        "under `src/app/(shell)/settings/connectors/actions.ts`:\n" +
        offenders.map((f) => `  - ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("operator-substrate actions seam imports the GA4 connector (positive sanity)", () => {
    // The settings server-actions file IS allowed to import GA4 —
    // it's the only allowed entry point. This positive sanity check
    // ensures a future refactor doesn't accidentally drop the
    // import (which would leave the UI calling a non-existent
    // server action and dead-code the connector entirely).
    const actionsPath = join(
      REPO_ROOT,
      "src/app/(shell)/settings/connectors/actions.ts",
    );
    const code = readFileSync(actionsPath, "utf-8");
    expect(
      code.includes("@/lib/connectors/ga4/"),
      "actions.ts must import from @/lib/connectors/ga4/ — this is the " +
        "only allowed server-action seam for the GA4 property picker. " +
        "Slice 9.A1β added this contract; substrate-only 9.A1α omitted " +
        "it because the connector had no caller.",
    ).toBe(true);
  });
});
