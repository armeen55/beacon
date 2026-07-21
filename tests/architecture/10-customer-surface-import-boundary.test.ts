/**
 * Architecture invariant — customer-surface module boundary (consolidated).
 *
 * ONE parameterized guard for the "customer-facing surfaces must not
 * reference operator-substrate module X" class. Each row below was
 * previously its own per-surface test file; the walk + comment-strip
 * boilerplate was identical across all of them, so they are collapsed
 * into a single table of (label, forbidden patterns, scan roots, reason).
 * Every forbidden pattern / token is preserved verbatim from the
 * originals — deleting a row is retiring an invariant, not a refactor.
 *
 * Subsumes (deleted 2026-07-20 architecture-suite diet):
 *   • gsc-no-customer-surface-import          (A.3.b1.beta, 2026-05-17)
 *   • ga4-no-page-load-call                   (Slice 9.A1β, 2026-05-18)
 *   • outcome-attribution-refresh-no-customer-surface (Slice 9.A2γ, 2026-05-19)
 *   • repeat-citation-no-customer-surface     (Section 5.A, 2026-05-16)
 *   • lifecycle-eligibility-no-customer-surface-import (Phase A.2 §3d, 2026-05-18)
 *   • off-site-profile-urls-no-customer-surface (Section 7 C7g v1, 2026-05-16)
 *   • off-site-authority-customer-surface-isolation (Section 7 C7a, 2026-05-16)
 *
 * The customer-facing surface tree (default scan roots):
 *   src/app/(shell)/{today,recommendations,changes,prompts,local,competitors}/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const STANDARD_ROOTS = [
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
] as const;

// off-site-profile-urls (C7g v1) scanned the same tree WITHOUT the
// competitors surface; preserved exactly.
const ROOTS_NO_COMPETITORS = STANDARD_ROOTS.filter(
  (r) => r !== "src/app/(shell)/competitors",
);

// lifecycle-eligibility (§3d) additionally scanned the settings subtree
// because its operator vocabulary must not leak onto settings either.
const ROOTS_WITH_SETTINGS = [...STANDARD_ROOTS, "src/app/(shell)/settings"];

/** Strip block + line comments, preserving `://` in URLs. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(rootRel: string): string[] {
  const abs = resolve(REPO_ROOT, rootRel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const childAbs = join(abs, name);
    const st = statSync(childAbs);
    if (st.isDirectory()) {
      out.push(...walk(`${rootRel}/${name}`));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(`${rootRel}/${name}`);
    }
  }
  return out;
}

type ForbiddenRow = {
  label: string;
  reason: string;
  roots: ReadonlyArray<string>;
  // RegExp patterns (import forms) OR plain-string tokens (identifiers).
  patterns?: ReadonlyArray<{ re: RegExp; label: string }>;
  tokens?: ReadonlyArray<string>;
};

const FORBIDDEN_ROWS: ReadonlyArray<ForbiddenRow> = [
  {
    label: "GSC client / signal adapter (A.3.b1.beta)",
    reason:
      "GSC is operator-substrate only; the indexability loader's enableGsc " +
      "opt-in (default off) is the structural gate. Customer surfaces must " +
      "not import @/lib/connectors/gsc/* or @/domains/indexability/load-gsc-signal.",
    roots: STANDARD_ROOTS,
    patterns: [
      {
        re: /from\s+["']@\/lib\/connectors\/gsc(?:\/|["'])/,
        label: "@/lib/connectors/gsc/* import",
      },
      {
        re: /from\s+["']@\/domains\/indexability\/load-gsc-signal["']/,
        label: "@/domains/indexability/load-gsc-signal import",
      },
      { re: /\bgscUrlInspect\b/, label: "gscUrlInspect identifier" },
      { re: /\bloadGscSignal\b/, label: "loadGscSignal identifier" },
    ],
  },
  {
    label: "GA4 connector (Slice 9.A1β)",
    reason:
      "GA4 calls happen only via server actions, never on a customer render " +
      "path. The connector is operator-substrate; the settings actions seam " +
      "is the only allowed importer (positive check below).",
    roots: STANDARD_ROOTS,
    patterns: [
      { re: /from\s+["']@\/lib\/connectors\/ga4\//, label: "@/lib/connectors/ga4/* import" },
      { re: /from\s+["']@\/lib\/connectors\/ga4["']/, label: "@/lib/connectors/ga4 import" },
      { re: /\bga4ApiFetch\b/, label: "ga4ApiFetch identifier" },
      { re: /\blistGa4PropertiesForTenant\b/, label: "listGa4PropertiesForTenant identifier" },
    ],
  },
  {
    label: "outcome-attribution GA4 traffic refresh (Slice 9.A2γ)",
    reason:
      "The refresh action + persist helper are operator-substrate only; a " +
      "named check on the exports so a re-export can't bypass the directory scan.",
    roots: STANDARD_ROOTS,
    patterns: [
      {
        re: /from\s+["']@\/lib\/connectors\/ga4\/persist-url-traffic["']/,
        label: "persist-url-traffic import",
      },
      { re: /refreshTenantGa4Traffic/, label: "refreshTenantGa4Traffic identifier" },
      { re: /\bpersistGa4UrlTraffic\b/, label: "persistGa4UrlTraffic identifier" },
      { re: /\bcomputeRefreshDateRange\b/, label: "computeRefreshDateRange identifier" },
    ],
  },
  {
    label: "repeat-citation symbols (Section 5.A)",
    reason:
      "Repeat-citation symbols are operator-substrate; the Section 5.B " +
      "allowlist is currently empty (both formerly-allowlisted files deleted " +
      "as dead code). Adding a customer-facing repeat-citation surface means " +
      "restoring the allowlist here AND its catalog note.",
    roots: STANDARD_ROOTS,
    tokens: [
      "repeat-citation",
      "repeatCitation",
      "RepeatCitation",
      "loadRepeatCitationForEdit",
      "computeRepeatCitation",
    ],
  },
  {
    label: "lifecycle-eligibility operator vocabulary (Phase A.2 §3d)",
    reason:
      "@/domains/lifecycle-eligibility/** exposes snake_case operator tokens " +
      "that would leak as raw text. Customer + settings surfaces consume " +
      "@/domains/citation-lifecycle/render-copy instead.",
    roots: ROOTS_WITH_SETTINGS,
    patterns: [
      {
        re: /from\s+["']@\/domains\/lifecycle-eligibility(?:\/[^"']*)?["']/,
        label: "@/domains/lifecycle-eligibility import",
      },
    ],
  },
  {
    label: "off-site operator profile URLs (Section 7 C7g v1)",
    reason:
      "Operator-entered off-site profile URL fields are an operator-side " +
      "signal only; customer-facing off-site surfaces stay blocked by the " +
      "off-site-authority-multi-tenant-prerequisite catalog row.",
    roots: ROOTS_NO_COMPETITORS,
    tokens: [
      "houzzProfileUrl",
      "angiProfileUrl",
      "bbbProfileUrl",
      "industryDirectoryProfileUrl",
    ],
  },
];

describe("customer-surface import boundary (consolidated)", () => {
  for (const row of FORBIDDEN_ROWS) {
    it(`customer surfaces do not reference: ${row.label}`, () => {
      const violations: string[] = [];
      for (const root of row.roots) {
        for (const rel of walk(root)) {
          const active = stripComments(
            readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
          );
          for (const { re, label } of row.patterns ?? []) {
            if (re.test(active)) violations.push(`${rel} — ${label}`);
          }
          for (const token of row.tokens ?? []) {
            if (active.includes(token)) violations.push(`${rel} — '${token}'`);
          }
        }
      }
      expect(
        violations,
        `Customer surfaces must not reference ${row.label}. ${row.reason}\n` +
          `Violations:\n${violations.join("\n")}`,
      ).toEqual([]);
    });
  }

  // Positive seam (Slice 9.A1β): the settings server-actions file IS the
  // only allowed GA4 importer. Pin it so a refactor can't silently drop
  // the import and dead-code the connector.
  it("settings connectors actions.ts imports the GA4 connector (positive seam)", () => {
    const code = readFileSync(
      resolve(REPO_ROOT, "src/app/(shell)/settings/connectors/actions.ts"),
      "utf-8",
    );
    expect(
      code.includes("@/lib/connectors/ga4/"),
      "actions.ts must import from @/lib/connectors/ga4/ — the only allowed " +
        "server-action seam for the GA4 property picker.",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inverse boundary — Section 7 C7a (2026-05-16): the operator-only off-site
// authority modules must NOT import FROM any customer-facing surface. Defense
// in depth against a drive-by "show on Today" component import.
// ---------------------------------------------------------------------------
const C7A_FILES = [
  "src/domains/off-site-authority/types.ts",
  "src/domains/off-site-authority/compute-snapshot.ts",
  "src/domains/off-site-authority/load-snapshot.ts",
] as const;

const C7A_FORBIDDEN_PREFIXES = [
  "@/app/(shell)/today",
  "@/app/(shell)/recommendations",
  "@/app/(shell)/changes",
  "@/app/(shell)/prompts",
  "@/app/(shell)/local",
  "../../today",
  "../../recommendations",
  "../../changes",
  "../../prompts",
  "../../local",
] as const;

describe("off-site-authority — no customer-surface imports (Section 7 C7a)", () => {
  for (const rel of C7A_FILES) {
    it(`${rel}: imports no customer-surface path`, () => {
      const active = stripComments(
        readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
      );
      const hits: string[] = [];
      for (const prefix of C7A_FORBIDDEN_PREFIXES) {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`from\\s+["']${escaped}(?:["']|\\/)`);
        if (re.test(active)) hits.push(prefix);
      }
      expect(
        hits,
        `${relative(REPO_ROOT, resolve(REPO_ROOT, rel))} imports a customer ` +
          `surface (${hits.join(", ")}); C7a is operator-only.`,
      ).toEqual([]);
    });
  }
});
