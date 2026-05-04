/**
 * W3 Step 3.15 (2026-05-04) — FAQ Q+A grouping + title polish
 * source-scan invariants.
 *
 * Operator scope: pin the contract by source-scanning the action-row
 * builder + the recommendations client. Functional behavior is
 * tested in `recommendation-action-rows-faq-grouping.test.ts`; this
 * file locks the WIRING + the drawer rendering shape so a future
 * refactor doesn't silently regress them.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

// ── Builder exports the FAQ-pair helpers ──────────────────────────────

describe("W3 Step 3.15 — action-row builder exports FAQ grouping helpers", () => {
  it("exports composeFaqPairRowTitle", () => {
    expect(ROWS_SRC).toMatch(/export function composeFaqPairRowTitle/);
  });

  it("exports partitionEditsForFaqPairing", () => {
    expect(ROWS_SRC).toMatch(/export function partitionEditsForFaqPairing/);
  });

  it("exports extractElementKeyHashSuffix", () => {
    expect(ROWS_SRC).toMatch(/export function extractElementKeyHashSuffix/);
  });

  it("ActionRowDetail carries faqAnswerText: string | null", () => {
    expect(ROWS_SRC).toMatch(/faqAnswerText:\s*string\s*\|\s*null/);
  });

  it("debug block carries pairedAnswerEditId: string | null", () => {
    expect(ROWS_SRC).toMatch(/pairedAnswerEditId:\s*string\s*\|\s*null/);
  });

  it("buildRecommendationActionRows uses partitionEditsForFaqPairing", () => {
    expect(ROWS_SRC).toMatch(/partitionEditsForFaqPairing\(\s*renderable\s*\)/);
  });

  it("grouped-FAQ row id pattern '::faq-pair::<hash>'", () => {
    expect(ROWS_SRC).toMatch(/faq-pair::\$\{hash\}/);
  });

  it("composeEditRowTitle drops the dangling 'an' on add_h2_section ('Add \"...\" H2', not 'Add an \"...\"')", () => {
    // Source: `Add ${q(label)} H2 to the ${targetLabel}` (no 'an').
    // Anchor to composeEditRowTitle's own block (the FIRST switch in
    // the file is `actionRowTypeForEdit` with empty case bodies; we
    // want the second one with the title-string returns).
    const composeBlock = ROWS_SRC.match(
      /export function composeEditRowTitle[\s\S]+?\n\}\s*\n/,
    );
    expect(composeBlock).not.toBeNull();
    const block = (composeBlock ?? [""])[0];
    expect(block).toMatch(/Add \$\{q\(label\)\} H2 to the/);
    expect(block).not.toMatch(/Add an \$\{q\(label\)\} H2/);
  });
});

// ── cleanDisplayLabel strips trailing noise parens ────────────────────

describe("W3 Step 3.15 — cleanDisplayLabel strips trailing noise tags", () => {
  it("declares the noise-tag set with (new), (new H2), (question), (answer)", () => {
    expect(HUMANIZER_SRC).toMatch(/NOISE_TAGS\s*=\s*new Set/);
    expect(HUMANIZER_SRC).toMatch(/"new"/);
    expect(HUMANIZER_SRC).toMatch(/"new h2"/);
    expect(HUMANIZER_SRC).toMatch(/"question"/);
    expect(HUMANIZER_SRC).toMatch(/"answer"/);
  });
});

// ── Drawer renders question + answer side-by-side for grouped FAQ ────

describe("W3 Step 3.15 — recommendations-client drawer renders Q + A for grouped FAQ rows", () => {
  it("derives an isGroupedFaq flag from row.actionType + faqAnswerText", () => {
    expect(CLIENT_SRC).toMatch(/isGroupedFaq/);
    expect(CLIENT_SRC).toMatch(/row\.actionType\s*===\s*"add_faq"/);
    expect(CLIENT_SRC).toMatch(/d\.faqAnswerText/);
  });

  it("renders a Question label + question pre block when isGroupedFaq", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-faq-question-label="true"/);
    expect(CLIENT_SRC).toMatch(/data-rec-faq-question="true"/);
  });

  it("renders an Answer label + answer pre block when isGroupedFaq", () => {
    expect(CLIENT_SRC).toMatch(/data-rec-faq-answer-label="true"/);
    expect(CLIENT_SRC).toMatch(/data-rec-faq-answer="true"/);
  });

  it("falls back to a single Proposed block for non-FAQ rows", () => {
    // The non-grouped branch keeps the legacy Proposed label + pre.
    expect(CLIENT_SRC).toMatch(/Proposed/);
  });
});
