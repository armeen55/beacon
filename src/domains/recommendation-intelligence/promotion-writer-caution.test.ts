import { describe, it, expect } from "vitest";

import { annotateCautionRows } from "./promotion-writer";
import type { DeterministicPromotionEditRow } from "./promotion-result-to-edit-row";

/**
 * E-39 D5 - the promotion writer ANNOTATES, it never DELETES. A page that is
 * mid-measurement or a live comparison page stays in the operator's queue with a
 * caution note attached, instead of being silently removed (the 2026-07-01 gate
 * behavior these tests replace).
 */
const row = (over: Partial<DeterministicPromotionEditRow> & { id: string; target_url: string }): DeterministicPromotionEditRow => ({
  tenant_id: "tenant-a",
  rec_id: "promotion-x",
  action_type: "edit_title",
  target_element_key: null,
  display_label: null,
  current_text: null,
  proposed_text: null,
  why: "why",
  evidence: [],
  expected_impact: null,
  difficulty: "low",
  confidence: "medium",
  measurement_plan: null,
  risks: [],
  source: "deterministic_promotion",
  provider_name: null,
  evidence_hash: "hash",
  model: null,
  cost_usd: 0,
  created_at: "2026-07-10T00:00:00.000Z",
  updated_at: "2026-07-10T00:00:00.000Z",
  implementation_status: "recommended",
  live_at: null,
  live_snapshot_id: null,
  live_match_confidence: null,
  live_match_kind: null,
  live_element_key: null,
  not_found_reason: null,
  ...over,
});

const CAUTION = "This page is a comparison page for a change I am still measuring, so I am flagging it.";

describe("annotateCautionRows - E-39 D5 annotate, never delete", () => {
  it("keeps EVERY row (never removes the operator's option) and appends the caution to the flagged one", () => {
    const rows = [
      row({ id: "1", target_url: "https://iranopedia.com/a" }), // mid-measurement -> flag
      row({ id: "2", target_url: "https://iranopedia.com/b" }), // clean -> untouched
    ];
    const out = annotateCautionRows(rows, new Map([["https://iranopedia.com/a", CAUTION]]));
    // Nothing removed - both options survive.
    expect(out.map((r) => r.id)).toEqual(["1", "2"]);
    expect(out[0].risks).toContain(CAUTION);
    expect(out[1].risks).toEqual([]); // the clean row is byte-identical
  });

  it("is idempotent - re-annotating never appends the same caution twice", () => {
    const once = annotateCautionRows(
      [row({ id: "1", target_url: "https://iranopedia.com/a" })],
      new Map([["https://iranopedia.com/a", CAUTION]]),
    );
    const twice = annotateCautionRows(once, new Map([["https://iranopedia.com/a", CAUTION]]));
    expect(twice[0].risks).toEqual([CAUTION]);
  });

  it("preserves an existing risk and adds the caution alongside it (never overwrites)", () => {
    const out = annotateCautionRows(
      [row({ id: "1", target_url: "https://iranopedia.com/a", risks: ["existing risk"] })],
      new Map([["https://iranopedia.com/a", CAUTION]]),
    );
    expect(out[0].risks).toEqual(["existing risk", CAUTION]);
  });

  it("no caution map -> rows pass through unchanged (byte-identical)", () => {
    const rows = [row({ id: "1", target_url: "https://iranopedia.com/a" })];
    expect(annotateCautionRows(rows, new Map())).toEqual(rows);
  });
});
