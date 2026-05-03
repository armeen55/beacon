/**
 * W3 Step 3.5c (2026-05-02) — display-state classifier tests.
 *
 * Pin the operator-locked semantics so the rec card UI keeps
 * routing recs to the right surface.
 */

import { describe, expect, it } from "vitest";
import {
  classifyRecDisplayState,
  effectiveTierForDisplay,
  REC_DISPLAY_STATE_LABEL,
  type ClassifierEdit,
} from "./display-state";

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 7 * 86_400_000).toISOString();

const HIGH_EDIT: ClassifierEdit = { implementation_status: "recommended" };
const ACCEPTED_EDIT: ClassifierEdit = { implementation_status: "accepted" };
const DISMISSED_EDIT: ClassifierEdit = { implementation_status: "dismissed" };

describe("classifyRecDisplayState — suppression rules", () => {
  it("response.dismissed → suppressed", () => {
    const state = classifyRecDisplayState({
      response: { status: "dismissed" },
      allEdits: [HIGH_EDIT],
      renderableEdits: [HIGH_EDIT],
    });
    expect(state).toBe("suppressed");
  });

  it("response.deferred AND defer window in the future → suppressed", () => {
    const state = classifyRecDisplayState({
      response: { status: "deferred", deferUntil: FUTURE },
      allEdits: [HIGH_EDIT],
      renderableEdits: [HIGH_EDIT],
    });
    expect(state).toBe("suppressed");
  });

  it("response.deferred AND defer window expired → falls through to edit-driven classification", () => {
    const state = classifyRecDisplayState({
      response: { status: "deferred", deferUntil: PAST },
      allEdits: [HIGH_EDIT],
      renderableEdits: [HIGH_EDIT],
    });
    expect(state).toBe("actionable_edit");
  });

  it("response.accepted → accepted_tracking (regardless of edit count)", () => {
    const state = classifyRecDisplayState({
      response: { status: "accepted" },
      allEdits: [HIGH_EDIT, ACCEPTED_EDIT],
      renderableEdits: [HIGH_EDIT, ACCEPTED_EDIT],
    });
    expect(state).toBe("accepted_tracking");
  });
});

describe("classifyRecDisplayState — manual_review", () => {
  it("needsHumanReview=true → manual_review (even with edits)", () => {
    const state = classifyRecDisplayState({
      needsHumanReview: true,
      response: null,
      allEdits: [HIGH_EDIT],
      renderableEdits: [HIGH_EDIT],
    });
    expect(state).toBe("manual_review");
  });

  it("split_or_separate_page action with no edits → manual_review", () => {
    const state = classifyRecDisplayState({
      resolvedAction: "split_or_separate_page",
      response: null,
      allEdits: [],
      renderableEdits: [],
    });
    expect(state).toBe("manual_review");
  });

  it("merge_or_dedupe action with no edits → manual_review", () => {
    const state = classifyRecDisplayState({
      resolvedAction: "merge_or_dedupe",
      response: null,
      allEdits: [],
      renderableEdits: [],
    });
    expect(state).toBe("manual_review");
  });
});

describe("classifyRecDisplayState — edit-driven", () => {
  it("renderableEdits.length > 0 → actionable_edit", () => {
    const state = classifyRecDisplayState({
      response: null,
      allEdits: [HIGH_EDIT],
      renderableEdits: [HIGH_EDIT],
    });
    expect(state).toBe("actionable_edit");
  });

  it("allEdits > 0 but renderableEdits === 0 → needs_fresh_edit", () => {
    const state = classifyRecDisplayState({
      response: null,
      allEdits: [DISMISSED_EDIT, DISMISSED_EDIT],
      renderableEdits: [],
    });
    expect(state).toBe("needs_fresh_edit");
  });

  it("no edits at all + non-manual-review action → backlog", () => {
    const state = classifyRecDisplayState({
      resolvedAction: "create_new_page",
      response: null,
      allEdits: [],
      renderableEdits: [],
    });
    expect(state).toBe("backlog");
  });
});

describe("effectiveTierForDisplay — needs_fresh_edit downgrades from NOW", () => {
  it("needs_fresh_edit + originalTier=now → this_week", () => {
    expect(
      effectiveTierForDisplay({
        originalTier: "now",
        displayState: "needs_fresh_edit",
      }),
    ).toBe("this_week");
  });

  it("actionable_edit + originalTier=now → now (unchanged)", () => {
    expect(
      effectiveTierForDisplay({
        originalTier: "now",
        displayState: "actionable_edit",
      }),
    ).toBe("now");
  });

  it("needs_fresh_edit + originalTier=this_week → this_week (no change)", () => {
    expect(
      effectiveTierForDisplay({
        originalTier: "this_week",
        displayState: "needs_fresh_edit",
      }),
    ).toBe("this_week");
  });
});

describe("REC_DISPLAY_STATE_LABEL — operator copy", () => {
  it("every state has an operator-readable label", () => {
    expect(REC_DISPLAY_STATE_LABEL.actionable_edit).toBe("Ready to ship");
    expect(REC_DISPLAY_STATE_LABEL.manual_review).toBe(
      "Needs your judgment",
    );
    expect(REC_DISPLAY_STATE_LABEL.needs_fresh_edit).toBe(
      "Needs fresh edit",
    );
    expect(REC_DISPLAY_STATE_LABEL.accepted_tracking).toBe("Tracking");
    expect(REC_DISPLAY_STATE_LABEL.backlog).toBe("Backlog");
    expect(REC_DISPLAY_STATE_LABEL.suppressed).toBe("Hidden");
  });

  it("no label uses internal jargon", () => {
    for (const label of Object.values(REC_DISPLAY_STATE_LABEL)) {
      expect(label.toLowerCase()).not.toMatch(/cluster/);
      expect(label.toLowerCase()).not.toMatch(/motive/);
      expect(label.toLowerCase()).not.toMatch(/fragmented/);
    }
  });
});
