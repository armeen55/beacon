/**
 * Recommendation Execution Layer v1 Phase A (2026-05-13) —
 * architecture invariants for the Suggested Copy act.
 *
 * Pins:
 *   1. No paid call on page load — the act component + the detail
 *      client do not import any LLM provider, the orchestrator entry
 *      point, or any persistence write helper. No naked `fetch(` calls.
 *      No OPENAI_API_KEY mention.
 *   2. Row-fields-only access — the act + adapter touch only the
 *      documented `row.` fields and nothing else.
 *   3. Forbidden vocabulary — new files do not contain any of the
 *      operator-locked forbidden phrases (covers Round 1 + 2 +
 *      Bundle 3 vocabulary, restated here for defense in depth).
 *   4. Display guard is sourced by the adapter, not duplicated in
 *      the component.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const ACT_PATH = resolve(
  REPO_ROOT,
  "src/app/(shell)/recommendations/[id]/suggested-copy-act.tsx",
);
const ADAPTER_PATH = resolve(
  REPO_ROOT,
  "src/domains/recommendations/suggested-copy-adapters.ts",
);
const GUARD_PATH = resolve(
  REPO_ROOT,
  "src/domains/recommendations/suggested-copy-display-guard.ts",
);
const DETAIL_CLIENT_PATH = resolve(
  REPO_ROOT,
  "src/app/(shell)/recommendations/[id]/recommendation-detail-client.tsx",
);

function read(p: string): string {
  return readFileSync(p, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ACT_SRC = stripComments(read(ACT_PATH));
const ADAPTER_SRC = stripComments(read(ADAPTER_PATH));
const GUARD_SRC = stripComments(read(GUARD_PATH));
const DETAIL_CLIENT_SRC = stripComments(read(DETAIL_CLIENT_PATH));

// ─────────────────────────────────────────────────────────────────────
// 1. No paid call on page load
// ─────────────────────────────────────────────────────────────────────

describe("Suggested Copy — no paid call on page load", () => {
  const ALL_RUNTIME_FILES: ReadonlyArray<{ name: string; src: string }> = [
    { name: "suggested-copy-act.tsx", src: ACT_SRC },
    { name: "suggested-copy-adapters.ts", src: ADAPTER_SRC },
    { name: "suggested-copy-display-guard.ts", src: GUARD_SRC },
  ];

  // The detail client may legitimately call (transitively) into things
  // that have nothing to do with LLMs — it already accepts/defers/
  // dismisses via server actions. We ONLY pin its absence of NEW
  // imports introduced by Phase A.
  it.each(ALL_RUNTIME_FILES)(
    "$name does not import from any LLM provider module",
    ({ src }) => {
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/providers/,
      );
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/providers\/openai['"]/,
      );
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/providers\/anthropic['"]/,
      );
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/specific-edit-provider['"]/,
      );
    },
  );

  it.each(ALL_RUNTIME_FILES)(
    "$name does not import the runProviderAndPersist orchestrator",
    ({ src }) => {
      expect(src).not.toMatch(/runProviderAndPersist/);
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/recommended-edits-persistence['"]/,
      );
    },
  );

  it.each(ALL_RUNTIME_FILES)(
    "$name does not call adjudicator or cost-ledger budget helpers",
    ({ src }) => {
      expect(src).not.toMatch(
        /from\s+['"]@\/domains\/recommendations\/adjudicator-budget['"]/,
      );
      expect(src).not.toMatch(/from\s+['"]@\/lib\/cost\//);
      expect(src).not.toMatch(/\bcheckBudget\s*\(/);
      expect(src).not.toMatch(/\brecordSpend\s*\(/);
      expect(src).not.toMatch(/\bcheckTenantBudget\s*\(/);
      expect(src).not.toMatch(/\bcheckMonthlyBudget\s*\(/);
      expect(src).not.toMatch(/\bcheckPerRunBudget\s*\(/);
    },
  );

  it.each(ALL_RUNTIME_FILES)(
    "$name has no naked fetch(...) call",
    ({ src }) => {
      // Allow `fetchImpl` as a parameter name (still — not present in
      // these files, but explicitly guard against bare `fetch(`).
      expect(src).not.toMatch(/\bfetch\s*\(/);
    },
  );

  it.each(ALL_RUNTIME_FILES)(
    "$name does not reference OPENAI_API_KEY or any provider env",
    ({ src }) => {
      expect(src).not.toMatch(/OPENAI_API_KEY/);
      expect(src).not.toMatch(/ANTHROPIC_API_KEY/);
      expect(src).not.toMatch(/PERPLEXITY_API_KEY/);
      expect(src).not.toMatch(/BEACON_LLM_PROVIDER/);
    },
  );

  it("the detail client does not import any of the Phase B / regen surfaces", () => {
    // Phase A is render-only — the detail client must NOT import
    // anything from a regen action or budget helper.
    expect(DETAIL_CLIENT_SRC).not.toMatch(
      /from\s+['"]@\/domains\/recommendations\/providers/,
    );
    expect(DETAIL_CLIENT_SRC).not.toMatch(/runProviderAndPersist/);
    expect(DETAIL_CLIENT_SRC).not.toMatch(/regenerateRecommendationCopy/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Row-fields-only access
// ─────────────────────────────────────────────────────────────────────

describe("Suggested Copy — row-fields-only access", () => {
  const ALLOWED_ROW_TOP_LEVEL = new Set<string>([
    // Approved fields the act + adapter may read.
    "title",
    "targetUrl",
    "targetLabel",
    "actionType",
    "evidenceSummary",
    "sourceRecommendationId",
    "id",
    "detail",
  ]);

  const ALLOWED_DETAIL_FIELDS = new Set<string>([
    "proposedText",
    "currentText",
    "faqAnswerText",
    "why",
  ]);

  function collectRowAccesses(src: string): string[] {
    const out: string[] = [];
    const re = /\brow\.(\w+)(?:\.(\w+))?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      out.push(m[2] ? `row.${m[1]}.${m[2]}` : `row.${m[1]}`);
    }
    return out;
  }

  it("suggested-copy-act.tsx accesses only documented row fields", () => {
    const accesses = collectRowAccesses(ACT_SRC);
    const violations: string[] = [];
    for (const access of accesses) {
      const [, top, second] = access.split(".");
      if (!ALLOWED_ROW_TOP_LEVEL.has(top)) {
        violations.push(access);
        continue;
      }
      if (top === "detail" && second && !ALLOWED_DETAIL_FIELDS.has(second)) {
        violations.push(access);
      }
    }
    expect(
      violations,
      `disallowed row.* accesses in suggested-copy-act.tsx: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("suggested-copy-adapters.ts accesses only documented row fields", () => {
    const accesses = collectRowAccesses(ADAPTER_SRC);
    const violations: string[] = [];
    for (const access of accesses) {
      const [, top, second] = access.split(".");
      if (!ALLOWED_ROW_TOP_LEVEL.has(top)) {
        violations.push(access);
        continue;
      }
      if (top === "detail" && second && !ALLOWED_DETAIL_FIELDS.has(second)) {
        violations.push(access);
      }
    }
    expect(
      violations,
      `disallowed row.* accesses in suggested-copy-adapters.ts: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Forbidden vocabulary
// ─────────────────────────────────────────────────────────────────────

describe("Suggested Copy — forbidden vocabulary", () => {
  // Operator-locked phrases from the Round 1 + Round 2 + Bundle 3
  // contracts that must not appear in any new file's rendered text.
  // The shell-wide scanner at
  // tests/architecture/forbidden-customer-vocabulary-contract.test.ts
  // ALSO covers these — this is defense-in-depth scoped to the new
  // files so a regression is caught with a precise file callout.
  const FORBIDDEN: ReadonlyArray<string> = [
    // Round 1
    "Stamps live_at = now",
    "Pre-pivot CSV / PDF rebuild",
    "Supabase schema",
    "dual-write logs",
    "GitHub Actions logs",
    "proof run (small sample)",
    "proof-sized sample",
    // Bundle 3 — customer vocabulary
    "Z-score",
    "decision queue",
    "decision matrix",
    "pattern brain",
    "native observations",
    "native observation",
    "evidence tier",
    "Lambda cold",
    "scheduled poll",
    "Next poll at",
  ];

  // The display-guard module CAN reference these phrases as internal
  // tokens in its blocklist — that's the whole point. Scope this check
  // to the act + adapter only.
  const SCANNED: ReadonlyArray<{ name: string; src: string }> = [
    { name: "suggested-copy-act.tsx", src: ACT_SRC },
    { name: "suggested-copy-adapters.ts", src: ADAPTER_SRC },
  ];

  for (const phrase of FORBIDDEN) {
    it.each(SCANNED)(`'${phrase}' is absent from $name`, ({ src }) => {
      expect(src).not.toContain(phrase);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// 4. Display guard usage
// ─────────────────────────────────────────────────────────────────────

describe("Suggested Copy — display guard wiring", () => {
  it("the adapter imports checkCopyDisplaySafe from the display guard module", () => {
    expect(ADAPTER_SRC).toMatch(
      /from\s+['"]\.\/suggested-copy-display-guard['"]/,
    );
    expect(ADAPTER_SRC).toMatch(/\bcheckCopyDisplaySafe\b/);
  });

  it("the act component does NOT duplicate the display guard — it routes through buildCopyTile", () => {
    expect(ACT_SRC).toMatch(/\bbuildCopyTile\s*\(/);
    expect(ACT_SRC).not.toMatch(/\bcheckCopyDisplaySafe\s*\(/);
  });

  it("the fallback message text is rendered verbatim in the act component", () => {
    expect(ACT_SRC).toContain(
      "Beacon has a draft for this recommendation, but it needs review before showing here.",
    );
  });

  it("the 'Review before publishing' disclaimer text is hard-coded in the act", () => {
    expect(ACT_SRC).toContain("Review before publishing");
  });
});
