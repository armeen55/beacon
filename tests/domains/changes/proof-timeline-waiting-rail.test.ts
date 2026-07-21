/**
 * /changes proof-timeline — "Waiting for signal" rail builder.
 *
 * Pins that the rail filters to in-flight rows, sorts newest-first,
 * caps results, and names the next Google reading date from the proof
 * ledger's own checkpoint schedule (verdict-engine consolidation
 * 2026-07-21, CORE 100K Lane F: the retired pattern-brain "ready on"
 * guess no longer feeds this rail).
 */
import { describe, expect, it } from "vitest";

import {
  buildWaitingRail,
  type WaitingRailInput,
} from "@/domains/changes/proof-timeline/waiting-rail";

function row(overrides: Partial<WaitingRailInput> = {}): WaitingRailInput {
  return {
    id: "change-1",
    title: "Add an FAQ section for Atherton modern home builder",
    targetUrl: "/services/modern-home-builder-atherton",
    shippedAt: "2026-05-01T00:00:00Z",
    pillKind: "too_early",
    nextCheckpoint: null,
    ...overrides,
  };
}

describe("buildWaitingRail", () => {
  it("keeps only too-early / watching / live rows", () => {
    const items = buildWaitingRail([
      row({ id: "ok-too-early", pillKind: "too_early" }),
      row({ id: "ok-watching", pillKind: "watching" }),
      row({ id: "ok-live", pillKind: "live" }),
      row({ id: "drop-helping", pillKind: "helping" }),
      row({ id: "drop-hurting", pillKind: "hurting" }),
      row({ id: "drop-needs-review", pillKind: "needs_review" }),
      row({ id: "drop-no-signal", pillKind: "no_signal_yet" }),
    ]);
    expect(items.map((i) => i.id)).toEqual([
      "ok-too-early",
      "ok-watching",
      "ok-live",
    ]);
  });

  it("sorts items newest-first", () => {
    const items = buildWaitingRail([
      row({ id: "old", shippedAt: "2026-04-01T00:00:00Z" }),
      row({ id: "newest", shippedAt: "2026-05-09T00:00:00Z" }),
      row({ id: "mid", shippedAt: "2026-04-20T00:00:00Z" }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["newest", "mid", "old"]);
  });

  it("caps the rail at the configured limit", () => {
    const items = buildWaitingRail(
      Array.from({ length: 12 }, (_, i) =>
        row({
          id: `r-${i}`,
          shippedAt: `2026-05-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
        }),
      ),
      3,
    );
    expect(items.length).toBe(3);
  });

  it("names the next Google reading date from the proof checkpoint", () => {
    const items = buildWaitingRail([
      row({ nextCheckpoint: "2026-05-15" }),
    ]);
    expect(items.length).toBe(1);
    expect(items[0].narrative).toBe(
      "I will take the next Google reading on May 15.",
    );
  });

  it("says plainly when no reading is scheduled yet", () => {
    const items = buildWaitingRail([row({ nextCheckpoint: null })]);
    expect(items[0].narrative).toBe(
      "I have not scheduled a Google reading for this one yet.",
    );
  });

  it("live rows without proof coverage get the honest not-measured line", () => {
    const items = buildWaitingRail([
      row({ pillKind: "live", nextCheckpoint: null }),
    ]);
    expect(items[0].narrative).toBe(
      "Live on your site. This one is not on my measured list yet.",
    );
  });

  it("skips an unparseable checkpoint date instead of rendering garbage", () => {
    const items = buildWaitingRail([
      row({ nextCheckpoint: "not-a-date" }),
    ]);
    expect(items[0].narrative).toBe(
      "I have not scheduled a Google reading for this one yet.",
    );
  });

  it("never leaks internal vocabulary or em/en dashes", () => {
    const banned = [
      "median_landing",
      "median landing",
      "pattern brain",
      "z-score",
      "edit_type",
      "edit type",
      "asset_type",
      "checkpoint",
      "maturity",
      "baseline",
      "experiment",
      "control",
    ];
    const items = buildWaitingRail([
      row({ nextCheckpoint: "2026-05-15" }),
      row({ nextCheckpoint: null }),
      row({ pillKind: "watching", nextCheckpoint: "2026-06-01" }),
      row({ pillKind: "live", nextCheckpoint: null }),
    ]);
    for (const it of items) {
      const lower = it.narrative.toLowerCase();
      for (const term of banned) {
        expect(lower, `narrative leaked '${term}'`).not.toContain(term);
      }
      expect(it.narrative).not.toMatch(/[–—]/);
    }
  });
});
