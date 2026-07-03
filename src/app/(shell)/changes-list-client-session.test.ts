/**
 * changes-list-client - D6 daily ritual loop wiring (session flow + keyboard).
 *
 * Source-pinning tests (this repo's convention for interactive client components with no
 * jsdom/@testing-library/react configured - see today-v2-visibility-group-client.test.tsx).
 * The pure advance-to-next-best logic and no-dead-end invariant are exhaustively covered at
 * the function level by session-flow.test.ts; these pins confirm changes-list-client.tsx
 * actually wires that logic into the real /changes list rather than reimplementing it, and
 * that it reuses the EXISTING mark-shipped/snooze server actions instead of inventing new
 * persistence for the D6 loop.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "changes-list-client.tsx"), "utf8");

describe("ChangesListClient - D6 session loop reuses existing affordances", () => {
  it("mounts useWorklistSession over the same ranked+filtered `visible` list every row renders", () => {
    // R20 added a second arg (the FP3 lifecycle counts) - still the SAME `visible` list, never
    // a re-ranked or re-filtered copy.
    expect(SRC).toMatch(/useWorklistSession\(\s*visible\s*,/);
  });

  it("R20 - feeds the session strip server-truth FP3 counts (ready / measuring / shipped this week), not re-derived numbers", () => {
    expect(SRC).toContain("ready: view.readyCount");
    expect(SRC).toContain("measuring: view.measuringCountCanonical");
    expect(SRC).toContain("shippedThisWeek: view.shippedThisWeekCount");
  });

  it("MoveCard's onAction (ship/stage/snooze) feeds the session loop, not a duplicate action", () => {
    expect(SRC).toMatch(/onAction=\{\(kind\) => onAction\?\.\(kind === "shipped" \? "done" : "skip"\)\}/);
  });

  it("the bare Skip button calls the SAME respondToRecommendation('deferred') server action MoveCard's snooze uses", () => {
    expect(SRC).toContain('respondToRecommendation(move.id, "deferred"');
  });

  it("the d keyboard shortcut calls the SAME respondToRecommendation('accepted') ship() uses, never a new write path", () => {
    expect(SRC).toContain('respondToRecommendation(move.id, "accepted", { targetPageUrl: move.targetUrl, actionType: move.action, query: move.query })');
  });

  it("d silently no-ops when there is no matching move, instead of fabricating a fake done state", () => {
    const idx = SRC.indexOf('e.key === "d"');
    const block = SRC.slice(idx, idx + 400);
    expect(block).toMatch(/if \(!move\) return;/);
  });
});

describe("ChangesListClient - no dead ends", () => {
  it("every row-list render site passes onAction so an action always reaches the session loop", () => {
    const rowUsages = SRC.match(/<Row\s/g) ?? [];
    const onActionWiring = SRC.match(/onAction=\{\(kind\) => rowAction\(c\.id, kind\)\}/g) ?? [];
    // Every <Row> render site in the 3 view modes (grouped, "other", flat) wires onAction.
    expect(onActionWiring.length).toBeGreaterThanOrEqual(3);
    expect(onActionWiring.length).toBe(rowUsages.length);
  });

  it("auto-scrolls to the next-best row once the session points at one", () => {
    expect(SRC).toMatch(/session\.nextBest[\s\S]{0,80}scrollIntoView/);
  });

  it("highlights the next-best row so the scroll target is visibly distinct", () => {
    expect(SRC).toMatch(/highlighted=\{session\.nextBest\?\.id === c\.id\}/);
  });
});

describe("ChangesListClient - keyboard (j/k/enter/d)", () => {
  it("j moves focus forward and k moves it back, clamped to the visible list bounds", () => {
    expect(SRC).toMatch(/e\.key === "j"[\s\S]{0,120}Math\.min\(i \+ 1, visible\.length - 1\)/);
    expect(SRC).toMatch(/e\.key === "k"[\s\S]{0,80}Math\.max\(i - 1, 0\)/);
  });

  it("ignores j/k/enter/d while the operator is typing in a text field", () => {
    expect(SRC).toContain("isTypingTarget(e.target)");
  });

  it("ignores modified keystrokes (cmd/ctrl/alt) so browser shortcuts still work", () => {
    expect(SRC).toMatch(/e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey/);
  });

  it("registers and cleans up the keydown listener on unmount", () => {
    expect(SRC).toContain('window.addEventListener("keydown", onKeyDown)');
    expect(SRC).toContain('window.removeEventListener("keydown", onKeyDown)');
  });
});
