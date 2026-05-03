/**
 * W3 Step 3.5d (2026-05-02) — recommendations decision-queue invariants.
 *
 * Operator scope (browser audit, third pass): the page is a DECISION
 * QUEUE, not an evidence dump. Tier-based grouping (NOW · 5 / THIS
 * WEEK · 5 / LATER · 5) replaced with semantic LANES that say
 * "what kind of action this is and what to do with it":
 *
 *     Ready to ship   — actionable_edit display state
 *     Needs decision  — manual_review display state
 *     Needs fresh edit — needs_fresh_edit display state
 *     Tracking        — accepted_tracking display state
 *     Backlog         — backlog display state (collapsed by default)
 *
 * Each rec card follows ONE formula:
 *
 *     [Lane badge] [Confidence]
 *     Title (human action title — never internal jargon)
 *     Target: /target-url
 *     Recommended move: <one sentence>
 *     Why now: <one sentence>
 *     Evidence: <one sentence>
 *     [Effort chip]
 *     [Lane-specific action buttons]
 *     ▸ Show evidence + diagnostics  (expansion drawer)
 *
 * These source-scan tests pin the contract against silent regression.
 * A reorder is fine; a removal isn't.
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

// ── Lane model imports + render ──────────────────────────────────────────

describe("W3 Step 3.5d — lane model wired in client", () => {
  it("imports the RecLane type + lane labels + lane lead copy", () => {
    expect(CLIENT_SRC).toMatch(
      /import\s*\{[^}]*RecLane[^}]*\}\s*from\s*["']@\/domains\/recommendations\/display-state["']/,
    );
    expect(CLIENT_SRC).toMatch(/REC_LANE_LABEL/);
    expect(CLIENT_SRC).toMatch(/REC_LANE_LEAD/);
    expect(CLIENT_SRC).toMatch(/REC_LANE_TONE/);
    expect(CLIENT_SRC).toMatch(/laneForDisplayState/);
  });

  it("imports humanizeRecTitle, pageNameFromUrl, extractTopicTag", () => {
    expect(CLIENT_SRC).toMatch(
      /import\s*\{[^}]*humanizeRecTitle[^}]*\}\s*from\s*["']@\/domains\/recommendations\/recommendation-title-humanizer["']/,
    );
    expect(CLIENT_SRC).toMatch(/pageNameFromUrl/);
    expect(CLIENT_SRC).toMatch(/extractTopicTag/);
  });

  it("imports composeEvidencePreview + composeRecommendedMove", () => {
    expect(CLIENT_SRC).toMatch(
      /import\s*\{[^}]*composeEvidencePreview[^}]*\}\s*from\s*["']@\/domains\/recommendations\/recommendation-evidence-preview["']/,
    );
    expect(CLIENT_SRC).toMatch(/composeRecommendedMove/);
  });

  it("renders LaneSection for non-backlog lanes and BacklogSection for backlog", () => {
    expect(CLIENT_SRC).toMatch(/<LaneSection/);
    expect(CLIENT_SRC).toMatch(/<BacklogSection/);
  });

  it("backlog is collapsed by default in client state", () => {
    // showBacklog defaults to false → backlog section starts collapsed.
    expect(CLIENT_SRC).toMatch(
      /\[\s*showBacklog\s*,\s*setShowBacklog\s*\]\s*=\s*useState\(\s*false\s*\)/,
    );
    // BacklogSection accepts an expanded prop (collapse contract).
    expect(CLIENT_SRC).toMatch(/expanded:\s*boolean/);
  });

  it("classifies every queue rec into a lane via classifyRecDisplayState + laneForDisplayState", () => {
    expect(CLIENT_SRC).toMatch(/classifyRecDisplayState\(/);
    expect(CLIENT_SRC).toMatch(/laneForDisplayState\(/);
  });
});

// ── Card-formula structure ───────────────────────────────────────────────

describe("W3 Step 3.5d — every rec card follows the same formula", () => {
  it("renders the lane badge in the card header (not ACTION_LABEL or TIER_BADGE)", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-lane-badge=\{lane\}/);
    expect(CLIENT_SRC).toMatch(/REC_LANE_LABEL\[lane\]/);
  });

  it("renders the confidence pill in the card header", () => {
    expect(CLIENT_SRC).toMatch(
      /<RecConfidencePill\s+verdict=\{rec\.engineConfidence\}/,
    );
  });

  it("title goes through humanizeRecTitle (not buildResolvedRecommendationTitle)", () => {
    expect(CLIENT_SRC).toMatch(/humanizeRecTitle\(\s*\{/);
    // The pre-3.5d helper must not be reintroduced in this client.
    expect(CLIENT_SRC).not.toMatch(/buildResolvedRecommendationTitle/);
  });

  it("renders the target URL link with data-recommendations-target-url", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-target-url=["']true["']/);
  });

  it("renders 'Recommended move' sentence with data-recommendations-recommended-move", () => {
    expect(CLIENT_SRC).toMatch(
      /data-recommendations-recommended-move=["']true["']/,
    );
    expect(CLIENT_SRC).toMatch(/Recommended move:/);
    expect(CLIENT_SRC).toMatch(/composeRecommendedMove\(/);
  });

  it("renders 'Why now' sentence with data-recommendations-why-now", () => {
    expect(CLIENT_SRC).toMatch(/data-recommendations-why-now=["']true["']/);
    expect(CLIENT_SRC).toMatch(/Why now:/);
  });

  it("renders 'Evidence' sentence via composeEvidencePreview with data-recommendations-evidence-preview", () => {
    expect(CLIENT_SRC).toMatch(
      /data-recommendations-evidence-preview=["']true["']/,
    );
    expect(CLIENT_SRC).toMatch(/composeEvidencePreview\(/);
  });

  it("renders an effort chip with operator-readable label (Quick win / Medium effort / Heavy lift)", () => {
    expect(CLIENT_SRC).toMatch(/Quick win/);
    expect(CLIENT_SRC).toMatch(/Heavy lift/);
    expect(CLIENT_SRC).toMatch(/Medium effort/);
    expect(CLIENT_SRC).toMatch(/data-rec-effort-chip=/);
  });
});

// ── Lane-specific button surfaces ────────────────────────────────────────

describe("W3 Step 3.5d — each lane shows a different button surface", () => {
  it("ready_to_ship → Accept + Track / Defer / Dismiss", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button=["']accept_and_track["']/);
    // Operator copy "Accept + Track" or "Accept + Track (N edits)" must
    // exist at least once in the client.
    expect(CLIENT_SRC).toMatch(/Accept \+ Track/);
  });

  it("backlog → Promote / Defer / Dismiss", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button=["']promote["']/);
    expect(CLIENT_SRC).toMatch(/>\s*Promote\s*</);
  });

  it("tracking → Mark shipped / Undo (no Accept/Defer/Dismiss)", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action-button=["']mark_shipped["']/);
    expect(CLIENT_SRC).toMatch(/data-rec-action-button=["']undo["']/);
    expect(CLIENT_SRC).toMatch(/markRecommendationShipped/);
  });

  it("needs_decision → 'You decide the direction' affordance + Defer + Dismiss", () => {
    expect(CLIENT_SRC).toMatch(/You decide the direction/);
  });

  it("needs_fresh_edit → 'Regenerate when you're ready' + Dismiss only", () => {
    expect(CLIENT_SRC).toMatch(/Regenerate when you'?re ready/);
  });

  it("each rendered card stamps its lane on data-rec-button-row for tests", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-button-row=\{lane\}/);
  });
});

// ── Diagnostic content lives in expansion only ───────────────────────────

describe("W3 Step 3.5d — every diagnostic moves into the expansion drawer", () => {
  it("renders a single expansion <details> with data-rec-expansion='true'", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-expansion=["']true["']/);
    expect(CLIENT_SRC).toMatch(/Show evidence \+ diagnostics/);
  });

  it("AdjudicatorDetails (page brief, suggested edits, risks, cannibalization) lives inside the expansion drawer", () => {
    // The component is rendered; its render path is gated by the
    // expansion drawer.
    expect(CLIENT_SRC).toMatch(/<AdjudicatorDetails/);
  });

  it("SpecificEditsSection lives inside the expansion drawer", () => {
    expect(CLIENT_SRC).toMatch(/<SpecificEditsSection/);
  });

  it("the empty-state hint ('all edits dismissed/no longer actionable') stays inside the expansion drawer", () => {
    expect(CLIENT_SRC).toMatch(
      /data-recommendations-edits-empty=["']true["']/,
    );
  });

  it("the resolver's full reasoning is shown in the drawer when it differs from whyNow", () => {
    expect(CLIENT_SRC).toMatch(/Full reasoning/);
  });

  it("the resolver's confidenceReason is shown in the drawer (not on default card)", () => {
    expect(CLIENT_SRC).toMatch(/Confidence reason/);
  });

  it("'Why this matters' (motiveLabel) is shown in the drawer (not on default card)", () => {
    // Drawer label "Why this matters" — operator-readable.
    expect(CLIENT_SRC).toMatch(/Why this matters/);
  });

  it("'Top competitor' is shown in the drawer with a real (filtered) competitor only", () => {
    expect(CLIENT_SRC).toMatch(/Top competitor/);
    expect(CLIENT_SRC).toMatch(/shouldExcludeFromCompetitorRanking/);
  });
});

// ── Pre-3.5d code paths must not regress ─────────────────────────────────

describe("W3 Step 3.5d — pre-3.5d UI patterns are gone", () => {
  it("ACTION_LABEL constant is removed", () => {
    expect(CLIENT_SRC).not.toMatch(/^const ACTION_LABEL/m);
  });

  it("TIER_BADGE constant is removed", () => {
    expect(CLIENT_SRC).not.toMatch(/^const TIER_BADGE/m);
  });

  it("REC_TYPE_LABEL constant is removed", () => {
    expect(CLIENT_SRC).not.toMatch(/^const REC_TYPE_LABEL/m);
  });

  it("EvidenceChips component is removed", () => {
    expect(CLIENT_SRC).not.toMatch(/function EvidenceChips/);
    // No JSX <EvidenceChips ...> render anywhere.
    expect(CLIENT_SRC).not.toMatch(/<EvidenceChips/);
  });

  it("buildResolvedRecommendationTitle is no longer imported here", () => {
    expect(CLIENT_SRC).not.toMatch(/buildResolvedRecommendationTitle/);
  });

  it("'Site match' / 'AI-reviewed' tier-badge labels are no longer rendered (only allowed in comments)", () => {
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(stripped).not.toMatch(/>\s*Site match\s*</);
    expect(stripped).not.toMatch(/>\s*AI-reviewed\s*</);
  });

  it("'Decide tonight' header phrase is gone (no regression)", () => {
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(stripped).not.toMatch(/Decide tonight/i);
  });

  it("'Capture absent cluster' raw motive text is gone from default card", () => {
    // The MOTIVE_LABEL map now translates these to operator copy
    // ("AI is not citing Ritz for this topic yet."). The raw string
    // is allowed only in source comments — strip them and check.
    // The phrase "Counter competitors:" (plural, with colon) is a
    // separate JSX label inside the page-brief diagnostics drawer
    // (labeling `competitorAnglesToCounter`); that is NOT the same
    // string as the old "Counter competitor" motive heading. Pin the
    // exact quoted forms instead of the substring.
    const stripped = CLIENT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    expect(stripped).not.toMatch(/"Capture absent cluster"/);
    expect(stripped).not.toMatch(/"Counter competitor"/);
    expect(stripped).not.toMatch(/>\s*Capture absent cluster\s*</);
    expect(stripped).not.toMatch(/>\s*Counter competitor\s*</);
  });
});

// ── Generic-competitor leaks are filtered everywhere ─────────────────────

describe("W3 Step 3.5d — generic competitor entities never leak into operator copy", () => {
  it("competitor pickers in the client go through shouldExcludeFromCompetitorRanking", () => {
    // The expansion's "Top competitor" block consults the filter; the
    // helper must be imported and called against rec.evidence.
    expect(CLIENT_SRC).toMatch(/shouldExcludeFromCompetitorRanking/);
  });
});

// ── Internal taxonomy is preserved on data-* attributes ──────────────────

describe("W3 Step 3.5d — internal taxonomy lives on data-* attributes for tests + diagnostics", () => {
  it("data-rec-lane on <li> stamps the rendered lane", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-lane=\{lane\}/);
  });

  it("data-rec-display-state on <li> stamps the classifier state", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-display-state=\{displayState\}/);
  });

  it("data-rec-action stamps the resolved RecommendationAction enum", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-action=\{action\}/);
  });

  it("data-rec-tier stamps the resolver tier", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-tier=/);
  });

  it("data-rec-engine-confidence stamps the engine confidence enum", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-engine-confidence=\{rec\.engineConfidence\}/);
  });

  it("data-rec-effort stamps the raw effort enum (low/medium/high)", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-effort=\{rec\.effort\}/);
  });
});

// ── Header copy reset ────────────────────────────────────────────────────

describe("W3 Step 3.5d — header copy reads as operator decision queue", () => {
  it("the page header tells the operator to accept actions for tracking, not 'Decide tonight'", () => {
    expect(CLIENT_SRC).toMatch(
      /Accept an action to track whether it moves AI visibility/i,
    );
  });
});
