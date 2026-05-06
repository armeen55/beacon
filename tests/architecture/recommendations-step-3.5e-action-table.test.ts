/**
 * W3 Step 3.5e (2026-05-03) — recommendations action-table invariants.
 *
 * Operator scope (browser audit, fourth pass): /recommendations is a
 * RANKED ACTION TABLE — HubSpot/Jira-style — not a card dashboard,
 * not a lifecycle dashboard, not an evidence feed.
 *
 * Contract this file pins:
 *   - The client renders ONE action-table region (no lane sections).
 *   - Each row renders these columns: # | Recommended action |
 *     Target | Type | Priority | Status | Evidence | Action.
 *   - Toolbar carries a search input + a Type filter + a Status filter
 *     + a summary line ("N actions · M new · K tracking") + the last-
 *     refreshed date.
 *   - Click on a row toggles a drawer (`<tr ...><td colspan="8">`)
 *     containing exact change / why / evidence / measurement plan /
 *     debug. Default rendering is collapsed.
 *   - Pre-3.5d patterns are gone: lane sections, card "Recommended
 *     move:" sentence, evidence chip strip, REC_LANE_LABEL, etc.
 *
 * Source-scan tests (read the client file verbatim and pin patterns).
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

// ── Top-level architecture ───────────────────────────────────────────────

describe("W3 Step 3.5e — client imports the action-row builder + types", () => {
  it("imports buildRecommendationActionRows + ACTION_ROW_TYPE_LABEL + ACTION_ROW_PRIORITY_LABEL + ACTION_ROW_STATUS_LABEL", () => {
    expect(CLIENT_SRC).toMatch(
      /import\s*\{[^}]*buildRecommendationActionRows[^}]*\}\s*from\s*["']@\/domains\/recommendations\/recommendation-action-rows["']/,
    );
    expect(CLIENT_SRC).toMatch(/ACTION_ROW_TYPE_LABEL/);
    expect(CLIENT_SRC).toMatch(/ACTION_ROW_PRIORITY_LABEL/);
    expect(CLIENT_SRC).toMatch(/ACTION_ROW_STATUS_LABEL/);
  });

  it("calls buildRecommendationActionRows from the client component", () => {
    expect(CLIENT_SRC).toMatch(/buildRecommendationActionRows\(\s*\{/);
  });
});

describe("W3 Step 3.5e — toolbar (search + filters + summary)", () => {
  it("renders a search input with data-recommendations-search", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-search=["']true["']/);
  });

  it("renders a type filter with data-recommendations-type-filter", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-type-filter=["']true["']/);
  });

  it("renders a status filter with data-recommendations-status-filter", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-status-filter=["']true["']/);
  });

  it("renders a summary line with data-recommendations-summary", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-summary=["']true["']/);
  });

  it("summary mentions actions / new / tracking counts", () => {
    // JSX-rendered summary shape: "{summary.total} action{...}"
    // followed by the new/tracking counts further down.
    expect(CLIENT_SRC).toMatch(/\{summary\.total\}\s+action/);
    expect(CLIENT_SRC).toMatch(/new/);
    expect(CLIENT_SRC).toMatch(/tracking/i);
  });

  it("the toolbar shows the matrix-date as 'Last refreshed: …'", () => {
    expect(CLIENT_SRC).toMatch(/Last refreshed:\s*\{matrixDate\}/);
  });
});

describe("W3 Step 3.5e — table structure", () => {
  it("renders a <table> with data-recommendations-action-table", () => {
    expect(CLIENT_SRC).toMatch(
      /data-recommendations-action-table=["']true["']/,
    );
  });

  it("the table header includes Recommended action / Target / Type / Priority / Status / Evidence / Action", () => {
    expect(CLIENT_SRC).toMatch(/>\s*Recommended action\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Target\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Type\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Priority\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Status\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Evidence\s*</);
    expect(CLIENT_SRC).toMatch(/>\s*Action\s*</);
  });

  it("each row stamps internal taxonomy on data-rec-* attributes", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-row-id=\{row\.id\}/);
    expect(CLIENT_SRC).toMatch(/data-rec-action-row-type=\{row\.actionType\}/);
    expect(CLIENT_SRC).toMatch(/data-rec-priority=\{row\.priority\}/);
    expect(CLIENT_SRC).toMatch(/data-rec-status=\{row\.status\}/);
    // 2026-05-06 demo-path fix: data-rec-source-rec-id /
    // data-rec-source-edit-id are conditionally included (operator
    // mode + tests only) since the values are UUIDs that leak via
    // view-source / DevTools when shipped to customers. The pin
    // here matches the conditional-spread shape, not the prior
    // unconditional `attr={value}` form.
    expect(CLIENT_SRC).toMatch(
      /OPERATOR_MODE_DEBUG[\s\S]{0,200}"data-rec-source-rec-id":\s*row\.sourceRecommendationId/,
    );
    expect(CLIENT_SRC).toMatch(/data-rec-rank=\{row\.rank\}/);
  });

  it("renders a TypePill / PriorityPill / StatusPill per row", () => {
    expect(CLIENT_SRC).toMatch(/<TypePill/);
    expect(CLIENT_SRC).toMatch(/<PriorityPill/);
    expect(CLIENT_SRC).toMatch(/<StatusPill/);
    // The pills carry data-* attributes for tests + diagnostics.
    expect(CLIENT_SRC).toMatch(/data-rec-type-pill=\{actionType\}/);
    expect(CLIENT_SRC).toMatch(/data-rec-priority-pill=\{priority\}/);
    expect(CLIENT_SRC).toMatch(/data-rec-status-pill=\{status\}/);
  });

  it("the per-row Action column renders a button with data-rec-action-button", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button=/);
  });
});

describe("W3 Step 3.5e — drawer (row click toggles inline detail)", () => {
  it("clicking the row toggles expansion (state-driven)", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-row-toggle=["']true["']/);
    expect(CLIENT_SRC).toMatch(/aria-expanded=\{expanded\}/);
  });

  it("the drawer container carries data-rec-row-drawer", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-row-drawer=["']true["']/);
  });

  it("the drawer has sections: Exact recommended change / Why / Evidence / Measurement / Debug", () => {
    expect(CLIENT_SRC).toMatch(/title=\"Exact recommended change\"/);
    expect(CLIENT_SRC).toMatch(/title=\"Why Beacon recommends it\"/);
    expect(CLIENT_SRC).toMatch(/title=\"Evidence\"/);
    expect(CLIENT_SRC).toMatch(/title=\"Measurement plan\"/);
    expect(CLIENT_SRC).toMatch(/data-rec-debug-block=["']true["']/);
  });

  it("debug block sits inside a <details> (collapsed by default)", () => {
    // The debug block must use <details>...</details> so it doesn't
    // pollute the operator's first read.
    expect(CLIENT_SRC).toMatch(
      /<details[^>]*data-rec-debug-block=["']true["']/,
    );
  });
});

describe("W3 Step 3.5e — pre-3.5d patterns are gone", () => {
  it("no lane sections (LaneSection / BacklogSection / RecLane)", () => {
    expect(CLIENT_SRC).not.toMatch(/<LaneSection/);
    expect(CLIENT_SRC).not.toMatch(/<BacklogSection/);
    expect(CLIENT_SRC).not.toMatch(/REC_LANE_LABEL/);
    expect(CLIENT_SRC).not.toMatch(/REC_LANE_LEAD/);
    expect(CLIENT_SRC).not.toMatch(/REC_LANE_TONE/);
    expect(CLIENT_SRC).not.toMatch(/laneForDisplayState/);
  });

  it("no 'Recommended move:' / 'Why now:' lead-with-paragraph card layout", () => {
    expect(CLIENT_SRC).not.toMatch(/data-recommendations-recommended-move=/);
    expect(CLIENT_SRC).not.toMatch(/data-recommendations-why-now=/);
    expect(CLIENT_SRC).not.toMatch(/data-recommendations-evidence-preview=/);
  });

  it("no RecConfidencePill on the default card (table column has Priority instead)", () => {
    expect(CLIENT_SRC).not.toMatch(/<RecConfidencePill/);
  });

  it("no EvidenceChips component reference (deleted in 3.5d)", () => {
    expect(CLIENT_SRC).not.toMatch(/<EvidenceChips/);
  });

  it("no 'Decide tonight' / 'Site match' / 'AI-reviewed' / 'fragmented' tier badges", () => {
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(stripped).not.toMatch(/Decide tonight/i);
    expect(stripped).not.toMatch(/>\s*Site match\s*</);
    expect(stripped).not.toMatch(/>\s*AI-reviewed\s*</);
    expect(stripped).not.toMatch(/>\s*\d+\s+fragmented\s*</);
  });

  it("no 'Weak signal' rendered as visible text (operator scope: use Low priority instead)", () => {
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    // Operator copy never says "Weak signal" anywhere on the table.
    expect(stripped).not.toMatch(/>\s*Weak signal\s*</);
  });
});

describe("W3 Step 3.5e — operator-locked copy bans", () => {
  it("the rendered client never shows 'homepage page'", () => {
    // We render either "Homepage" (when path is /) or "{Page Name}
    // page" — never "homepage page".
    expect(CLIENT_SRC).not.toMatch(/homepage page/);
  });

  it("the rendered client never shows 'Create a page for this scenario' fallback", () => {
    // The pre-3.5d generic fallback is gone; the title humanizer
    // emits action-specific copy.
    expect(CLIENT_SRC).not.toMatch(/Create a page for this scenario/);
  });
});
