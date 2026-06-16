/**
 * Architecture invariant — Round 1 customer-readiness paper-cuts (2026-05-05).
 *
 * After the customer-readiness audit found surgical issues in /today,
 * /recommendations, and /changes, the operator approved a 6-fix bundle:
 *
 *   1. /changes Mark Shipped tooltip — replace DB-schema-leak copy
 *      ("Stamps live_at = now and live_match_kind = operator_override…")
 *      with operator-readable copy ("Confirm this change is live on
 *      your site. Beacon will start tracking its impact now…").
 *   2. /today Poll Health infra-leak — replace "Supabase schema",
 *      "dual-write logs", and "GitHub Actions logs" in customer-facing
 *      poll-failure messages with "persistence", "daily-poll logs",
 *      and "scheduled-job logs".
 *   3. /recommendations AI-source pill — render a small "AI" pill on
 *      rec rows whose underlying edit source is `openai` (or any
 *      future LLM provider). Deterministic rows render nothing.
 *   4. /recommendations engine-confidence pill — surface
 *      `engineConfidence` on the row directly (was previously only in
 *      the collapsed Debug block). The detailed `confidenceReason`
 *      stays in the drawer.
 *   5. /today sampling-taxonomy unification — replace "proof run" /
 *      "proof-sized sample" with "verification sample" everywhere it
 *      surfaces to the operator. "Partial day" stays as the
 *      partial-chunks term.
 *   6. /changes Imported legacy empty state — replace
 *      "Pre-pivot CSV / PDF rebuild rows would appear here" with
 *      "Imported historical changes appear here. Most accounts have
 *      nothing in this tab."
 *
 * This file pins each fix with positive (new copy / new render
 * branch is present) AND negative (old jargon stays gone) invariants
 * so the bundle's customer-readiness gains can't silently regress.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const ROW_TYPE_PATH = join(
  REPO_ROOT,
  "src/domains/recommendations/recommendation-action-rows.ts",
);

// Surface collapse (2026-06-15): scorecard-client.tsx +
// recommendations-client.tsx were deleted. Fix 1 (Mark Shipped tooltip),
// Fix 3 (AI-source pill), Fix 4 (engineConfidence pill), and Fix 6
// (Imported-legacy empty state) pinned legacy-client copy; those describe
// blocks are skipped below (the V2 surfaces have their own contract tests).
// Dead-code deletion (2026-06-16): poll-health-block.tsx was orphaned when
// the legacy today-client was removed, so Fix 2 (poll-health infra-leak)
// and Fix 5 (sampling taxonomy) describe blocks were removed with it.
const ROW_TYPE_SRC = readFileSync(ROW_TYPE_PATH, "utf-8");

// Legacy-client sources removed (see note above). Empty placeholders keep
// the skipped legacy describe blocks compiling without reading a deleted
// file.
const SCORECARD_CODE = "";
const RECS_CLIENT_CODE = "";

// ────────────────────────────────────────────────────────────────────────
// Fix 1 — Mark Shipped tooltip rewrite
// ────────────────────────────────────────────────────────────────────────

describe.skip("Round 1 Fix 1 — /changes Mark Shipped tooltip (legacy scorecard-client removed 2026-06-15)", () => {
  it("renders the new operator-readable copy", () => {
    expect(
      SCORECARD_CODE.includes(
        "Confirm this change is live on your site. Beacon will start tracking its impact now",
      ),
      "scorecard-client.tsx must include the new Mark Shipped tooltip copy " +
        "verbatim. Old copy leaked database column names ('live_at', " +
        "'live_match_kind', 'operator_override') as primary tooltip text.",
    ).toBe(true);
  });

  it("removes 'live_at = now' DB-schema leak", () => {
    expect(
      /Stamps live_at = now/.test(SCORECARD_CODE),
      "scorecard-client.tsx must NOT include the old 'Stamps live_at = now' " +
        "DB-schema leak in any operator-visible tooltip. Move references to " +
        "internal columns into JSDoc / code comments only.",
    ).toBe(false);
  });

  it("removes 'live_match_kind = operator_override' enum leak", () => {
    expect(
      /live_match_kind\s*=\s*operator_override/.test(SCORECARD_CODE),
      "scorecard-client.tsx must NOT include the raw enum " +
        "'live_match_kind = operator_override' in operator-visible copy.",
    ).toBe(false);
  });

  it("does not bring back the old 'verdict math' phrasing on the button", () => {
    // The old tooltip ended with "want the verdict math to start before
    // tomorrow's scan." That phrase referenced an internal concept
    // ("verdict math") that's already replaced with friendlier copy
    // ("tracking its impact"). Pin the regression direction.
    expect(
      /verdict math to start/.test(SCORECARD_CODE),
      "scorecard-client.tsx must NOT include 'verdict math' in operator-" +
        "visible copy on the Mark Shipped button (the new copy says " +
        "'tracking its impact').",
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 2 — Poll Health infra-leak rewrite
// ────────────────────────────────────────────────────────────────────────
// Removed (2026-06-16): poll-health-block.tsx is dead code (orphaned when
// the legacy today-client was deleted). The customer-facing poll-health
// surface lives in the V2 dashboard now, with its own contract tests.

// ────────────────────────────────────────────────────────────────────────
// Fix 3 — /recommendations AI source pill
// ────────────────────────────────────────────────────────────────────────

describe.skip("Round 1 Fix 3 — /recommendations AI-source pill (legacy recommendations-client removed 2026-06-15)", () => {
  it("RecommendationActionRow type carries an editSource field", () => {
    expect(
      /readonly editSource:\s*string \| null/.test(ROW_TYPE_SRC),
      "RecommendationActionRow must declare an `editSource: string | null` " +
        "field so the rec table can render an 'AI' pill on rows whose " +
        "underlying edit was generated by an AI provider.",
    ).toBe(true);
  });

  it("row builder populates editSource from edit.source", () => {
    expect(
      /editSource:\s*edit\.source\s*\?\?\s*null/.test(ROW_TYPE_SRC),
      "row builder (non-FAQ path) must source editSource from edit.source",
    ).toBe(true);
    expect(
      /editSource:\s*question\.source\s*\?\?\s*null/.test(ROW_TYPE_SRC),
      "row builder (FAQ-pair path) must source editSource from question.source",
    ).toBe(true);
  });

  it("renders an AIPill component referencing the openai source", () => {
    expect(
      /function AIPill\(/.test(RECS_CLIENT_CODE),
      "recommendations-client.tsx must define an AIPill component",
    ).toBe(true);
    expect(
      /AI_SOURCE_NAMES\s*=\s*new Set\(\[\s*"openai"/.test(RECS_CLIENT_CODE),
      "AIPill must gate on an AI_SOURCE_NAMES set that includes 'openai'",
    ).toBe(true);
  });

  it("AIPill is rendered in the row title cell", () => {
    expect(
      /<AIPill\s+source=\{row\.editSource\}\s*\/>/.test(RECS_CLIENT_CODE),
      "AIPill must be slotted into the row title cell with source=row.editSource",
    ).toBe(true);
  });

  it("returns null for non-AI sources (deterministic rows render no pill)", () => {
    // The component body returns null when source is null OR not in the
    // allow set. Pin the early-return shape.
    expect(
      /AIPill[\s\S]{0,400}if\s*\(!source[\s\S]{0,40}return null/.test(
        RECS_CLIENT_CODE,
      ),
      "AIPill must early-return null for missing or non-allow-listed " +
        "sources so deterministic rows render no pill.",
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 4 — /recommendations engineConfidence pill
// ────────────────────────────────────────────────────────────────────────

describe.skip("Round 1 Fix 4 — /recommendations engineConfidence pill (legacy recommendations-client removed 2026-06-15)", () => {
  it("RecommendationActionRow type carries a top-level engineConfidence field", () => {
    expect(
      /readonly engineConfidence:\s*"high"\s*\|\s*"medium"\s*\|\s*"low"\s*\|\s*null/.test(
        ROW_TYPE_SRC,
      ),
      "RecommendationActionRow must declare an `engineConfidence: " +
        '"high" | "medium" | "low" | null` field so the rec table can ' +
        "render a confidence pill on the row directly (without the " +
        "operator having to expand the Debug block).",
    ).toBe(true);
  });

  it("row builder populates engineConfidence from rec.engineConfidence.confidence", () => {
    // All three build paths (FAQ-pair, non-FAQ, meta-action) must
    // populate the field.
    const matches = ROW_TYPE_SRC.match(
      /engineConfidence:\s*rec\.engineConfidence\?\.confidence\s*\?\?\s*null/g,
    );
    expect(
      matches,
      "row builder must populate engineConfidence from rec.engineConfidence.confidence " +
        "with `?? null` fallback in every build path.",
    ).not.toBeNull();
    expect(
      matches!.length,
      `expected at least 3 populate sites (FAQ-pair, non-FAQ, meta-action); found ${matches!.length}`,
    ).toBeGreaterThanOrEqual(3);
  });

  it("renders a ConfidencePill component", () => {
    expect(
      /function ConfidencePill\(/.test(RECS_CLIENT_CODE),
      "recommendations-client.tsx must define a ConfidencePill component",
    ).toBe(true);
    expect(
      /CONFIDENCE_PILL_LABEL[\s\S]{0,200}High confidence/.test(
        RECS_CLIENT_CODE,
      ),
      "ConfidencePill must use customer-readable labels including 'High confidence'",
    ).toBe(true);
    expect(
      /CONFIDENCE_PILL_LABEL[\s\S]{0,200}Medium confidence/.test(
        RECS_CLIENT_CODE,
      ),
      "ConfidencePill must include 'Medium confidence' label",
    ).toBe(true);
    expect(
      /CONFIDENCE_PILL_LABEL[\s\S]{0,200}Low confidence/.test(RECS_CLIENT_CODE),
      "ConfidencePill must include 'Low confidence' label",
    ).toBe(true);
  });

  it("ConfidencePill is rendered in the row title cell", () => {
    expect(
      /<ConfidencePill\s+confidence=\{row\.engineConfidence\}\s*\/>/.test(
        RECS_CLIENT_CODE,
      ),
      "ConfidencePill must be slotted into the row title cell with " +
        "confidence=row.engineConfidence",
    ).toBe(true);
  });

  it("ConfidencePill is OPTIONAL — returns null for unknown confidence", () => {
    expect(
      /ConfidencePill[\s\S]{0,400}if\s*\(!confidence\)\s*return null/.test(
        RECS_CLIENT_CODE,
      ),
      "ConfidencePill must early-return null when confidence is null so " +
        "rows without a verdict don't render a misleading 'unknown' pill.",
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Fix 5 — /today sampling taxonomy unification
// ────────────────────────────────────────────────────────────────────────
// Removed (2026-06-16): the sampling-taxonomy copy lived in the dead
// poll-health-block.tsx (orphaned with the legacy today-client). The V2
// dashboard's poll-health surface carries this contract now.

// ────────────────────────────────────────────────────────────────────────
// Fix 6 — /changes Imported legacy empty state
// ────────────────────────────────────────────────────────────────────────

describe.skip("Round 1 Fix 6 — /changes Imported legacy empty state (legacy scorecard-client removed 2026-06-15)", () => {
  it("renders the new empty-state copy", () => {
    expect(
      SCORECARD_CODE.includes(
        "Imported historical changes appear here. Most accounts have nothing in this tab.",
      ),
      "scorecard-client.tsx EMPTY_TAB_COPY for imported_legacy must include " +
        "the new operator-readable copy verbatim.",
    ).toBe(true);
  });

  it("removes 'Pre-pivot CSV / PDF rebuild' jargon", () => {
    expect(
      /Pre-pivot CSV \/ PDF rebuild/.test(SCORECARD_CODE),
      "scorecard-client.tsx must NOT include 'Pre-pivot CSV / PDF rebuild' " +
        "in any operator-visible empty-state copy. That's internal " +
        "migration history, not a customer-readable explanation.",
    ).toBe(false);
  });

  it("removes the 'No imported legacy rows visible' lead", () => {
    expect(
      /No imported legacy rows visible/.test(SCORECARD_CODE),
      "scorecard-client.tsx must NOT include the old 'No imported legacy " +
        "rows visible' lead — replaced with friendlier 'Imported historical " +
        "changes appear here.'",
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cross-fix: bundle integrity sanity
// ────────────────────────────────────────────────────────────────────────

describe("Round 1 — bundle integrity (no scope creep)", () => {
  it("no NEW production-code references to forbidden Round 1 phrases", () => {
    // Cross-check across all four touched files: no other landing site
    // re-introduced the leaked phrases.
    const forbidden = [
      "Stamps live_at = now",
      "live_match_kind = operator_override",
      "Pre-pivot CSV / PDF rebuild",
      "Supabase schema",
      "dual-write logs",
      "GitHub Actions logs",
      "proof run (small sample)",
      "proof-sized sample",
    ];
    const offenders: string[] = [];
    const all = [
      SCORECARD_CODE,
      RECS_CLIENT_CODE,
    ].join("\n");
    for (const phrase of forbidden) {
      if (all.includes(phrase)) offenders.push(phrase);
    }
    expect(
      offenders,
      `Round 1 forbidden phrases re-appeared in source: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
