/**
 * 2026-06-10 — operator-edit learning loop (P0 wall 7).
 * Pins: edit-rate math + the 90d window, the conservative downgrade
 * thresholds (≥5 shipped AND rate >0.5), the one-step confidence
 * downgrade + plain-English note, and id/identity stability.
 */

import { describe, it, expect } from "vitest";

import {
  computeEditFeedback,
  applyEditFeedbackToRow,
  EDIT_FEEDBACK_MIN_SHIPPED,
  type EditFeedbackSourceRow,
} from "@/domains/recommendation-intelligence/edit-feedback";
import type { DeterministicPromotionEditRow } from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";

const NOW = new Date("2026-06-10T12:00:00Z");

function src(over: Partial<EditFeedbackSourceRow> = {}): EditFeedbackSourceRow {
  return {
    action_type: "edit_title",
    implementation_status: "verified_live_modified",
    updated_at: "2026-06-01T00:00:00Z",
    live_at: "2026-06-01T00:00:00Z",
    ...over,
  };
}

function row(over: Partial<DeterministicPromotionEditRow> = {}): DeterministicPromotionEditRow {
  return {
    id: "promotion-x__edit_title__null",
    tenant_id: "t",
    rec_id: "promotion-x",
    action_type: "edit_title",
    target_url: "https://x.com/p",
    target_element_key: null,
    display_label: "Add a page title",
    current_text: null,
    proposed_text: "Draft",
    why: "why",
    evidence: [],
    expected_impact: null,
    difficulty: "low",
    confidence: "high",
    measurement_plan: null,
    risks: [],
    source: "deterministic_promotion",
    provider_name: null,
    evidence_hash: "h",
    model: null,
    cost_usd: 0,
    created_at: "2026-06-10T05:30:00Z",
    updated_at: "2026-06-10T05:30:00Z",
    implementation_status: "recommended",
    live_at: null,
    live_snapshot_id: null,
    live_match_confidence: null,
    live_match_kind: null,
    live_element_key: null,
    not_found_reason: null,
    ...over,
  } as DeterministicPromotionEditRow;
}

describe("computeEditFeedback", () => {
  it("computes per-type and overall edit rates from verified rows only", () => {
    const fb = computeEditFeedback(
      [
        src(), // modified
        src({ implementation_status: "verified_live" }),
        src({ action_type: "add_faq", implementation_status: "verified_live" }),
        src({ implementation_status: "recommended" }), // ignored
        src({ implementation_status: "dismissed" }), // ignored
      ],
      NOW,
    );
    expect(fb.byActionType.get("edit_title")).toEqual({
      asProposed: 1,
      modified: 1,
      editRate: 0.5,
    });
    expect(fb.byActionType.get("add_faq")!.editRate).toBe(0);
    expect(fb.overall.editRate).toBeCloseTo(1 / 3);
  });

  it("windows out rows older than 90 days", () => {
    const fb = computeEditFeedback(
      [src({ live_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" })],
      NOW,
    );
    expect(fb.byActionType.size).toBe(0);
    expect(fb.overall.editRate).toBeNull();
  });
});

describe("applyEditFeedbackToRow", () => {
  function feedbackWith(modified: number, asProposed: number) {
    return computeEditFeedback(
      [
        ...Array.from({ length: modified }, () => src()),
        ...Array.from({ length: asProposed }, () =>
          src({ implementation_status: "verified_live" }),
        ),
      ],
      NOW,
    );
  }

  it("downgrades high→medium with the plain-English note when rate >0.5 across ≥5 shipped", () => {
    const out = applyEditFeedbackToRow(row(), feedbackWith(4, 1)); // 0.8 across 5
    expect(out.confidence).toBe("medium");
    expect(out.risks.some((r) => r.includes("reworded 4 of the last 5"))).toBe(true);
    expect(out.id).toBe(row().id); // identity stable
  });

  it("downgrades medium→low", () => {
    const out = applyEditFeedbackToRow(row({ confidence: "medium" }), feedbackWith(5, 1));
    expect(out.confidence).toBe("low");
  });

  it("does NOT fire under the shipped threshold", () => {
    const out = applyEditFeedbackToRow(
      row(),
      feedbackWith(EDIT_FEEDBACK_MIN_SHIPPED - 2, 1), // 4 shipped
    );
    expect(out.confidence).toBe("high");
    expect(out.risks).toEqual([]);
  });

  it("does NOT fire at or under the 0.5 rate", () => {
    const out = applyEditFeedbackToRow(row(), feedbackWith(3, 3)); // exactly 0.5
    expect(out.confidence).toBe("high");
  });

  it("untracked action types pass through unchanged", () => {
    const out = applyEditFeedbackToRow(
      row({ action_type: "add_schema" as DeterministicPromotionEditRow["action_type"] }),
      feedbackWith(5, 0),
    );
    expect(out.confidence).toBe("high");
  });
});
