/**
 * Demo-path Phase 3-bis fixes — 2026-05-06 war-room day, second bundle.
 *
 * Pins the 8 customer-facing fixes shipped after the first
 * `demo-path-fixes-2026-05-06.test.ts` invariant landed:
 *
 *   1. /recommendations filter dropdown values use clean public keys
 *      (no raw schema enums like `add_internal_links` /
 *      `regenerate_edit` / `review_decision` / `add_comparison_table`
 *      in <option value="..."> attributes).
 *   2. ACTION_ROW_STATUS_LABEL `needs_fresh_edit` renamed
 *      "Needs new recommendation" (was "Needs fresh edit").
 *   3. /changes header rewritten: "Every edit you've shipped to your
 *      site, with AI impact tracked over time." (no "Verified and
 *      tracked changes Beacon has confirmed live, plus everything
 *      pending or imported." schema-leaky description).
 *   4. /changes scorecard data-attribution-branch +
 *      data-stale-pending-state are now gated behind
 *      OPERATOR_MODE_DEBUG (NEXT_PUBLIC_OPERATOR_MODE / NODE_ENV=test).
 *   5. /settings/import advanced-disclosure block (Run batch import,
 *      manual paste, "Internal tooling — drop CSV exports on the
 *      server filesystem", merge-semantics jargon) gated behind
 *      OPERATOR_MODE.
 *   6. friendlyImportSource maps "profound" → "Historical CSV" so the
 *      import history table doesn't render a vendor name.
 *   7. /prompts/[id] surfaces an ActionBridge linking to
 *      /recommendations OR a "No action queued yet — Beacon will keep
 *      watching this prompt" reassurance for "early" prompts.
 *   8. /today PollHealthBlock no longer renders when every platform is
 *      OK; partial/failed/pending still surface (so real failures stay
 *      visible).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const RECS_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/recommendations/recommendations-client.tsx"),
  "utf8",
);
const ACTION_ROWS = readFileSync(
  resolve(REPO_ROOT, "src/domains/recommendations/recommendation-action-rows.ts"),
  "utf8",
);
const CHANGES_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/page.tsx"),
  "utf8",
);
const SCORECARD_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/changes/scorecard-client.tsx"),
  "utf8",
);
const IMPORT_PAGE = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/settings/import/import-page.tsx"),
  "utf8",
);
const PROMPTS_DETAIL = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/prompts/[id]/page.tsx"),
  "utf8",
);
const TODAY_CLIENT = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/today-client.tsx"),
  "utf8",
);

function stripComments(src: string): string {
  // Line comments first, then block comments — preserves the same
  // ordering as canonical-store-tenant-isolation.test.ts so a `//`
  // line containing literal `/*` never trips the block-comment regex.
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

// ── Fix 1: filter values are clean keys, not raw schema enums ────────

describe("Phase 3-bis fix 1 (2026-05-06) — /recommendations filter values are clean keys", () => {
  it("TYPE_FILTER_OPTIONS uses public keys (page/title/meta/...) and a TYPE_VALUE_TO_ENUM map", () => {
    expect(RECS_CLIENT).toMatch(/value:\s*"page"[\s\S]{0,40}enum:\s*"create_page"/);
    expect(RECS_CLIENT).toMatch(/value:\s*"links"[\s\S]{0,40}enum:\s*"add_internal_links"/);
    expect(RECS_CLIENT).toMatch(/value:\s*"table"[\s\S]{0,40}enum:\s*"add_comparison_table"/);
    expect(RECS_CLIENT).toMatch(/value:\s*"regenerate"[\s\S]{0,40}enum:\s*"regenerate_edit"/);
    expect(RECS_CLIENT).toMatch(/value:\s*"review"[\s\S]{0,40}enum:\s*"review_decision"/);
    expect(RECS_CLIENT).toMatch(/TYPE_VALUE_TO_ENUM/);
  });

  it("STATUS_FILTER_OPTIONS uses public keys and STATUS_VALUE_TO_ENUM map", () => {
    expect(RECS_CLIENT).toMatch(/value:\s*"review"[\s\S]{0,40}enum:\s*"needs_review"/);
    expect(RECS_CLIENT).toMatch(/value:\s*"regenerate"[\s\S]{0,40}enum:\s*"needs_fresh_edit"/);
    expect(RECS_CLIENT).toMatch(/STATUS_VALUE_TO_ENUM/);
  });

  it("filter <option> declarations no longer use raw schema enums as `value`", () => {
    const stripped = stripComments(RECS_CLIENT);
    // Negative invariant: the historical raw-enum filter values must
    // be gone from the public option-value attribute.
    expect(stripped).not.toMatch(/value:\s*"add_internal_links"/);
    expect(stripped).not.toMatch(/value:\s*"add_comparison_table"/);
    expect(stripped).not.toMatch(/value:\s*"regenerate_edit"/);
    expect(stripped).not.toMatch(/value:\s*"review_decision"/);
    expect(stripped).not.toMatch(/value:\s*"create_page"/);
    expect(stripped).not.toMatch(/value:\s*"edit_title"/);
    expect(stripped).not.toMatch(/value:\s*"edit_meta"/);
    expect(stripped).not.toMatch(/value:\s*"add_section"/);
    expect(stripped).not.toMatch(/value:\s*"improve_copy"/);
    expect(stripped).not.toMatch(/value:\s*"add_faq"/);
    expect(stripped).not.toMatch(/value:\s*"add_schema"/);
    expect(stripped).not.toMatch(/value:\s*"technical_fix"/);
    // Status filter: `needs_review` and `needs_fresh_edit` were the
    // raw-enum option values; replaced with `review` / `regenerate`.
    expect(stripped).not.toMatch(/value:\s*"needs_review"/);
    expect(stripped).not.toMatch(/value:\s*"needs_fresh_edit"/);
  });
});

// ── Fix 2: needs_fresh_edit label rename ─────────────────────────────

describe("Phase 3-bis fix 2 (2026-05-06) — needs_fresh_edit label rename", () => {
  it("ACTION_ROW_STATUS_LABEL needs_fresh_edit reads 'Needs new recommendation'", () => {
    expect(ACTION_ROWS).toMatch(
      /needs_fresh_edit:\s*"Needs new recommendation"/,
    );
    expect(ACTION_ROWS).not.toMatch(/needs_fresh_edit:\s*"Needs fresh edit"/);
  });

  it("STATUS_FILTER_OPTIONS dropdown label is 'Needs new recommendation', not 'Needs fresh edit'", () => {
    const stripped = stripComments(RECS_CLIENT);
    expect(stripped).toMatch(/label:\s*"Needs new recommendation"/);
    expect(stripped).not.toMatch(/label:\s*"Needs fresh edit"/);
  });
});

// ── Fix 3: /changes header copy ──────────────────────────────────────

describe("Phase 3-bis fix 3 (2026-05-06) — /changes header clarity", () => {
  it("/changes page renders 'Every edit you've shipped to your site, with AI impact tracked over time.'", () => {
    expect(CHANGES_PAGE).toMatch(
      /Every edit you've shipped to your site, with AI impact tracked over time/,
    );
    expect(CHANGES_PAGE).not.toMatch(
      /Verified and tracked changes Beacon has confirmed live, plus everything pending or imported/,
    );
  });
});

// ── Fix 4: scorecard DOM data-attr leaks gated ───────────────────────

describe("Phase 3-bis fix 4 (2026-05-06) — DOM data-attribute gating", () => {
  it("scorecard-client.tsx declares OPERATOR_MODE_DEBUG via isOperatorModeClient() helper", () => {
    expect(SCORECARD_CLIENT).toMatch(
      /const OPERATOR_MODE_DEBUG[\s\S]{0,80}isOperatorModeClient\(\)/,
    );
    expect(SCORECARD_CLIENT).not.toMatch(
      /const OPERATOR_MODE_DEBUG[\s\S]{0,80}process\.env\.NEXT_PUBLIC_OPERATOR_MODE/,
    );
  });

  it("data-attribution-branch is conditionally included via OPERATOR_MODE_DEBUG", () => {
    expect(SCORECARD_CLIENT).toMatch(
      /OPERATOR_MODE_DEBUG[\s\S]{0,200}"data-attribution-branch"/,
    );
  });

  it("data-stale-pending-state is conditionally included via OPERATOR_MODE_DEBUG", () => {
    expect(SCORECARD_CLIENT).toMatch(
      /OPERATOR_MODE_DEBUG[\s\S]{0,200}"data-stale-pending-state"/,
    );
  });

  it("unconditional `data-attribution-branch={copy.branch}` is gone", () => {
    const stripped = stripComments(SCORECARD_CLIENT);
    expect(stripped).not.toMatch(/data-attribution-branch=\{copy\.branch\}/);
    expect(stripped).not.toMatch(/data-stale-pending-state=\{[\s\S]{0,80}lifecycleStatus\s*\?\?\s*null/);
  });
});

// ── Fix 5: /settings/import advanced gate ────────────────────────────

describe("Phase 3-bis fix 5 (2026-05-06) — /settings/import advanced gate", () => {
  it("import-page.tsx declares OPERATOR_MODE via isOperatorModeClient() helper", () => {
    expect(IMPORT_PAGE).toMatch(
      /const OPERATOR_MODE[\s\S]{0,80}isOperatorModeClient\(\)/,
    );
    expect(IMPORT_PAGE).not.toMatch(
      /const OPERATOR_MODE[\s\S]{0,80}process\.env\.NEXT_PUBLIC_OPERATOR_MODE/,
    );
  });

  it("Advanced disclosure (Run batch import, internal copy) is wrapped in OPERATOR_MODE check", () => {
    // The `{OPERATOR_MODE && (` literal precedes the "Advanced —
    // legacy import paths" button copy in the file. Match the
    // structural shape: gate present + button label present (not
    // both inside one regex; the `{0,400}` window was too tight).
    expect(IMPORT_PAGE).toMatch(/\{OPERATOR_MODE\s*&&\s*\(/);
    expect(IMPORT_PAGE).toMatch(/Advanced — legacy import paths/);
    expect(IMPORT_PAGE).toMatch(
      /\{OPERATOR_MODE\s*&&\s*advancedOpen\s*&&/,
    );
  });
});

// ── Fix 6: friendlyImportSource map ──────────────────────────────────

describe("Phase 3-bis fix 6 (2026-05-06) — friendlyImportSource maps 'profound' → 'Historical CSV'", () => {
  it("friendlyImportSource maps 'profound' to 'Historical CSV'", () => {
    expect(IMPORT_PAGE).toMatch(
      /raw === "profound"\s*\)\s*return\s*"Historical CSV"/,
    );
  });
});

// ── Fix 7: /prompts ActionBridge ─────────────────────────────────────

describe("Phase 3-bis fix 7 (2026-05-06) — /prompts/[id] action bridge", () => {
  it("ActionBridge component is declared with category branching", () => {
    expect(PROMPTS_DETAIL).toMatch(/function ActionBridge\(/);
    expect(PROMPTS_DETAIL).toMatch(/category === "early"/);
  });

  it("'No action queued yet' fallback exists for early-category prompts", () => {
    expect(PROMPTS_DETAIL).toMatch(
      /No action queued yet — Beacon will keep watching this prompt/,
    );
  });

  it("'See related recommendations →' link exists for actionable categories", () => {
    expect(PROMPTS_DETAIL).toMatch(/See related recommendations →/);
    expect(PROMPTS_DETAIL).toMatch(
      /href="\/recommendations"[\s\S]{0,200}data-prompt-action-bridge="recommendations"/,
    );
  });

  it("ActionBridge is mounted in the page render", () => {
    expect(PROMPTS_DETAIL).toMatch(
      /<ActionBridge category=\{drilldown\.classification\.category\} \/>/,
    );
  });
});

// ── Fix 8: PollHealthBlock when OK ───────────────────────────────────

describe("Phase 3-bis fix 8 (2026-05-06) — /today PollHealthBlock suppressed when OK", () => {
  it("PollHealthBlock mount is gated on at least one platform.status !== 'ok'", () => {
    // Pre-fix: `{pollHealth && <PollHealthBlock snapshot={pollHealth} />}`
    // Post-fix: gated on `pollHealth.platforms.some((p) => p.status !== "ok")`.
    expect(TODAY_CLIENT).toMatch(
      /pollHealth\s*&&\s*[\s\S]{0,200}pollHealth\.platforms\.some\(\(p\)\s*=>\s*p\.status\s*!==\s*"ok"\)/,
    );
  });
});
