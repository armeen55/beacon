/**
 * Revert policy boundary suite (Core 100K Phase 6; sole survivor of the
 * autopilot test group, per the operator product spec E-36: "NEVER
 * auto-revert; ask first").
 *
 * Pins the ladder hard: decideRevert can ONLY ever return "propose" (a
 * negative reading with a snapshot at day >= 7, one operator click) or
 * "none". No automatic action exists, no matter how the reading or the
 * autopilot config would have qualified under the old rules. Plus: lesson
 * copy is first person, carries the number, no em/en dashes, no lab words.
 */

import { describe, it, expect } from "vitest";

import {
  decideRevert,
  buildLessonLine,
  plainLiftLabel,
  leverPhrase,
  restoredNoun,
  type RevertDecisionInput,
} from "@/domains/autopilot/revert-policy";
import { DEFAULT_AUTOPILOT_CONFIG } from "@/domains/autopilot/autopilot-policy";

const NOW = new Date("2026-07-02T09:00:00Z");
const ARMED = { ...DEFAULT_AUTOPILOT_CONFIG, enabled: true };

function input(partial: Partial<RevertDecisionInput> = {}): RevertDecisionInput {
  return {
    tenantId: "tenant-iranopedia",
    direction: "negative",
    windowDay: 14,
    attributionQuality: "clean",
    lever: "edit_title",
    config: ARMED,
    snapshotAvailable: true,
    alreadyReverted: false,
    now: NOW,
    liftLabel: null,
    ...partial,
  };
}

describe("decideRevert - E-36: never auto, always ask first", () => {
  it("a clean negative at day 14 under a fully armed policy is still just a PROPOSAL", () => {
    const d = decideRevert(input());
    expect(d.action).toBe("propose");
    expect(d.reason).toContain("14 day check");
    expect(d.reason).toContain("never put a change back on my own");
    expect(d.lessonLine).not.toBe("");
  });

  it("day 7 negative is a proposal too (directional only)", () => {
    const d = decideRevert(input({ windowDay: 7 }));
    expect(d.action).toBe("propose");
    expect(d.reason).toContain("One click");
    expect(d.reason).toContain("7 day check");
  });

  it("confirmation-required pin: no input combination ever yields anything but propose or none", () => {
    // Exhaustively vary every input that used to feed the auto_revert branch.
    // If a future change reintroduces an automatic action, this fails loudly.
    const windowDays = [7, 14, 21, 28, 60];
    const attributions: Array<"clean" | "limited" | "compound"> = [
      "clean",
      "limited",
      "compound",
    ];
    const configs = [ARMED, { ...ARMED, enabled: false }, null, { ...ARMED, leverAllowlist: [] }];
    for (const windowDay of windowDays) {
      for (const attributionQuality of attributions) {
        for (const config of configs) {
          const d = decideRevert(input({ windowDay, attributionQuality, config }));
          expect(["propose", "none"]).toContain(d.action);
        }
      }
    }
  });
});

describe("decideRevert - the none gates (most conservative wins)", () => {
  it("Ritz never gets a revert offer, even fully eligible otherwise", () => {
    const d = decideRevert(input({ tenantId: "tenant-ritz-founder" }));
    expect(d.action).toBe("none");
    expect(d.reason).toContain("advise only");
  });

  it("already reverted = none (never revert twice)", () => {
    const d = decideRevert(input({ alreadyReverted: true }));
    expect(d.action).toBe("none");
    expect(d.reason).toContain("already");
  });

  it("positive or neutral readings = none", () => {
    expect(decideRevert(input({ direction: "positive" })).action).toBe("none");
    expect(decideRevert(input({ direction: "neutral" })).action).toBe("none");
  });

  it("no closed window = none (too early)", () => {
    expect(decideRevert(input({ windowDay: null })).action).toBe("none");
  });

  it("no snapshot = none even for a mature negative (hand rollback only)", () => {
    const d = decideRevert(input({ windowDay: 28, snapshotAvailable: false }));
    expect(d.action).toBe("none");
    expect(d.reason).toContain("by hand");
  });
});

describe("lesson line + copy rules", () => {
  it("names the lever, the restore, the date, the lesson, and the concrete number", () => {
    const line = buildLessonLine({ lever: "edit_title", now: NOW });
    expect(line).toContain("That title change hurt the click rate");
    expect(line).toContain("I put the old title back on July 2");
    expect(line).toContain("Lesson:");
    const withNumber = buildLessonLine({
      lever: "edit_title",
      now: NOW,
      liftLabel: "0.4 percentage points of click rate",
    });
    expect(withNumber).toContain("0.4 percentage points of click rate behind comparison pages");
    const d = decideRevert(input({ windowDay: 7, liftLabel: "3 clicks" }));
    expect(d.reason).toContain("3 clicks behind");
  });

  it("never emits an em or en dash and never says control/experiment/baseline", () => {
    const cases = [
      decideRevert(input()),
      decideRevert(input({ windowDay: 7 })),
      decideRevert(input({ direction: "positive" })),
      decideRevert(input({ snapshotAvailable: false })),
      decideRevert(input({ alreadyReverted: true })),
      decideRevert(input({ tenantId: "tenant-ritz-founder" })),
      decideRevert(input({ lever: "add_answer_block", windowDay: 28 })),
    ];
    for (const d of cases) {
      for (const text of [d.reason, d.lessonLine]) {
        expect(text).not.toMatch(/[\u2013\u2014]/);
        expect(text).not.toMatch(/\bcontrols?\b/i);
        expect(text).not.toMatch(/\bexperiments?\b/i);
        expect(text).not.toMatch(/\bbaselines?\b/i);
      }
    }
  });

  it("plain helpers format numbers and lever phrases plainly", () => {
    expect(plainLiftLabel("clicks", -3.4)).toBe("3 clicks");
    expect(plainLiftLabel("ctr", -0.004)).toBe("0.4 percentage points of click rate");
    expect(plainLiftLabel("position", -1.23)).toBe("1.2 spots in ranking");
    expect(plainLiftLabel("clicks", 2)).toBeNull();
    expect(plainLiftLabel("ctr", Number.NaN)).toBeNull();
    expect(leverPhrase("edit_meta")).toBe("description change");
    expect(leverPhrase("something_new")).toBe("change");
    expect(restoredNoun("edit_meta")).toBe("the old description");
  });
});
