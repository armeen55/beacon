/**
 * Architecture invariant — Phase A.2 Step 3d (2026-05-18).
 *
 * The lifecycle-eligibility diagnostic is strictly READ-ONLY. The
 * page is intended to give the operator a passive view of the
 * lifecycle funnel; it must NEVER trigger writes, scans, match-runner
 * passes, LLM calls, or paid API calls. This invariant pins that
 * contract at the source-text level for both:
 *
 *   • `src/app/(shell)/diagnostics/lifecycle-eligibility/page.tsx`
 *     (the page itself)
 *   • `src/domains/lifecycle-eligibility/**`
 *     (the supporting pure-function domain)
 *
 * Forbidden across both surfaces (comment-stripped scan):
 *
 *   • Supabase mutation methods on table clients:
 *       `.insert(...)`, `.update(...)`, `.upsert(...)`, `.delete()`
 *       — restricted to scans of the page + domain only, since
 *       repository read paths (`getRepository().forTenant(...)`) are
 *       allowed but downstream mutators are not.
 *   • Match-runner triggers:
 *       `reconcileMatchRun`, `markRecommendedEditsAsShipped`,
 *       `markRecommendedEditAsLive`, `runMatchEngine`.
 *   • LLM / paid-API surfaces:
 *       any `@/lib/connectors/gsc/*` import,
 *       `runProviderAndPersist`, `regenerateProposedText`,
 *       `OpenAI`, `Anthropic`, `Perplexity` SDK constructors.
 *   • Server actions: `"use server"` directive in the page or domain
 *     (the page is a server component but exposes no actions; the
 *     domain is pure compute).
 *
 * Retirement: permanent. The diagnostic stays read-only.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "lifecycle-eligibility",
  "page.tsx",
);
const DOMAIN_DIR = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "lifecycle-eligibility",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function* walk(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      yield full;
    }
  }
}

const FORBIDDEN_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  label: string;
}> = [
  // Supabase mutation methods. We pin the dot-prefixed call shape so
  // a property named `insert` in a type definition doesn't trip the
  // check. We allow `.upsert(` inside no-mutation comments by virtue
  // of comment-stripping.
  { pattern: /\.\s*insert\s*\(/, label: "Supabase .insert() call" },
  { pattern: /\.\s*update\s*\(/, label: "Supabase .update() call" },
  { pattern: /\.\s*upsert\s*\(/, label: "Supabase .upsert() call" },
  { pattern: /\.\s*delete\s*\(/, label: "Supabase .delete() call" },

  // Match-runner triggers.
  {
    pattern: /\breconcileMatchRun\b/,
    label: "reconcileMatchRun (match-runner trigger)",
  },
  {
    pattern: /\bmarkRecommendedEditsAsShipped\b/,
    label: "markRecommendedEditsAsShipped (operator-override write)",
  },
  {
    pattern: /\bmarkRecommendedEditAsLive\b/,
    label: "markRecommendedEditAsLive (match-runner write)",
  },
  {
    pattern: /\brunMatchEngine\b/,
    label: "runMatchEngine (match-runner trigger)",
  },

  // LLM / paid-API surfaces.
  {
    pattern: /from\s+["']@\/lib\/connectors\/gsc(?:\/|["'])/,
    label: "@/lib/connectors/gsc/* import (GSC API call)",
  },
  {
    pattern: /\brunProviderAndPersist\b/,
    label: "runProviderAndPersist (LLM provider call)",
  },
  {
    pattern: /\bregenerateProposedText\b/,
    label: "regenerateProposedText (Phase B regenerate server action)",
  },
  {
    pattern: /\bnew\s+OpenAI\s*\(/,
    label: "new OpenAI(...) (LLM SDK constructor)",
  },
  {
    pattern: /\bnew\s+Anthropic\s*\(/,
    label: "new Anthropic(...) (LLM SDK constructor)",
  },

  // Server-action declarations. The page is a server component; it
  // must not export server-action functions from this surface.
  {
    pattern: /["']use server["']/,
    label: "\"use server\" directive (server action declaration)",
  },
];

describe("Architecture — /diagnostics/lifecycle-eligibility + domain are read-only (Phase A.2 §3d)", () => {
  it("page contains no forbidden mutation / paid-call patterns", () => {
    const src = stripComments(readFileSync(PAGE_PATH, "utf-8"));
    const violations: string[] = [];
    for (const { pattern, label } of FORBIDDEN_PATTERNS) {
      if (pattern.test(src)) {
        violations.push(label);
      }
    }
    expect(
      violations,
      `Page must be read-only. Violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("domain contains no forbidden mutation / paid-call patterns", () => {
    const violations: string[] = [];
    for (const file of walk(DOMAIN_DIR)) {
      const src = stripComments(readFileSync(file, "utf-8"));
      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        if (pattern.test(src)) {
          violations.push(`${relative(REPO_ROOT, file)} — ${label}`);
        }
      }
    }
    expect(
      violations,
      `Domain modules must be pure compute. Violations:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("domain modules carry 'server-only' import (substrate-only)", () => {
    // Every domain file must opt into server-only execution. The
    // helpers are server-only by design; this pin prevents a future
    // refactor from accidentally importing the domain into a
    // customer-facing client component.
    const missing: string[] = [];
    for (const file of walk(DOMAIN_DIR)) {
      const src = readFileSync(file, "utf-8");
      if (!src.includes('import "server-only"')) {
        missing.push(relative(REPO_ROOT, file));
      }
    }
    expect(
      missing,
      `Domain modules must declare \`import "server-only"\`. Missing:\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
