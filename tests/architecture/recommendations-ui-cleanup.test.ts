/**
 * Recommendations-client UI invariants — preserves the source-scan
 * contracts that survive across UI redesigns.
 *
 * After Step 3.5e (2026-05-03) the page is a HubSpot-style RANKED
 * ACTION TABLE. Pre-3.5e patterns (Confidence pill on every card,
 * SpecificEditsSection, EvidenceChips strip, lane sections) are
 * gone — those contracts moved to the action-row builder layer or
 * the table-specific test in
 * `tests/architecture/recommendations-step-3.5e-action-table.test.ts`.
 *
 * The contracts that DO survive every redesign:
 *   - HIGH copy never implies auto-apply.
 *   - No Apply-All-HIGH bar / action / button.
 *   - Server actions (Accept / Defer / Dismiss / Mark shipped /
 *     Undo) are still wired to row buttons.
 *   - The rendered client source carries no obvious enum-leak
 *     patterns ("create_cluster_page" / "add_h2_section" as visible
 *     text, raw "low" / "medium" / "high" outside data-* attributes).
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

function strippedClient(): string {
  return CLIENT_SRC
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

// ── No auto-apply phrasing in user-visible copy ──────────────────────────

describe("recommendations-client — HIGH copy never implies auto-apply", () => {
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

// ── Existing server actions still wired ─────────────────────────────────

describe("recommendations-client — server actions still wired (no UI regression)", () => {
  it("Accept action still bound somewhere in the client", () => {
    expect(CLIENT_SRC).toMatch(/acceptRecommendation\(/);
  });

  it("Defer action still bound", () => {
    expect(CLIENT_SRC).toMatch(/deferRecommendation\(/);
  });

  it("Dismiss action still bound", () => {
    expect(CLIENT_SRC).toMatch(/dismissRecommendation\(/);
  });

  it("Mark-shipped action still bound (W2 Step 2.4)", () => {
    expect(CLIENT_SRC).toMatch(/markRecommendationShipped\(/);
  });

  it("Undo action still bound", () => {
    expect(CLIENT_SRC).toMatch(/undoRecommendationResponse\(/);
  });
});

// ── No raw enum leakage as visible JSX text ────────────────────────────

describe("recommendations-client — no raw enum leakage in visible JSX", () => {
  it("never renders rec.type tokens (create_cluster_page / target_competitors / etc.) as visible text", () => {
    // These appear in the JSX text — pin them with the JSX text
    // boundary `>...<`.
    expect(CLIENT_SRC).not.toMatch(/>\s*create_cluster_page\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*target_competitors\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*strengthen_page_copy\s*</);
  });

  it("never renders edit.action_type tokens as visible text", () => {
    expect(CLIENT_SRC).not.toMatch(/>\s*add_h2_section\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*edit_meta\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*add_faq\s*</);
  });

  it("never renders raw 'low' / 'medium' / 'high' tokens as bare visible JSX text", () => {
    // These tokens are allowed in `data-*="low"` attributes (for tests
    // + diagnostics); banned only as bare visible text. Pattern:
    // `>low<` / `>medium<` / `>high<` with no surrounding word
    // characters.
    expect(CLIENT_SRC).not.toMatch(/>\s*low\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*medium\s*</);
    expect(CLIENT_SRC).not.toMatch(/>\s*high\s*</);
  });
});
