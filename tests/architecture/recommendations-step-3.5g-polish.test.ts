/**
 * W3 Step 3.5g (2026-05-03) — ranked-action-table polish invariants.
 *
 * Operator browser audit on Step 3.5f accepted the row-content
 * direction but flagged five small surfaces:
 *   1. Type column shows "—" for create_page rows; should say "Page".
 *   2. Shipped rows render inert "✓ Shipped" text; need an actionable
 *      View button so the operator can drill in.
 *   3. Evidence — when Ritz is absent AND a real competitor is
 *      visible, append "while competitors appear" to make the gap
 *      explicit.
 *   4. Add a subtle helper line: "Accepting a task starts tracking
 *      its impact on AI visibility."
 *   5. Avoid the duplicate-feeling Action + "Details" labels — keep
 *      a chevron-only secondary affordance instead.
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

const ROWS_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "src",
  "domains",
  "recommendations",
  "recommendation-action-rows.ts",
);
const ROWS_SRC = fs.readFileSync(ROWS_PATH, "utf-8");

// ── 1. Type pill ────────────────────────────────────────────────────────

describe("W3 Step 3.5g — Type column shows 'Page' for create_page (not '—')", () => {
  it("TypePill COMPACT_LABEL maps create_page → 'Page'", () => {
    expect(CLIENT_SRC).toMatch(/create_page:\s*"Page"/);
  });

  it("TypePill no longer short-circuits create_page to a '—' placeholder", () => {
    // The Step 3.5f short-circuit is gone. There must be no early
    // return that renders a literal "—" for create_page.
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(stripped).not.toMatch(
      /actionType\s*===\s*"create_page"[\s\S]*?return[\s\S]*?>\s*—\s*</,
    );
  });
});

// ── 2. Shipped row carries a View button (not inert text) ──────────────

describe("W3 Step 3.5g — shipped rows render a View button", () => {
  it("shipped status branch in RowActionButton renders a View button (data-rec-action-button='view_result')", () => {
    // The 3.5f version returned a <span>✓ Shipped</span>. The 3.5g
    // version returns a <button>View</button> wired to onOpenDetails.
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    // No inert "✓ Shipped" span left in the row's primary surface.
    expect(stripped).not.toMatch(/<span[^>]*>\s*✓\s*Shipped\s*<\/span>/);
    // A View button exists for shipped status.
    const shippedBranchIdx = stripped.indexOf('case "shipped"');
    expect(shippedBranchIdx).toBeGreaterThan(0);
    const after = stripped.slice(shippedBranchIdx, shippedBranchIdx + 600);
    expect(after).toMatch(/<button/);
    expect(after).toMatch(/data-rec-action-button="view_result"/);
    // JSX whitespace: text "View" sits on its own line between
    // `>` and `</button>` — match flexibly.
    expect(after).toMatch(/>\s*View\s*</);
    expect(after).toMatch(/onOpenDetails/);
  });
});

// ── 3. Evidence carries 'while competitors appear' when applicable ─────

describe("W3 Step 3.5g — evidence appends 'while competitors appear' tail", () => {
  it("composeRowEvidenceSummary computes realCompetitorPresent from rec.evidence.dominantCompetitors", () => {
    expect(ROWS_SRC).toMatch(/realCompetitorPresent/);
    expect(ROWS_SRC).toMatch(
      /ev\.dominantCompetitors\.some\(/,
    );
  });

  it("the 'while competitors appear' suffix is composed in source", () => {
    expect(ROWS_SRC).toContain("while competitors appear");
  });

  it("the suffix is gated on the entity-pollution filter", () => {
    expect(ROWS_SRC).toMatch(
      /shouldExcludeFromCompetitorRanking\(name\)/,
    );
  });
});

// ── 4. Helper copy line ────────────────────────────────────────────────

describe("W3 Step 3.5g — helper copy under the toolbar", () => {
  it("renders 'Accepting a task starts tracking its impact on AI visibility.'", () => {
    expect(CLIENT_SRC).toMatch(
      /Accepting a task starts tracking its impact on AI visibility/,
    );
    expect(CLIENT_SRC).toMatch(/data-recommendations-helper="true"/);
  });
});

// ── 5. Details affordance is chevron-only ───────────────────────────────

describe("W3 Step 3.5g — Details affordance is chevron-only", () => {
  it("the Details button has no visible 'Details' text label", () => {
    // The button still exists with data-rec-details-button, but the
    // child <span> that used to read "Details" is gone. The aria-
    // label / title still carries the accessible label.
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    // No `<span>Details</span>` inside the data-rec-details-button.
    expect(stripped).not.toMatch(
      /data-rec-details-button="true"[\s\S]{0,400}<span[^>]*>Details<\/span>/,
    );
    // aria-label still present so the button is accessible.
    expect(stripped).toMatch(
      /data-rec-details-button="true"[\s\S]{0,300}aria-label=\{expanded \? "Hide details" : "Show details"\}/,
    );
  });

  it("the Details column header drops the visible 'Details' text (sr-only label)", () => {
    expect(CLIENT_SRC).toMatch(/sr-only">Details</);
  });
});