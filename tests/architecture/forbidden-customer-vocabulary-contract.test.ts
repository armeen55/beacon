/**
 * Bundle 3 (2026-05-10) — forbidden customer vocabulary guardrail.
 *
 * Per the maximum-depth UI/product audit (plan file:
 * `~/.claude/plans/i-want-a-maximum-depth-curried-curry.md`), Bundle 3
 * strips operator/internal vocabulary from customer-facing routes so
 * the premium UI does not inherit internal wording. This invariant
 * locks the cleanup in: any future regression that re-introduces
 * forbidden vocabulary into customer-facing rendered copy fails CI.
 *
 * Scope (CUSTOMER-FACING ONLY):
 *   • src/app/(shell)/**\/*.{ts,tsx}
 *   • src/components/**\/*.{ts,tsx}
 *
 * Scope EXCLUSIONS (operator-only / internal-only):
 *   • Anything under src/app/(shell)/diagnostics/** — operator surface
 *   • Test files (*.test.ts, *.test.tsx, **\/__tests__/**)
 *   • JSDoc and line comments (stripped before grep)
 *
 * Each forbidden phrase has:
 *   • A short rationale describing what to use instead.
 *   • An optional `allowedFiles` allowlist for code-identifier-only
 *     usage that would survive comment stripping (e.g., a TypeScript
 *     literal that happens to spell the term).
 *
 * Bundle 3's mapping (the source of truth):
 *   "07:00, 08:30, 10:00 UTC" → "checks 3 times daily" / drop
 *   "Z-score verdict" → "Result" or "Early signal"
 *   "lifecycle" (rendered text) → "status"
 *   "decision queue" → "recommendations"
 *   "native observations" → "AI checks" / "AI readings"
 *   "first_appearance" / etc. (Title Case rendered) → plain English
 *   "evidence tier" → "confidence"
 *   "poll health" / scheduler language → plain freshness language
 *
 * Code-level identifiers (variable names, type names, enum keys,
 * data-* attributes, props, function names) are NOT inspected — only
 * customer-VISIBLE rendered text. The test only fails when forbidden
 * vocabulary appears in source code that survives comment stripping
 * AND is not in the allowlist.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

// ─────────────────────────────────────────────────────────────────────
// File discovery
// ─────────────────────────────────────────────────────────────────────

const SCAN_ROOTS = [
  resolve(REPO_ROOT, "src/app/(shell)"),
  resolve(REPO_ROOT, "src/components"),
];

// Path segments that exempt a file from this guardrail. Operator-only
// surfaces, test files, and any future explicitly-internal route group
// can be added here.
const EXCLUDED_SEGMENTS: ReadonlyArray<string> = [
  // Operator diagnostics live under /diagnostics — internal surface.
  `${sep}diagnostics${sep}`,
  // Test files are scaffolding and may legitimately reference forbidden
  // terms (e.g., to assert their absence in production source).
  `${sep}__tests__${sep}`,
  `.test.ts`,
  `.test.tsx`,
];

function listSourceFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!/\.(ts|tsx)$/.test(name)) continue;
      // Apply exclusions on the FULL path, not just basename, so the
      // diagnostics segment match works for nested files.
      const isExcluded = EXCLUDED_SEGMENTS.some((seg) => full.includes(seg));
      if (isExcluded) continue;
      out.push(full);
    }
  }
  walk(root);
  return out;
}

const ALL_FILES: ReadonlyArray<string> = SCAN_ROOTS.flatMap(listSourceFiles);

// ─────────────────────────────────────────────────────────────────────
// Comment stripping (line + block) — same pattern as the rest of the
// architecture suite (see demo-path-fixes-2026-05-06.test.ts:79).
// ─────────────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  // Strip line comments first (so `// /* foo */` doesn't get mistaken
  // for a real block-comment opener).
  const noLine = src.replace(/^\s*\/\/.*$/gm, "");
  // Block comments (JSDoc + JSX `{/* */}` form).
  const noBlock = noLine.replace(/\/\*[\s\S]*?\*\//g, "");
  // Strip import statements — they reference internal module paths
  // (e.g. `@/lib/persistence/dual-write`, `@/domains/answer-intelligence/...`)
  // that are code identifiers, not customer-visible copy.
  const noImports = noBlock
    .replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*$/gm, "")
    .replace(/^\s*import\s+["'][^"']+["']\s*;?\s*$/gm, "")
    // Multi-line import (with named imports across multiple lines).
    .replace(/^\s*import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["']\s*;?\s*$/gm, "");
  return noImports;
}

// Cache stripped sources so we re-read each file once.
const STRIPPED_BY_PATH = new Map<string, string>();
function getStripped(file: string): string {
  let cached = STRIPPED_BY_PATH.get(file);
  if (cached === undefined) {
    cached = stripComments(readFileSync(file, "utf8"));
    STRIPPED_BY_PATH.set(file, cached);
  }
  return cached;
}

// ─────────────────────────────────────────────────────────────────────
// Forbidden vocabulary table.
//
// Each row pins ONE forbidden phrase that must not appear in rendered
// customer-facing copy. `allowedFiles` lists path-relative-to-repo
// substrings that are allowed to contain the term as code identifier
// (only matters when the term coincidentally matches a TS identifier
// that survives comment stripping). Keep allowlist tight.
// ─────────────────────────────────────────────────────────────────────

type ForbiddenRule = {
  /** Phrase to grep for (case-insensitive). */
  phrase: string;
  /** Why this is forbidden + what to use instead. */
  rationale: string;
  /** Path substrings (forward-slash) where this term may appear as
   *  code identifier and should NOT trigger the test. */
  allowedFiles?: ReadonlyArray<string>;
};

const FORBIDDEN: ReadonlyArray<ForbiddenRule> = [
  // Cron-schedule leakage. Customer copy must never expose UTC times
  // or the word "scheduled poll" — Beacon's daily AI check posture is
  // what matters to the customer, not the firing cadence.
  {
    phrase: "07:00, 08:30",
    rationale: "Cron schedule leak. Use 'daily AI check' / 'checks throughout the morning' instead.",
  },
  {
    phrase: "10:00 UTC",
    rationale: "Cron-time leak. Use 'daily check' instead.",
  },
  {
    phrase: "10:45 UTC",
    rationale: "Backup-canary cron-time leak. Use 'morning' / 'today's check didn't complete' instead.",
  },
  {
    phrase: "scheduled poll",
    rationale: "Operator vocabulary. Use 'daily AI check' / 'AI reading' instead.",
  },
  {
    phrase: "Next poll at",
    rationale: "Cron-schedule leak. Use 'next AI reading' / 'next daily check'.",
  },
  // Z-score family. Statistical jargon — customer never reads about
  // the underlying engine. Use plain confidence labels.
  {
    phrase: "Z-score",
    rationale: "Statistical jargon. Use confidence labels ('high/medium/low confidence') in customer copy. " +
      "Operator-only surfaces (operatorDetail, /diagnostics) may keep raw Z-score.",
    allowedFiles: [
      // verdict-provenance.ts pushes Z-score into operatorDetail (operator-only field by design).
      "src/domains/attribution/verdict-provenance.ts",
    ],
  },
  // Lifecycle. The word "lifecycle" reads as project-management jargon
  // when shown to customers. The underlying type names (lifecycleSummary,
  // LifecycleTabClass, data-lifecycle-*) are code identifiers and stay.
  // The forbidden form is the rendered word ("Lifecycle" as a heading,
  // "Recommendation lifecycle" in aria-label, etc.).
  {
    phrase: "Recommendation lifecycle",
    rationale: "Operator vocabulary in rendered text. Use 'Recommendation status'.",
  },
  // Decision queue / decision matrix. Old naming for what is now
  // "Recommendations".
  {
    phrase: "decision queue",
    rationale: "Old internal name for /recommendations. Use 'recommendations'.",
  },
  {
    phrase: "decision matrix",
    rationale: "Internal compute layer. Use 'recommendations' in customer copy.",
    allowedFiles: [
      // The decision-matrix module name is the internal subsystem name;
      // any imports/types referencing it survive comment stripping.
      "src/domains/prompts/decision-matrix",
    ],
  },
  // Pattern brain / answer intelligence — internal subsystem names that
  // leaked into rendered copy in earlier passes. Code identifiers may
  // survive comment stripping (imports, type names, etc.).
  {
    phrase: "pattern brain",
    rationale: "Internal subsystem name. Use 'Beacon' or describe what it does in plain English.",
  },
  {
    phrase: "answer-intelligence",
    rationale: "Internal subsystem name. Should not appear in customer-facing rendered text.",
    allowedFiles: [
      // Module name; imports survive comment stripping in some files.
      "src/domains/answer-intelligence",
    ],
  },
  // Native observations vocabulary.
  {
    phrase: "native observations",
    rationale: "Operator vocabulary. Use 'AI readings' or 'AI checks'.",
  },
  {
    phrase: "native observation",
    rationale: "Operator vocabulary (singular form). Use 'AI reading' or 'AI check'.",
  },
  // Lambda / cold start / dual-write. Infrastructure jargon.
  {
    phrase: "Lambda cold",
    rationale: "Infrastructure jargon. Should never appear in customer copy.",
  },
  {
    phrase: "dual-write",
    rationale: "Infrastructure jargon. Should never appear in customer copy.",
  },
  // Evidence tier rendered as a customer-facing label.
  {
    phrase: "evidence tier",
    rationale: "Internal classifier label. Use 'confidence' in customer copy.",
  },
  // Title-Case raw event-type ENUMs surfaced as labels in /changes/[id].
  // The underlying enum keys (first_appearance, visibility_regained,
  // etc.) stay as data; only the human-readable labels needed cleanup.
  {
    phrase: "First Appearance",
    rationale: "Raw enum label. Use 'First time cited' or similar plain English.",
  },
  {
    phrase: "Visibility Regained",
    rationale: "Raw enum label. Use 'Came back in the rankings' or similar.",
  },
  {
    phrase: "Mention Surge",
    rationale: "Raw enum label. Use 'Mentions jumped' or similar.",
  },
  {
    phrase: "Visibility Lost",
    rationale: "Raw enum label. Use 'Dropped from the rankings' or similar.",
  },
  {
    phrase: "Mention Decline",
    rationale: "Raw enum label. Use 'Mentions slowed down' or similar.",
  },
  // Loading copy that named the internal queue.
  {
    phrase: "Loading the decision queue",
    rationale: "Operator vocabulary. Use 'Loading recommendations'.",
  },
];

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function findHits(rule: ForbiddenRule): Array<{ file: string; line: number; excerpt: string }> {
  const needle = rule.phrase.toLowerCase();
  const hits: Array<{ file: string; line: number; excerpt: string }> = [];
  for (const file of ALL_FILES) {
    if (rule.allowedFiles?.some((p) => file.includes(p.replace(/\//g, sep)))) {
      continue;
    }
    const stripped = getStripped(file);
    const lines = stripped.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.toLowerCase().includes(needle)) {
        hits.push({
          file: file.replace(REPO_ROOT + sep, ""),
          line: i + 1,
          excerpt: line.trim().slice(0, 200),
        });
      }
    }
  }
  return hits;
}

function formatHits(hits: ReadonlyArray<{ file: string; line: number; excerpt: string }>): string {
  return hits
    .map((h) => `  • ${h.file}:${h.line}\n      ${h.excerpt}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe("Bundle 3 — forbidden customer vocabulary guardrail", () => {
  it("scans a non-trivial number of customer-facing files", () => {
    // Sanity check: if the file walker silently misses every file the
    // guardrail becomes a no-op. Pin a generous floor that survives
    // future restructuring.
    expect(ALL_FILES.length).toBeGreaterThan(40);
  });

  for (const rule of FORBIDDEN) {
    it(`rejects '${rule.phrase}' in customer-facing rendered copy`, () => {
      const hits = findHits(rule);
      const message = hits.length
        ? `Bundle 3 — '${rule.phrase}' must not appear in customer-facing source.\n` +
          `Reason: ${rule.rationale}\n\n` +
          `Found in:\n${formatHits(hits)}\n\n` +
          `Fix: replace the rendered phrase, OR (if it is a legitimate code identifier ` +
          `that survives comment stripping) add the file path to that rule's allowedFiles ` +
          `list in tests/architecture/forbidden-customer-vocabulary-contract.test.ts.`
        : "";
      expect(hits, message).toEqual([]);
    });
  }
});
