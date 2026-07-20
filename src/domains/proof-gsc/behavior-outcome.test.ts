import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  computeBehaviorOutcome,
  behaviorDataThroughBound,
  taskCompletionShare,
  elapsedPostDays,
  behaviorHasContent,
  isAnswerShapedAction,
  GA4_MIN_SESSIONS_PER_WINDOW,
  CLARITY_MIN_VISITS_PER_WINDOW,
  type BehaviorOutcome,
} from "./behavior-outcome";

describe("behaviorDataThroughBound (defect E: honest lower bound, never the max)", () => {
  it("stamps the EARLIER source when both GA4 and Clarity have data", () => {
    // GA4 reaches the 19th, Clarity only the 17th; the fused read is honest only
    // through the 17th (the exact production defect: a 07-19 stamp over a GSC
    // verdict basis that ended 07-17).
    expect(behaviorDataThroughBound("2026-07-19", "2026-07-17")).toBe("2026-07-17");
    expect(behaviorDataThroughBound("2026-07-15", "2026-07-18")).toBe("2026-07-15");
  });
  it("uses the one source present when the other is null", () => {
    expect(behaviorDataThroughBound("2026-07-19", null)).toBe("2026-07-19");
    expect(behaviorDataThroughBound(null, "2026-07-17")).toBe("2026-07-17");
  });
  it("is null when neither source has landed yet", () => {
    expect(behaviorDataThroughBound(null, null)).toBeNull();
  });
});

/**
 * behavior-outcome.test.ts (BEACON_500 N4 + N17) - pins the sample floors
 * (never a verdict from 12 sessions), the live_at window math, every composite
 * sentence variant, the task-completion arithmetic including the quick-back
 * adjustment, the answer-shaped delta line, the self-hiding rule, and the
 * dash-clean rule.
 */

type Args = Parameters<typeof computeBehaviorOutcome>[0];

function args(over: Partial<Args> = {}): Args {
  return {
    windowDays: 14,
    preWindowDays: 28,
    actionType: "edit_title",
    ga4Pre: { sessions: 214, engagedSessions: 140, conversions: 0 },
    ga4Post: { sessions: 230, engagedSessions: 160, conversions: 0 },
    clarityPre: { visits: 300, rageClicks: 20, deadClicks: 25, quickbacks: 30 },
    clarityPost: { visits: 280, rageClicks: 8, deadClicks: 10, quickbacks: 28 },
    dataThrough: "2026-06-30",
    ...over,
  };
}

const CLARITY_ZERO = { visits: 0, rageClicks: 0, deadClicks: 0, quickbacks: 0 };

// ── sample floors: honest null per metric per window ─────────────────────────

describe("sample floors", () => {
  it("a GA4 window below 50 sessions nulls every GA4 metric for that window only", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: GA4_MIN_SESSIONS_PER_WINDOW - 1, engagedSessions: 40, conversions: 3 },
      }),
    );
    expect(r.engagedSharePre).toBeNull();
    expect(r.conversionsPre).toBeNull();
    // The post window cleared its own floor and stays readable.
    expect(r.engagedSharePost).not.toBeNull();
  });

  it("a GA4 window at exactly 50 sessions clears the floor", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: GA4_MIN_SESSIONS_PER_WINDOW, engagedSessions: 30, conversions: 0 },
      }),
    );
    expect(r.engagedSharePre).toBeCloseTo(0.6, 5);
  });

  it("a Clarity window below 100 visits nulls every Clarity metric for that window", () => {
    const r = computeBehaviorOutcome(
      args({
        clarityPre: { visits: CLARITY_MIN_VISITS_PER_WINDOW - 1, rageClicks: 5, deadClicks: 5, quickbacks: 10 },
      }),
    );
    expect(r.frustrationPer100Pre).toBeNull();
    expect(r.quickbackSharePre).toBeNull();
    expect(r.frustrationPer100Post).not.toBeNull();
  });

  it("12 sessions never produce a verdict: everything null, composite none, no sentence", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 12, engagedSessions: 2, conversions: 0 },
        ga4Post: { sessions: 12, engagedSessions: 11, conversions: 0 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.engagedSharePre).toBeNull();
    expect(r.engagedSharePost).toBeNull();
    expect(r.compositeVerdict).toBe("none");
    expect(r.sentence).toBeNull();
    expect(r.taskCompletionLine).toBeNull();
    expect(behaviorHasContent(r)).toBe(false);
  });
});

// ── window math from live_at ─────────────────────────────────────────────────

describe("elapsedPostDays (the live_at clock)", () => {
  it("counts ship day..latest source day inclusive", () => {
    expect(elapsedPostDays("2026-06-01", "2026-06-01", 28)).toBe(1);
    expect(elapsedPostDays("2026-06-01", "2026-06-14", 28)).toBe(14);
  });

  it("is 0 before any post-ship source day exists (never a fake window)", () => {
    expect(elapsedPostDays("2026-06-01", "2026-05-31", 28)).toBe(0);
    expect(elapsedPostDays("2026-06-01", null, 28)).toBe(0);
  });

  it("caps at the largest proof window", () => {
    expect(elapsedPostDays("2026-06-01", "2026-07-15", 28)).toBe(28);
  });

  it("windowDays 0 yields ran false and an all-null outcome", () => {
    const r = computeBehaviorOutcome(args({ windowDays: 0 }));
    expect(r.ran).toBe(false);
    expect(r.engagedSharePre).toBeNull();
    expect(r.frustrationPer100Post).toBeNull();
    expect(r.compositeVerdict).toBe("none");
    expect(r.sentence).toBeNull();
    expect(behaviorHasContent(r)).toBe(false);
  });

  it("pro-rates pre conversions to the post window length", () => {
    const r = computeBehaviorOutcome(
      args({
        windowDays: 14,
        preWindowDays: 28,
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 2 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 8 },
      }),
    );
    expect(r.conversionsPre).toBeCloseTo(1, 5); // 2 over 28d -> 1 over 14d
    expect(r.conversionsPost).toBe(8);
  });
});

// ── composite sentence variants ──────────────────────────────────────────────

describe("composite sentence", () => {
  it("better: engagement up and frustration down, with the sample receipt", () => {
    const r = computeBehaviorOutcome(args());
    expect(r.compositeVerdict).toBe("better");
    expect(r.sentence).toBe(
      "Visitors behave better since the change: engaged visits up 6 percent, frustrated clicks down 57 percent. Read on 214 visits before the change and 230 after.",
    );
  });

  it("worse: engagement down with Clarity below floor still reads honestly", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 140, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 112, conversions: 0 },
        clarityPre: { visits: 50, rageClicks: 1, deadClicks: 1, quickbacks: 1 },
        clarityPost: { visits: 50, rageClicks: 1, deadClicks: 1, quickbacks: 1 },
      }),
    );
    expect(r.compositeVerdict).toBe("worse");
    expect(r.sentence).toBe(
      "Visitors behave worse since the change: engaged visits down 20 percent. Read on 200 visits before the change and 200 after.",
    );
  });

  it("mixed: engagement up but frustration up names both sides", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 144, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
        clarityPost: { visits: 200, rageClicks: 20, deadClicks: 20, quickbacks: 20 },
      }),
    );
    expect(r.compositeVerdict).toBe("mixed");
    expect(r.sentence).toBe(
      "Mixed read on visitors since the change: engaged visits up 20 percent, but frustrated clicks up 100 percent. Read on 200 visits before the change and 200 after.",
    );
  });

  it("same: every lane flat says so plainly", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
        clarityPost: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
      }),
    );
    expect(r.compositeVerdict).toBe("same");
    expect(r.sentence).toBe(
      "Visitors behave about the same since the change. Read on 200 visits before the change and 200 after.",
    );
  });

  it("conversions lane: a real conversion gain reads better in plain words", () => {
    const r = computeBehaviorOutcome(
      args({
        windowDays: 14,
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 2 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 8 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.compositeVerdict).toBe("better");
    expect(r.sentence).toBe(
      "Visitors behave better since the change: 7 more sign-ups or sales. Read on 200 visits before the change and 200 after.",
    );
  });

  it("conversions below the volume floor stay flat (no verdict from 3 conversions)", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 3 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.compositeVerdict).toBe("same");
  });

  it("the sample receipt falls back to Clarity visits when GA4 is below floor", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 10, engagedSessions: 5, conversions: 0 },
        ga4Post: { sessions: 10, engagedSessions: 5, conversions: 0 },
        clarityPre: { visits: 300, rageClicks: 30, deadClicks: 30, quickbacks: 30 },
        clarityPost: { visits: 250, rageClicks: 5, deadClicks: 5, quickbacks: 25 },
      }),
    );
    expect(r.sentence).toContain("Read on 300 visits before the change and 250 after.");
  });

  it("small share moves stay flat: a 2 percent engagement wiggle is not a direction", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 1000, engagedSessions: 600, conversions: 0 },
        ga4Post: { sessions: 1000, engagedSessions: 612, conversions: 0 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.compositeVerdict).toBe("same");
  });
});

// ── N17 task completion ──────────────────────────────────────────────────────

describe("taskCompletionShare (N17)", () => {
  it("is the engaged share adjusted down by the quick-back share", () => {
    expect(taskCompletionShare(0.8, 0.125)).toBeCloseTo(0.7, 10);
    expect(taskCompletionShare(0.6, 0)).toBeCloseTo(0.6, 10);
    expect(taskCompletionShare(0.6, 1)).toBe(0);
  });

  it("is null unless BOTH inputs cleared their floors", () => {
    expect(taskCompletionShare(null, 0.1)).toBeNull();
    expect(taskCompletionShare(0.8, null)).toBeNull();
    expect(taskCompletionShare(null, null)).toBeNull();
  });

  it("renders the X in 10 card line from the post window", () => {
    const r = computeBehaviorOutcome(
      args({
        ga4Post: { sessions: 200, engagedSessions: 160, conversions: 0 },
        clarityPost: { visits: 160, rageClicks: 0, deadClicks: 0, quickbacks: 20 },
      }),
    );
    // engaged 0.8, quick-back 0.125 -> 0.7 -> 7 in 10.
    expect(r.taskCompletionSharePost).toBeCloseTo(0.7, 10);
    expect(r.taskCompletionLine).toBe(
      "About 7 in 10 visitors who land here appear to find what they came for.",
    );
  });

  it("has honest edge wording at the extremes", () => {
    const high = computeBehaviorOutcome(
      args({
        ga4Post: { sessions: 200, engagedSessions: 196, conversions: 0 },
        clarityPost: { visits: 200, rageClicks: 0, deadClicks: 0, quickbacks: 0 },
      }),
    );
    expect(high.taskCompletionLine).toBe(
      "Nearly all visitors who land here appear to find what they came for.",
    );
    const low = computeBehaviorOutcome(
      args({
        ga4Post: { sessions: 200, engagedSessions: 8, conversions: 0 },
        clarityPost: { visits: 200, rageClicks: 0, deadClicks: 0, quickbacks: 10 },
      }),
    );
    expect(low.taskCompletionLine).toBe(
      "Very few visitors who land here appear to find what they came for.",
    );
  });

  it("is null (no line) when Clarity is below floor, even with plenty of GA4 data", () => {
    const r = computeBehaviorOutcome(
      args({
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(r.taskCompletionSharePre).toBeNull();
    expect(r.taskCompletionSharePost).toBeNull();
    expect(r.taskCompletionLine).toBeNull();
  });
});

// ── N17 answer-shaped delta line ─────────────────────────────────────────────

describe("answer delta line (answer-shaped changes only)", () => {
  const answerArgs = (over: Partial<Args> = {}): Args =>
    args({
      actionType: "add_answer_block",
      // pre: engaged 0.75, quick-back 0.2 -> 0.6
      ga4Pre: { sessions: 200, engagedSessions: 150, conversions: 0 },
      clarityPre: { visits: 200, rageClicks: 5, deadClicks: 5, quickbacks: 40 },
      // post: engaged 0.7, quick-back 0 -> 0.7
      ga4Post: { sessions: 250, engagedSessions: 175, conversions: 0 },
      clarityPost: { visits: 250, rageClicks: 5, deadClicks: 5, quickbacks: 0 },
      ...over,
    });

  it("names the before/after tenths when more people find their answer", () => {
    const r = computeBehaviorOutcome(answerArgs());
    expect(r.taskCompletionSharePre).toBeCloseTo(0.6, 10);
    expect(r.taskCompletionSharePost).toBeCloseTo(0.7, 10);
    expect(r.answerDeltaLine).toBe(
      "More people are finding their answer since the change: 6 in 10 before, 7 in 10 after.",
    );
  });

  it("owns a drop plainly", () => {
    const r = computeBehaviorOutcome(
      answerArgs({
        // post: engaged 0.6, quick-back 0.15 -> 0.51 -> 5 in 10 (was 6)
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 0 },
        clarityPost: { visits: 200, rageClicks: 5, deadClicks: 5, quickbacks: 30 },
      }),
    );
    expect(r.answerDeltaLine).toBe(
      "Fewer people are finding their answer since the change: 6 in 10 before, 5 in 10 after.",
    );
  });

  it("says about the same when the tenths did not move", () => {
    const r = computeBehaviorOutcome(
      answerArgs({
        // post: engaged 0.75, quick-back 0.2 -> 0.6, same as pre
        ga4Post: { sessions: 200, engagedSessions: 150, conversions: 0 },
        clarityPost: { visits: 200, rageClicks: 5, deadClicks: 5, quickbacks: 40 },
      }),
    );
    expect(r.answerDeltaLine).toBe(
      "About the same share of people are finding their answer: 6 in 10 before and after.",
    );
  });

  it("never renders for a non-answer change even with both windows readable", () => {
    const r = computeBehaviorOutcome(answerArgs({ actionType: "edit_title" }));
    expect(r.answerDeltaLine).toBeNull();
  });

  it("never renders when either window is below its floors", () => {
    const r = computeBehaviorOutcome(answerArgs({ clarityPre: CLARITY_ZERO }));
    expect(r.answerDeltaLine).toBeNull();
  });

  it("isAnswerShapedAction covers answer blocks and FAQs, not titles or links", () => {
    expect(isAnswerShapedAction("add_answer_block")).toBe(true);
    expect(isAnswerShapedAction("ADD_FAQ")).toBe(true);
    expect(isAnswerShapedAction("faq_schema")).toBe(true);
    expect(isAnswerShapedAction("edit_title")).toBe(false);
    expect(isAnswerShapedAction("add_internal_link")).toBe(false);
    expect(isAnswerShapedAction("")).toBe(false);
  });
});

// ── self-hiding rule ─────────────────────────────────────────────────────────

describe("behaviorHasContent (the self-hiding rule)", () => {
  it("false for null/undefined and for an all-null outcome", () => {
    expect(behaviorHasContent(null)).toBe(false);
    expect(behaviorHasContent(undefined)).toBe(false);
    const empty = computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 0, engagedSessions: 0, conversions: 0 },
        ga4Post: { sessions: 0, engagedSessions: 0, conversions: 0 },
        clarityPre: CLARITY_ZERO,
        clarityPost: CLARITY_ZERO,
      }),
    );
    expect(behaviorHasContent(empty)).toBe(false);
  });

  it("true as soon as any line exists", () => {
    expect(behaviorHasContent(computeBehaviorOutcome(args()))).toBe(true);
  });
});

// ── copy guard ───────────────────────────────────────────────────────────────

describe("copy guard - dash-clean, no lab words", () => {
  const allOutcomes = (): BehaviorOutcome[] => [
    computeBehaviorOutcome(args()),
    computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 140, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 112, conversions: 0 },
      }),
    ),
    computeBehaviorOutcome(
      args({
        actionType: "add_answer_block",
        ga4Pre: { sessions: 200, engagedSessions: 150, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 5, deadClicks: 5, quickbacks: 40 },
        ga4Post: { sessions: 250, engagedSessions: 175, conversions: 0 },
        clarityPost: { visits: 250, rageClicks: 5, deadClicks: 5, quickbacks: 0 },
      }),
    ),
    computeBehaviorOutcome(
      args({
        ga4Pre: { sessions: 200, engagedSessions: 120, conversions: 0 },
        ga4Post: { sessions: 200, engagedSessions: 120, conversions: 0 },
        clarityPre: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
        clarityPost: { visits: 200, rageClicks: 10, deadClicks: 10, quickbacks: 20 },
      }),
    ),
  ];

  it("no em or en dashes in any generated line", () => {
    for (const r of allOutcomes()) {
      for (const line of [r.sentence, r.taskCompletionLine, r.answerDeltaLine]) {
        if (line != null) expect(line).not.toMatch(/[–—]/);
      }
    }
  });

  it("no lab jargon in any generated line (no pogo-stick, no engaged sessions, no quickback)", () => {
    for (const r of allOutcomes()) {
      for (const line of [r.sentence, r.taskCompletionLine, r.answerDeltaLine]) {
        if (line != null) {
          expect(line.toLowerCase()).not.toContain("pogo");
          expect(line.toLowerCase()).not.toContain("engaged session");
          expect(line.toLowerCase()).not.toContain("quickback");
          expect(line.toLowerCase()).not.toContain("serp");
        }
      }
    }
  });

  it("behavior-outcome.ts source contains no em or en dashes", () => {
    const src = readFileSync(join(__dirname, "behavior-outcome.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
