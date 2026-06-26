import { describe, it, expect } from "vitest";
import { routeClarityFriction } from "./clarity-move-router";
import type { ClarityPageSignal } from "./clarity-page-signals";

function sig(over: Partial<ClarityPageSignal> = {}): ClarityPageSignal {
  return {
    url: "/p",
    sessions: 100,
    rageClicks: 0,
    deadClicks: 0,
    quickbacks: 0,
    excessiveScroll: 0,
    scriptErrors: 0,
    rageRate: 0,
    deadRate: 0,
    quickbackRate: 0,
    scrollDepthPct: 0.8,
    engagementSeconds: 60,
    ...over,
  };
}

describe("routeClarityFriction", () => {
  it("script errors → fix_js_errors (high, top priority — blocks crawlers)", () => {
    const d = routeClarityFriction(sig({ scriptErrors: 10, deadRate: 0.9 }))!; // errors win over dead
    expect(d.moveType).toBe("fix_js_errors");
    expect(d.severity).toBe("high");
  });

  it("dead clicks → fix_dead_click", () => {
    expect(routeClarityFriction(sig({ deadRate: 0.1 }))!.moveType).toBe("fix_dead_click");
  });

  it("rage clicks → fix_rage_interaction", () => {
    expect(routeClarityFriction(sig({ rageRate: 0.1 }))!.moveType).toBe("fix_rage_interaction");
  });

  it("quick-backs → fix_intent_mismatch", () => {
    expect(routeClarityFriction(sig({ quickbackRate: 0.5 }))!.moveType).toBe("fix_intent_mismatch");
  });

  it("shallow scroll → raise_answer (uses the previously-unused scroll-depth column)", () => {
    expect(routeClarityFriction(sig({ scrollDepthPct: 0.15 }))!.moveType).toBe("raise_answer");
  });

  it("below the session floor → null (no guess on thin data)", () => {
    expect(routeClarityFriction(sig({ sessions: 5, deadRate: 0.9 }))).toBeNull();
  });

  it("no clear friction → null", () => {
    expect(routeClarityFriction(sig())).toBeNull();
  });

  it("missing scroll-depth column → never claims raise_answer (fail closed)", () => {
    expect(routeClarityFriction(sig({ scrollDepthPct: null }))).toBeNull();
  });
});
