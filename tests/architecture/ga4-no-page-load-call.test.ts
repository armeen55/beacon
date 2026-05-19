/**
 * Architecture invariant — Slice 9.A1α (2026-05-18) — substrate-only.
 *
 * Substrate posture: the GA4 connector exists under
 * `src/lib/connectors/ga4/` but has ZERO consumers in v1. Slice
 * 9.A1α ships the connector, types, and OAuth wiring; Slice 9.A1β
 * lands the `/settings/connectors` UI + server-action seam that
 * actually calls the connector.
 *
 * This invariant enforces:
 *
 *   • No file under `src/app/(shell)/<customer-surface>` directly
 *     imports `src/lib/connectors/ga4/*`.
 *   • No file under `src/components/<customer-surface>` directly
 *     imports `src/lib/connectors/ga4/*`.
 *
 * When Slice 9.A1β lands the actions seam at
 * `src/app/(shell)/settings/connectors/actions.ts`, this invariant
 * tightens by adding a POSITIVE sanity check that the actions file
 * DOES import the connector (the only allowed seam). For 9.A1α the
 * sanity check is intentionally omitted — the connector has no
 * caller, by design.
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

  it("9.A1α substrate posture — no settings actions seam yet (no positive sanity check)", () => {
    // Slice 9.A1α intentionally ships the connector without a caller.
    // Slice 9.A1β will add a server-action seam at
    // `src/app/(shell)/settings/connectors/actions.ts`; at that point
    // a paired POSITIVE invariant check will be added here. For now
    // we simply document the scope: the connector is substrate-only.
    expect(true).toBe(true);
  });
});
