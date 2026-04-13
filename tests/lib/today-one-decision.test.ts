import { describe, it, expect } from "vitest";
import {
  deriveTodayOneDecision,
  type TodayOneDecisionInput,
} from "@/lib/today-one-decision";

const base = (): TodayOneDecisionInput => ({
  isDemoMode: false,
  scanPhaseFailed: false,
  hasImportedVisibility: false,
  crawlStale: false,
  visibilityStaleVsCrawl: false,
  coverageState: "fresh",
  coverageTone: "ok",
  localUrgentStrip: null,
  localAttentionStrip: null,
  primaryAction: null,
  pendingFindings: [],
  allClear: true,
});

describe("deriveTodayOneDecision", () => {
  it("demo → load your own data", () => {
    const p = base();
    p.isDemoMode = true;
    const d = deriveTodayOneDecision(p);
    expect(d.shouldAct).toBe(true);
    expect(d.title).toContain("own data");
    expect(d.href).toBe("/settings/import");
  });

  it("scan failed beats local + primary", () => {
    const p = base();
    p.scanPhaseFailed = true;
    p.localUrgentStrip = {
      title: "Local crisis",
      body: "x",
      href: "/local",
    };
    p.primaryAction = {
      headline: "Add schema",
      href: "/topics/x",
    };
    const d = deriveTodayOneDecision(p);
    expect(d.title).toMatch(/crawl/i);
    expect(d.href).toBe("/pages");
    expect(d.shouldAct).toBe(true);
  });

  it("stale visibility + prior import beats local + headline suggestion", () => {
    const p = base();
    p.allClear = false;
    p.hasImportedVisibility = true;
    p.visibilityStaleVsCrawl = true;
    p.localAttentionStrip = { headline: "Local NAP", href: "/local" };
    p.primaryAction = {
      headline: "Add FAQ schema",
      href: "/pages/foo",
    };
    const d = deriveTodayOneDecision(p);
    expect(d.title).toMatch(/visibility export|upload/i);
    expect(d.href).toBe("/settings/import");
    expect(d.why).toMatch(/wait/i);
    expect(d.shouldAct).toBe(true);
  });

  it("local urgent beats attention + primary when truth ok", () => {
    const p = base();
    p.allClear = false;
    p.localUrgentStrip = {
      title: "Fix phone on Yelp",
      body: "detail",
      href: "/local",
    };
    p.localAttentionStrip = { headline: "Reviews aging", href: "/local" };
    p.primaryAction = { headline: "Schema", href: "/x" };
    const d = deriveTodayOneDecision(p);
    expect(d.title).toBe("Fix phone on Yelp");
    expect(d.href).toBe("/local");
  });

  it("local attention when no urgent", () => {
    const p = base();
    p.allClear = false;
    p.localAttentionStrip = { headline: "Listing drift", href: "/local" };
    p.primaryAction = { headline: "Schema", href: "/x" };
    const d = deriveTodayOneDecision(p);
    expect(d.title).toBe("Listing drift");
    expect(d.shouldAct).toBe(true);
  });

  it("primary headline when nothing else gates", () => {
    const p = base();
    p.allClear = false;
    p.primaryAction = {
      headline: "Ship Service schema",
      href: "/topics/opportunity/1",
    };
    const d = deriveTodayOneDecision(p);
    expect(d.title).toBe("Ship Service schema");
    expect(d.href).toBe("/topics/opportunity/1");
    expect(d.shouldAct).toBe(true);
  });

  it("all clear → no", () => {
    const d = deriveTodayOneDecision(base());
    expect(d.shouldAct).toBe(false);
    expect(d.title).toMatch(/nothing/i);
    expect(d.whatWouldChangeThis).toBeTruthy();
    expect(d.firstStep).toBeNull();
  });
});
