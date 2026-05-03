/**
 * W3 Step 3.5 (2026-05-02) — recommendations-client UI invariants.
 *
 * Source-scan tests that lock the operator-facing render contracts
 * established in Step 3.5 against silent regression. Each test reads
 * the client source verbatim and pins a specific JSX pattern. A
 * reorder is fine; a removal isn't.
 *
 * Operator scope (Step 3.5):
 *   - Confidence pill rendered on every rec card
 *   - HIGH copy never implies auto-apply
 *   - No raw enum tokens as operator-visible badges (action_type,
 *     edit.source, edit.confidence)
 *   - Empty-state when all specific edits are filtered/quarantined
 *   - Existing actions (Accept / Defer / Dismiss / Mark shipped /
 *     Undo) still wired
 *   - No Apply-All-HIGH bar
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "app",
  "(shell)",
  "recommendations",
  "recommendations-client.tsx",
);
const CLIENT_SRC = fs.readFileSync(CLIENT_PATH, "utf-8");

// ── Confidence pill wiring ───────────────────────────────────────────────

describe("W3 Step 3.5 — confidence pill is rendered on every rec card", () => {
  it("imports the RecConfidencePill component", () => {
    expect(CLIENT_SRC).toMatch(
      /import\s*\{[^}]*RecConfidencePill[^}]*\}\s*from\s*["']@\/components\/display\/rec-confidence-pill["']/,
    );
  });

  it("renders <RecConfidencePill verdict=...> in the rec card body", () => {
    expect(CLIENT_SRC).toMatch(
      /<RecConfidencePill\s+verdict=\{rec\.engineConfidence\}/,
    );
  });
});

// ── No auto-apply phrasing in user-visible copy ──────────────────────────

describe("W3 Step 3.5 — HIGH copy never implies auto-apply", () => {
  /**
   * Strip JS comments so phrases like "auto-applied" appearing in
   * doc-strings can stay (operator scope is about what the OPERATOR
   * sees on screen, not internal docstrings). Match what's left.
   */
  function strippedClient(): string {
    return CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
  }

  it("the rendered client source contains no 'auto-apply' or 'one-click' phrasing", () => {
    const stripped = strippedClient();
    expect(stripped).not.toMatch(/auto[\s-]?apply/i);
    expect(stripped).not.toMatch(/one[\s-]?click/i);
    expect(stripped).not.toMatch(/instantly\s+ship/i);
    expect(stripped).not.toMatch(/automatic\s+(?:apply|ship)/i);
  });

  it("no 'Apply all HIGH' bar / action / button (operator-locked W3 §1.5)", () => {
    const stripped = strippedClient();
    expect(stripped).not.toMatch(/apply.?all.?high/i);
    expect(stripped).not.toMatch(/acceptAllHighConfidence/);
    expect(stripped).not.toMatch(/undoAcceptAllHighConfidence/);
    expect(stripped).not.toMatch(/HighConfidenceApplyBar/);
  });
});

// ── Humanized labels: no raw enum tokens visible ─────────────────────────

describe("W3 Step 3.5 — humanized labels replace raw enum tokens", () => {
  it("edit.action_type goes through humanizeActionType, not the raw token", () => {
    // The fix replaced `ACTION_TYPE_BADGE[edit.action_type] ?? edit.action_type`
    // with `humanizeActionType(edit.action_type)`. Pin the new shape.
    expect(CLIENT_SRC).toMatch(/humanizeActionType\(edit\.action_type\)/);
    // The old fallthrough pattern must not be reintroduced.
    expect(CLIENT_SRC).not.toMatch(
      /ACTION_TYPE_BADGE\[edit\.action_type\]\s*\?\?\s*edit\.action_type/,
    );
  });

  it("edit.source goes through EDIT_SOURCE_LABEL", () => {
    expect(CLIENT_SRC).toMatch(/EDIT_SOURCE_LABEL\[edit\.source\]/);
  });

  it("edit.confidence goes through EDIT_CONFIDENCE_LABEL", () => {
    expect(CLIENT_SRC).toMatch(/EDIT_CONFIDENCE_LABEL\[edit\.confidence\]/);
  });

  it("EDIT_CONFIDENCE_LABEL maps high/medium/low to operator-friendly text", () => {
    expect(CLIENT_SRC).toMatch(/high:\s*"Strong"/);
    expect(CLIENT_SRC).toMatch(/medium:\s*"Review"/);
    expect(CLIENT_SRC).toMatch(/low:\s*"Weak signal"/);
  });

  it("EDIT_SOURCE_LABEL maps openai → 'AI-generated' (no raw enum tokens)", () => {
    expect(CLIENT_SRC).toMatch(/openai:\s*"AI-generated"/);
    expect(CLIENT_SRC).toMatch(/deterministic:\s*"Deterministic"/);
  });
});

// ── Empty state for all-filtered edits ───────────────────────────────────

describe("W3 Step 3.5 — empty state when all specific edits are filtered/quarantined", () => {
  it("rec card shows an empty-state hint when allEdits.length > 0 but editCount === 0", () => {
    expect(CLIENT_SRC).toMatch(
      /editCount\s*===\s*0\s*&&\s*allEdits\.length\s*>\s*0/,
    );
    expect(CLIENT_SRC).toMatch(/data-recommendations-edits-empty="true"/);
    // Whitespace-insensitive — JSX may line-wrap "all dismissed\n  or no
    // longer actionable" across multiple lines. The operator-facing
    // copy is what matters; JSX formatting is incidental.
    expect(CLIENT_SRC).toMatch(/all dismissed\s+or no longer actionable/i);
  });
});

// ── Existing actions still wired ─────────────────────────────────────────

describe("W3 Step 3.5 — existing actions still wired (no UI regression)", () => {
  it("Accept action still bound to the Accept button click handler", () => {
    expect(CLIENT_SRC).toMatch(/acceptRecommendation\(payload\)/);
    expect(CLIENT_SRC).toMatch(/Accept\b/);
  });

  it("Defer action still bound", () => {
    expect(CLIENT_SRC).toMatch(/deferRecommendation\(rec\.stableKey\)/);
  });

  it("Dismiss action still bound", () => {
    expect(CLIENT_SRC).toMatch(/dismissRecommendation\(rec\.stableKey\)/);
  });

  it("Mark-shipped action still bound (W2 Step 2.4)", () => {
    expect(CLIENT_SRC).toMatch(
      /markRecommendationShipped\(\{\s*stableKey:\s*rec\.stableKey/,
    );
  });

  it("Undo action still bound", () => {
    expect(CLIENT_SRC).toMatch(/undoRecommendationResponse\(rec\.stableKey\)/);
  });
});
