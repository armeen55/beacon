import { describe, it, expect } from "vitest";
import {
  deriveTodayNextLine,
  isTodayDataTruthBlocked,
  isTodayTruthBlocked,
  type TodayNextLineInput,
} from "@/lib/today-next-line";

const base = (): TodayNextLineInput => ({
  isDemoMode: false,
  scanPhaseFailed: false,
  hasImportedVisibility: false,
  localUrgentStrip: null,
  localAttentionStrip: null,
  primaryAction: null,
  pendingFindings: [],
  allClear: true,
  crawlStale: false,
  visibilityStaleVsCrawl: false,
  coverageState: "fresh",
  coverageTone: "ok",
});

describe("isTodayTruthBlocked", () => {
  it("is true when scan phase failed even if coverage is fresh", () => {
    expect(
      isTodayTruthBlocked({
        scanPhaseFailed: true,
        crawlStale: false,
        visibilityStaleVsCrawl: false,
        coverageState: "fresh",
        coverageTone: "ok",
      }),
    ).toBe(true);
  });

  it("matches data-only gate from shouldShowTodayAllClear", () => {
    expect(
      isTodayDataTruthBlocked({
        crawlStale: true,
        visibilityStaleVsCrawl: false,
        coverageState: "fresh",
        coverageTone: "ok",
      }),
    ).toBe(true);
  });
});

describe("deriveTodayNextLine", () => {
  it("1 — demo mode wins over everything else", () => {
    const p = base();
    p.isDemoMode = true;
    p.scanPhaseFailed = true;
    p.localUrgentStrip = { href: "/local" };
    p.pendingFindings = [{ priority: "critical" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Import your data to begin tracking.");
    expect(r.href).toBe("/settings/import");
  });

  it("2 — truth (stale coverage) before local strips and primary", () => {
    const p = base();
    p.allClear = false;
    p.coverageState = "stale";
    p.localUrgentStrip = { href: "/local" };
    p.localAttentionStrip = { href: "/local" };
    p.primaryAction = {
      headline: "Fix title",
      href: "/pages",
      responseStatus: null,
    };
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Resolve stale coverage before acting.");
    expect(r.href).toBe("/pages");
  });

  it("2b — scan failed before local urgent", () => {
    const p = base();
    p.allClear = false;
    p.scanPhaseFailed = true;
    p.localUrgentStrip = { href: "/local" };
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Fix the failed scan before acting on recommendations.");
    expect(r.href).toBe("/pages");
  });

  it("2c — critical coverage copy", () => {
    const p = base();
    p.allClear = false;
    p.coverageState = "critical";
    p.localAttentionStrip = { href: "/local" };
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Fix data freshness before trusting recommendations.");
    expect(r.href).toBe("/pages");
  });

  it("2c-import — critical coverage with import uses same visibility-import next step", () => {
    const p = base();
    p.allClear = false;
    p.coverageState = "critical";
    p.hasImportedVisibility = true;
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Upload your latest visibility export before acting.");
    expect(r.href).toBe("/settings/import");
  });

  it("2d — partial sample uses refresh copy", () => {
    const p = base();
    p.allClear = false;
    p.coverageState = "partial";
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Refresh Beacon data before acting.");
  });

  it("3 — local urgent when truth is OK", () => {
    const p = base();
    p.localUrgentStrip = { href: "/local" };
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Review local issue → /local");
    expect(r.href).toBe("/local");
  });

  it("4 — attention strip before primary", () => {
    const p = base();
    p.localAttentionStrip = { href: "/local" };
    p.primaryAction = {
      headline: "Ship hero",
      href: "/pages/foo",
      responseStatus: null,
    };
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Check local presence → /local");
    expect(r.href).toBe("/local");
  });

  it("5 — pending primary before critical findings when truth OK", () => {
    const p = base();
    p.allClear = false;
    p.primaryAction = {
      headline: "Primary headline",
      href: "/topics/opportunity/x",
      responseStatus: null,
    };
    p.pendingFindings = [{ priority: "critical" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Primary headline");
    expect(r.href).toBe("/topics/opportunity/x");
  });

  it("5b — truth stale wins over critical finding queue", () => {
    const p = base();
    p.allClear = false;
    p.coverageState = "stale";
    p.pendingFindings = [{ priority: "critical" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Resolve stale coverage before acting.");
  });

  it("5b-import — stale truth with prior import points to Import", () => {
    const p = base();
    p.allClear = false;
    p.hasImportedVisibility = true;
    p.coverageState = "stale";
    p.pendingFindings = [{ priority: "critical" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Upload your latest visibility export before acting.");
    expect(r.href).toBe("/settings/import");
  });

  it("5c — accepted primary yields critical branch when truth OK", () => {
    const p = base();
    p.allClear = false;
    p.primaryAction = {
      headline: "Done",
      href: "/x",
      responseStatus: "accepted",
    };
    p.pendingFindings = [{ priority: "critical" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Review top critical finding");
    expect(r.href).toBe("/#today-findings");
  });

  it("7 — all clear", () => {
    const r = deriveTodayNextLine(base());
    expect(r.text).toBe("Next: Nothing required in Beacon today.");
    expect(r.href).toBeNull();
  });

  it("fallback — important-only queue, coverage fresh", () => {
    const p = base();
    p.allClear = false;
    p.pendingFindings = [{ priority: "important" }];
    const r = deriveTodayNextLine(p);
    expect(r.text).toBe("Next: Review findings in the queue below.");
    expect(r.href).toBe("/#today-findings");
  });
});
