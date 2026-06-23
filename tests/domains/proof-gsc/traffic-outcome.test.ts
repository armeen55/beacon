import { describe, it, expect } from "vitest";

import { computeTrafficOutcome } from "@/domains/proof-gsc/traffic-outcome";

const M = (sessions: number, engagedSessions: number, conversions: number) => ({
  sessions,
  engagedSessions,
  conversions,
});

describe("computeTrafficOutcome — Dollar-ROI proof (gap #1)", () => {
  it("control-adjusted sessions lift: treated up, control flat → positive adjusted", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7, // no pro-rating
      treatedPre: M(100, 80, 0),
      treatedPost: M(150, 120, 0), // +50%
      controls: [{ pre: M(100, 80, 0), post: M(100, 80, 0) }], // 0%
    });
    expect(o.sessionsPctChange).toBeCloseTo(0.5, 5);
    expect(o.controlSessionsPctChange).toBeCloseTo(0, 5);
    expect(o.adjustedSessionsPct).toBeCloseTo(0.5, 5);
    expect(o.ran).toBe(true);
    expect(o.hasData).toBe(true);
    expect(o.label).toContain("Visitor traffic (7 days):");
    expect(o.label).toContain("+50% visits vs similar pages");
  });

  it("does NOT claim 'vs similar pages' when no comparable controls contributed", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(100, 80, 0),
      treatedPost: M(150, 120, 0), // +50% treated-only
      controls: [], // no control pages had pre-window sessions
    });
    expect(o.controlSessionsPctChange).toBeNull();
    expect(o.adjustedSessionsPct).toBeCloseTo(0.5, 5); // falls back to treated-only
    expect(o.label).not.toContain("vs similar pages");
    expect(o.label).toContain("vs its own baseline (no comparison pages yet)");
  });

  it("pro-rates a 28d pre window to a 7d post window for a fair comparison", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 28,
      treatedPre: M(400, 0, 0), // 400 over 28d → 100 over 7d
      treatedPost: M(100, 0, 0), // matches the pro-rated pre → flat
      controls: [],
    });
    expect(o.treated.sessionsPre).toBe(100); // pro-rated
    expect(o.sessionsPctChange).toBeCloseTo(0, 5);
  });

  it("surfaces a conversions delta (pro-rated) when nonzero", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(100, 80, 2),
      treatedPost: M(120, 90, 9), // +7 conversions
      controls: [],
    });
    expect(o.conversionsDelta).toBe(7);
    expect(o.label).toContain("+7 sign-ups or sales");
  });

  it("early window (not a full proof window) is labeled 'so far ... early'", () => {
    const o = computeTrafficOutcome({
      windowDays: 2,
      ran: false,
      preWindowDays: 28,
      treatedPre: M(280, 0, 0),
      treatedPost: M(30, 0, 0),
      controls: [],
    });
    expect(o.ran).toBe(false);
    expect(o.hasData).toBe(true);
    expect(o.label).toContain("too soon to tell");
  });

  it("no elapsed window (windowDays 0) reads as measuring, never a -100% artifact", () => {
    const o = computeTrafficOutcome({
      windowDays: 0,
      ran: false,
      preWindowDays: 28,
      treatedPre: M(280, 0, 0), // pre exists but no post day yet
      treatedPost: M(0, 0, 0),
      controls: [],
    });
    expect(o.hasData).toBe(false);
    expect(o.sessionsPctChange).toBeNull(); // NOT -100%
    expect(o.label).toBe("Visitor traffic: too soon to tell, first results come a week after you ship");
  });

  it("post window with zero GA4 rows reads 'no GA4 data', not a fake swing", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(0, 0, 0),
      treatedPost: M(0, 0, 0),
      controls: [],
    });
    expect(o.hasData).toBe(false);
    expect(o.label).toBe("Visitor traffic: no data for this page yet");
  });

  it("never claims revenue (GA4 returns none for this property)", () => {
    const o = computeTrafficOutcome({
      windowDays: 7,
      ran: true,
      preWindowDays: 7,
      treatedPre: M(100, 80, 1),
      treatedPost: M(200, 160, 5),
      controls: [],
    });
    expect(o.hasRevenue).toBe(false);
    expect(o.label.toLowerCase()).not.toContain("revenue");
    expect(o.label).not.toContain("$");
  });
});
