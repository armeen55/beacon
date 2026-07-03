import { describe, expect, it } from "vitest";
import { selectLeadStory } from "./lead-story";

describe("selectLeadStory", () => {
  it("returns null when every rule has nothing to say", () => {
    const result = selectLeadStory({ ledger: [], attention: [], tonightTopPick: null, moverDays: [] });
    expect(result).toBeNull();
  });

  it("picks the most recent landed verdict over everything else (won)", () => {
    const result = selectLeadStory({
      ledger: [
        { path: "/older", shippedAt: "2026-06-01T00:00:00Z", verdict: "won", pageLabel: "Older page" },
        { path: "/newer", shippedAt: "2026-06-20T00:00:00Z", verdict: "won", pageLabel: "Newer page" },
      ],
      attention: [{ title: "Alert", message: "Something broke", href: "/changes" }],
      tonightTopPick: { pageLabel: "Some page", whyNow: "why", headline: "headline" },
      moverDays: [{ date: "2026-06-29", clicks: 10 }, { date: "2026-06-30", clicks: 100 }],
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("landed_verdict");
    expect(result!.tone).toBe("good");
    expect(result!.sentence).toContain("Newer page");
    expect(result!.sentence).toContain("won");
    expect(result!.href).toBe("/results");
  });

  it("owns a lost verdict plainly, not hedged", () => {
    const result = selectLeadStory({
      ledger: [{ path: "/p", shippedAt: "2026-06-20T00:00:00Z", verdict: "lost", pageLabel: "The page" }],
      attention: [],
      tonightTopPick: null,
      moverDays: [],
    });
    expect(result!.kind).toBe("landed_verdict");
    expect(result!.tone).toBe("bad");
    expect(result!.sentence).toContain("did not work");
    expect(result!.sentence).toContain("what I learned");
  });

  it("ignores measuring/inconclusive/insufficient_data ledger rows for the verdict rule", () => {
    const result = selectLeadStory({
      ledger: [
        { path: "/a", shippedAt: "2026-06-30T00:00:00Z", verdict: "measuring" },
        { path: "/b", shippedAt: "2026-06-29T00:00:00Z", verdict: "inconclusive" },
      ],
      attention: [{ title: "Fix this", message: "It is broken", href: "/x" }],
      tonightTopPick: null,
      moverDays: [],
    });
    expect(result!.kind).toBe("fired_alert");
  });

  it("falls to the fired alert when there is no landed verdict", () => {
    const result = selectLeadStory({
      ledger: [],
      attention: [{ title: "Data pipe broke", message: "GSC wrote 0 rows", href: "/diagnostics" }],
      tonightTopPick: { pageLabel: "Page", whyNow: "why", headline: "headline" },
      moverDays: [{ date: "2026-06-29", clicks: 10 }, { date: "2026-06-30", clicks: 100 }],
    });
    expect(result!.kind).toBe("fired_alert");
    expect(result!.sentence).toContain("Data pipe broke");
    expect(result!.href).toBe("/diagnostics");
  });

  it("falls to tonight's top pick when there is no verdict or alert", () => {
    const result = selectLeadStory({
      ledger: [],
      attention: [],
      tonightTopPick: { pageLabel: "Contact page", whyNow: "It ranks 8th for a high-volume query.", headline: "Tighten the title on Contact page" },
      moverDays: [{ date: "2026-06-29", clicks: 10 }, { date: "2026-06-30", clicks: 100 }],
    });
    expect(result!.kind).toBe("tonight_pick");
    expect(result!.sentence).toContain("Tighten the title on Contact page");
    expect(result!.sentence).toContain("high-volume query");
  });

  it("falls to the biggest mover when nothing else has data", () => {
    const result = selectLeadStory({
      ledger: [],
      attention: [],
      tonightTopPick: null,
      moverDays: [
        { date: "2026-06-27", clicks: 50 },
        { date: "2026-06-28", clicks: 52 },
        { date: "2026-06-29", clicks: 200 },
        { date: "2026-06-30", clicks: 190 },
      ],
    });
    expect(result!.kind).toBe("biggest_mover");
    expect(result!.sentence).toContain("jumped");
    expect(result!.tone).toBe("good");
  });

  it("reports a drop as a warning, not a celebration", () => {
    const result = selectLeadStory({
      ledger: [],
      attention: [],
      tonightTopPick: null,
      moverDays: [
        { date: "2026-06-29", clicks: 200 },
        { date: "2026-06-30", clicks: 20 },
      ],
    });
    expect(result!.kind).toBe("biggest_mover");
    expect(result!.sentence).toContain("dropped");
    expect(result!.tone).toBe("warning");
  });

  it("never uses an em or en dash in any generated sentence", () => {
    const cases = [
      selectLeadStory({ ledger: [{ path: "/p", shippedAt: "2026-06-20T00:00:00Z", verdict: "won", pageLabel: "Page" }], attention: [], tonightTopPick: null, moverDays: [] }),
      selectLeadStory({ ledger: [{ path: "/p", shippedAt: "2026-06-20T00:00:00Z", verdict: "lost", pageLabel: "Page" }], attention: [], tonightTopPick: null, moverDays: [] }),
      selectLeadStory({ ledger: [], attention: [{ title: "Alert", message: "msg", href: "/x" }], tonightTopPick: null, moverDays: [] }),
      selectLeadStory({ ledger: [], attention: [], tonightTopPick: { pageLabel: "P", whyNow: "why", headline: "head" }, moverDays: [] }),
      selectLeadStory({ ledger: [], attention: [], tonightTopPick: null, moverDays: [{ date: "2026-06-29", clicks: 1 }, { date: "2026-06-30", clicks: 50 }] }),
    ];
    for (const c of cases) {
      expect(c).not.toBeNull();
      expect(c!.sentence).not.toMatch(/[—–]/);
    }
  });
});
