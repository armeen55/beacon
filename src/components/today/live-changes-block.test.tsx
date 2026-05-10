/**
 * LiveChangesBlock — narrow render tests. Audit Correction #1
 * follow-up (2026-05-08).
 *
 * Test contract:
 *   1. Renders when verified_live live change exists (lifecycle block
 *      shows up on /today).
 *   2. Renders `null` when no live changes exist (calm empty state).
 *   3. Never claims the change is validated/proven/confirmed/winning.
 *   4. Surfaces the dynamic state line + next-evidence line for each row.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { LiveChangesBlock } from "./live-changes-block";
import type { TodayLiveChange } from "@/domains/today/live-changes-data";

function buildChange(over: Partial<TodayLiveChange> = {}): TodayLiveChange {
  return {
    recEditId: "edit-1",
    recId: "rec-whole-home-h2",
    actionType: "add_h2_section",
    targetUrl: "/services/whole-home-remodel",
    displayLabel: "H2: Architect-led design-build advantage",
    topicTargeted: "Whole Home Renovation Builders (Bay Area)",
    liveAt: "2026-04-28T05:26:26.05+00:00",
    daysSinceLive: 10,
    liveMatchKind: "exact",
    liveMatchConfidence: "high",
    currentVerdict: null,
    stateLine: "Live change detected — Beacon is collecting post-change readings.",
    nextEvidenceLine: "Confidence updates as new daily observations accumulate.",
    changelogId: "cl-mogzw78nv8pu54",
    ...over,
  };
}

describe("LiveChangesBlock", () => {
  it("renders the block when at least one live change exists", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange()]} />,
    );
    expect(html).toContain("Live changes");
    expect(html).toContain("Architect-led design-build advantage");
    expect(html).toContain("/services/whole-home-remodel");
    expect(html).toContain('data-today-live-changes="true"');
    expect(html).toContain("Live 10 days ago");
  });

  it("renders null (empty string) when no live changes exist", () => {
    expect(renderToStaticMarkup(<LiveChangesBlock liveChanges={[]} />)).toBe("");
  });

  it("surfaces the dynamic state + next-evidence lines per row", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange()]} />,
    );
    expect(html).toContain("Live change detected");
    expect(html).toContain("collecting post-change readings");
    expect(html).toContain("Confidence updates as new daily observations");
    expect(html).toContain('data-today-live-change-state="true"');
    expect(html).toContain('data-today-live-change-next="true"');
  });

  it("uses a 'View details' link to /changes/[id] when changelogId exists", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange()]} />,
    );
    expect(html).toContain("/changes/cl-mogzw78nv8pu54");
    expect(html).toContain("View details");
  });

  it("falls back to /changes when changelogId is null", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock
        liveChanges={[buildChange({ changelogId: null })]}
      />,
    );
    // Loose check: the link goes to /changes (not /changes/null).
    expect(html).not.toContain("/changes/null");
    expect(html).toContain('href="/changes"');
  });

  it("renders 'Live today' for daysSinceLive=0 and 'Live 1 day ago' for daysSinceLive=1", () => {
    const today = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange({ daysSinceLive: 0 })]} />,
    );
    expect(today).toContain("Live today");

    const oneDay = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange({ daysSinceLive: 1 })]} />,
    );
    expect(oneDay).toContain("Live 1 day ago");
  });

  it("never claims validated/proven/confirmed/winning across all verdict copy", () => {
    const verdicts: Array<{
      stateLine: string;
      nextEvidenceLine: string;
    }> = [
      // Pre-verdict (general)
      {
        stateLine:
          "Live change detected — Beacon is collecting post-change readings.",
        nextEvidenceLine:
          "Confidence updates as new daily observations accumulate.",
      },
      // helping
      {
        stateLine: "Sustained lift detected across post-change readings.",
        nextEvidenceLine:
          "Confidence may shift as more daily observations land.",
      },
      // weak_signal
      {
        stateLine: "Early signs of lift — directional, not yet a strong signal.",
        nextEvidenceLine:
          "Confidence updates as more daily readings accumulate.",
      },
    ];
    for (const copy of verdicts) {
      const html = renderToStaticMarkup(
        <LiveChangesBlock liveChanges={[buildChange(copy)]} />,
      );
      const lower = html.toLowerCase();
      expect(lower).not.toContain("validated");
      expect(lower).not.toContain("proven");
      expect(lower).not.toContain("confirmed");
      expect(lower).not.toMatch(/\bwin\b/);
      expect(lower).not.toMatch(/\bwon\b/);
      expect(lower).not.toContain("verdict expected");
      expect(lower).not.toContain("wait until");
    }
  });

  it("shows the (N) count suffix in the header when N > 1", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock
        liveChanges={[
          buildChange({ recEditId: "a" }),
          buildChange({ recEditId: "b" }),
        ]}
      />,
    );
    expect(html).toContain("Live changes (2)");
  });

  it("does NOT show a count suffix for exactly one row", () => {
    const html = renderToStaticMarkup(
      <LiveChangesBlock liveChanges={[buildChange()]} />,
    );
    expect(html).toContain("Live changes");
    expect(html).not.toContain("Live changes (1)");
  });

  // ── EarlySignalPill surfacing (2026-05-09) ──
  // weak_signal rows must show the amber "Early signs of lift" pill so
  // the customer can distinguish directional rows from helping/nothing_yet
  // at a glance. Non-weak_signal rows must NOT show the pill (renders null).

  describe("EarlySignalPill surfacing", () => {
    it("renders the EarlySignalPill for weak_signal rows", () => {
      const html = renderToStaticMarkup(
        <LiveChangesBlock
          liveChanges={[buildChange({ currentVerdict: "weak_signal" })]}
        />,
      );
      expect(html).toContain('data-early-signal-pill="true"');
      expect(html).toContain("Early signs of lift");
    });

    it("does NOT render the pill for helping rows", () => {
      const html = renderToStaticMarkup(
        <LiveChangesBlock
          liveChanges={[buildChange({ currentVerdict: "helping" })]}
        />,
      );
      expect(html).not.toContain('data-early-signal-pill="true"');
    });

    it("does NOT render the pill for nothing_yet rows", () => {
      const html = renderToStaticMarkup(
        <LiveChangesBlock
          liveChanges={[buildChange({ currentVerdict: "nothing_yet" })]}
        />,
      );
      expect(html).not.toContain('data-early-signal-pill="true"');
    });

    it("does NOT render the pill for null/pending rows (no outcome yet)", () => {
      const html = renderToStaticMarkup(
        <LiveChangesBlock
          liveChanges={[buildChange({ currentVerdict: null })]}
        />,
      );
      expect(html).not.toContain('data-early-signal-pill="true"');
    });

    it("never overclaims weak_signal as proof-language anywhere on /today rows", () => {
      const html = renderToStaticMarkup(
        <LiveChangesBlock
          liveChanges={[buildChange({ currentVerdict: "weak_signal" })]}
        />,
      );
      // Operator-locked phrasing — weak_signal must never be rendered as
      // "validated", "proven", "confirmed", "winning", or "won" on any
      // customer surface.
      expect(html.toLowerCase()).not.toContain("validated");
      expect(html.toLowerCase()).not.toContain("proven");
      expect(html.toLowerCase()).not.toContain("confirmed");
      expect(html.toLowerCase()).not.toMatch(/\bwinning\b/);
      expect(html.toLowerCase()).not.toMatch(/\bwon\b/);
    });
  });
});
