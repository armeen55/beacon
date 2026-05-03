/**
 * W3 Step 3.5f (2026-05-03) — ranked-action-table row polish invariants.
 *
 * Operator scope (browser audit, fifth pass): the table shape from
 * Step 3.5e is right, but the row CONTENT is still cheap. This file
 * locks the operator-locked row-polish contracts:
 *
 *   - Title humanizer + cleanDisplayLabel + extractTopicFromPrompts
 *     are imported by the action-row builder.
 *   - The action-row builder threads `promptTextById` so geo-only
 *     clusters can recover topic from prompt scans.
 *   - Action button mapping per status:
 *       new + has exact edit         → Accept
 *       new + review_decision        → Review (open drawer)
 *       new + regenerate_edit        → Regenerate (open drawer)
 *       needs_review                 → Review (open drawer)
 *       needs_fresh_edit             → Regenerate (open drawer)
 *       accepted                     → Mark shipped (or View)
 *       measuring                    → View
 *       shipped                      → ✓ Shipped (no button)
 *       deferred                     → Promote
 *       dismissed                    → Restore
 *     Defer is NEVER a primary row button — it lives in the drawer
 *     secondary footer.
 *   - Type pill on `create_page` rows is suppressed (the row title
 *     already says "Create …"). Other types render the compact
 *     label with `whitespace-nowrap` so the column never wraps.
 *   - Sort buckets put open work above tracking by default.
 *   - Drawer carries a secondary-action footer with Defer + Dismiss.
 *   - Visible Details affordance with `data-rec-details-button`.
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

// ── Action-row builder threads new helpers ──────────────────────────────

describe("W3 Step 3.5f — action-row builder threads new helpers", () => {
  it("imports cleanDisplayLabel + extractTopicFromPrompts + extractGeoTag + sanitizeClusterLabel", () => {
    expect(ROWS_SRC).toMatch(/cleanDisplayLabel/);
    expect(ROWS_SRC).toMatch(/extractTopicFromPrompts/);
    expect(ROWS_SRC).toMatch(/extractGeoTag/);
    expect(ROWS_SRC).toMatch(/sanitizeClusterLabel/);
  });

  it("BuildActionRowsArgs accepts promptTextById", () => {
    expect(ROWS_SRC).toMatch(/promptTextById\?\s*:\s*Record<string,\s*string>/);
  });

  it("composeEditRowTitle wraps cleaned labels in curly quotes", () => {
    // Curly opener `“` and closer `”` — operator scope is consistent
    // typographic quoting. Source code must include both code points.
    expect(ROWS_SRC).toContain("“");
    expect(ROWS_SRC).toContain("”");
  });

  it("composeMetaRowTitle accepts affectedPromptTexts", () => {
    expect(ROWS_SRC).toMatch(/affectedPromptTexts:\s*ReadonlyArray<string>/);
  });

  it("priorityForRow blends observationCount + brandPrimaryShare + needsHumanReview + hasExactEdit", () => {
    expect(ROWS_SRC).toMatch(/observationCount:\s*number/);
    expect(ROWS_SRC).toMatch(/brandPrimaryShare:\s*number/);
    expect(ROWS_SRC).toMatch(/needsHumanReview:\s*boolean/);
    expect(ROWS_SRC).toMatch(/hasExactEdit:\s*boolean/);
  });

  it("composeRowEvidenceSummary leads every row with '{N} AI answer(s)'", () => {
    expect(ROWS_SRC).toMatch(/AI answer\$\{N === 1 \? "" : "s"\}/);
  });

  it("status sort buckets put open work first (new / needs_review / needs_fresh_edit → 0)", () => {
    // Pin the bucket map shape so a future shuffle doesn't quietly
    // demote open work below tracking.
    expect(ROWS_SRC).toMatch(/STATUS_BUCKET[\s\S]+new:\s*0[\s\S]+accepted:\s*1/);
    expect(ROWS_SRC).toMatch(/measuring:\s*2/);
    expect(ROWS_SRC).toMatch(/(deferred|dismissed):\s*4/);
  });
});

// ── Title humanizer extensions are present ──────────────────────────────

describe("W3 Step 3.5f — title humanizer carries the new helpers", () => {
  const HUMANIZER_PATH = path.resolve(
    __dirname,
    "..",
    "..",
    "src",
    "domains",
    "recommendations",
    "recommendation-title-humanizer.ts",
  );
  const HUMANIZER_SRC = fs.readFileSync(HUMANIZER_PATH, "utf-8");

  it("exports extractTopicFromPrompts", () => {
    expect(HUMANIZER_SRC).toMatch(/export function extractTopicFromPrompts/);
  });

  it("exports cleanDisplayLabel", () => {
    expect(HUMANIZER_SRC).toMatch(/export function cleanDisplayLabel/);
  });

  it("exports sanitizeClusterLabel", () => {
    expect(HUMANIZER_SRC).toMatch(/export function sanitizeClusterLabel/);
  });

  it("registers the design_build_vs_architect topic at priority 1", () => {
    expect(HUMANIZER_SRC).toMatch(/id:\s*"design_build_vs_architect"[\s\S]+priority:\s*1/);
  });

  it("registers the whole_home_renovation topic", () => {
    expect(HUMANIZER_SRC).toMatch(/id:\s*"whole_home_renovation"/);
  });

  it("registers the luxury_custom_home topic", () => {
    expect(HUMANIZER_SRC).toMatch(/id:\s*"luxury_custom_home"/);
  });

  it("title fallback never uses 'this scenario' or 'this opportunity' phrasing", () => {
    const stripped = HUMANIZER_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    // The pre-3.5f generic "Create a page for this scenario"
    // fallback was operator-flagged. Replaced with a cluster-phrase
    // pass-through + "Review this page opportunity" last-resort.
    expect(stripped).not.toMatch(/this opportunity/);
    expect(stripped).not.toMatch(/Create a page for this scenario/);
    expect(stripped).not.toMatch(/Pick a direction for this opportunity/);
  });
});

// ── Client UI: action-button mapping ───────────────────────────────────

describe("W3 Step 3.5f — client action-button mapping per status", () => {
  it("dismissed row's primary button is 'Restore' (data-rec-action-button='restore')", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button="restore"/);
    expect(CLIENT_SRC).toMatch(/>\s*Restore\s*</);
  });

  it("deferred row's primary button is 'Promote' (data-rec-action-button='promote')", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button="promote"/);
    expect(CLIENT_SRC).toMatch(/>\s*Promote\s*</);
  });

  it("needs_review row's primary button is 'Review' (data-rec-action-button='review')", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button="review"/);
    expect(CLIENT_SRC).toMatch(/>\s*Review\s*</);
  });

  it("needs_fresh_edit row's primary button is 'Regenerate'", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button="regenerate"/);
    expect(CLIENT_SRC).toMatch(/>\s*Regenerate\s*</);
  });

  it("measuring row's primary button is 'View'", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button="view_result"/);
    expect(CLIENT_SRC).toMatch(/>\s*View\s*</);
  });

  it("Defer is NEVER bound as a primary row button (only as drawer secondary)", () => {
    // Look for `data-rec-action-button="defer"` outside the drawer
    // secondary-actions block. Easiest check: there should be ONE
    // occurrence of the defer button, and it should appear inside
    // the secondary-actions block.
    const deferOccurrences = (
      CLIENT_SRC.match(/data-rec-action-button="defer"/g) ?? []
    ).length;
    expect(deferOccurrences).toBe(1);
    // The single defer occurrence sits inside the
    // drawer-secondary-actions block.
    const secondaryStart = CLIENT_SRC.indexOf(
      'data-rec-drawer-secondary-actions="true"',
    );
    const deferIndex = CLIENT_SRC.indexOf('data-rec-action-button="defer"');
    expect(secondaryStart).toBeGreaterThan(0);
    expect(deferIndex).toBeGreaterThan(secondaryStart);
  });
});

// ── Client UI: type pill on create_page rows ──────────────────────────

describe("W3 Step 3.5f — Type column polish", () => {
  it("create_page rows render the compact 'Page' pill (W3 §3.5g — restored from '—')", () => {
    // Operator scope (Step 3.5g): the 3.5f "—" placeholder confused
    // the operator browser audit ("Page-creation rows show Type =
    // blank/dash"). The COMPACT_LABEL map now includes
    // create_page → "Page". whitespace-nowrap keeps the column
    // single-line.
    expect(CLIENT_SRC).toMatch(/create_page:\s*"Page"/);
  });

  it("Type pill uses whitespace-nowrap so single-line labels never wrap", () => {
    expect(CLIENT_SRC).toMatch(/whitespace-nowrap/);
  });

  it("type-filter dropdown surfaces 'Page' (not 'Create page') for the create_page option", () => {
    expect(CLIENT_SRC).toMatch(
      /\{\s*value:\s*"create_page",\s*label:\s*"Page"\s*\}/,
    );
  });
});

// ── Client UI: details affordance + drawer secondary actions ──────────

describe("W3 Step 3.5f — visible Details affordance + drawer secondary actions", () => {
  it("each row carries a visible Details button with data-rec-details-button", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-details-button="true"/);
  });

  it("the Details button reveals the drawer (aria-expanded wired)", () => {
    expect(CLIENT_SRC).toMatch(/aria-expanded=\{expanded\}/);
  });

  it("drawer footer carries Defer + Dismiss as secondary actions", () => {
    expect(CLIENT_SRC).toMatch(
      /data-rec-drawer-secondary-actions="true"/,
    );
    expect(CLIENT_SRC).toMatch(/Defer 7 days/);
    expect(CLIENT_SRC).toMatch(/>\s*Dismiss\s*</);
  });

  it("drawer secondary actions hidden once the row is terminal", () => {
    // The component declares `showSecondaryActions` and gates the
    // footer on it.
    expect(CLIENT_SRC).toMatch(/showSecondaryActions/);
  });
});

// ── Client UI: row click + button click both open the drawer ──────────

describe("W3 Step 3.5f — drawer can be opened from Details OR row title", () => {
  it("Details button + row-title button both call onToggleExpand", () => {
    // The Details button + row-title button both bind onToggleExpand.
    expect(CLIENT_SRC).toMatch(/onClick=\{onToggleExpand\}/);
    // RowActionButton's onOpenDetails param wires through to the
    // same handler so Review / Regenerate / View open the drawer.
    expect(CLIENT_SRC).toMatch(/onOpenDetails:\s*\(\)\s*=>\s*void/);
  });
});