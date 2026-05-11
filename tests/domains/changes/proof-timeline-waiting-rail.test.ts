/**
 * /changes proof-timeline — "Waiting for signal" rail builder.
 *
 * Pins that the rail filters to in-flight rows, sorts newest-first,
 * caps results, and rewrites the pattern-timing prediction into ONE
 * customer-safe sentence per item.
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
    readyOn: null,
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

  it("rewrites readyOn into a plain-English narrative with the day number", () => {
    const items = buildWaitingRail([
      row({
        readyOn: { daysFromChange: 7, confidenceTier: "high" },
      }),
    ]);
    expect(items.length).toBe(1);
    expect(items[0].narrative).toContain("day 7");
    expect(items[0].narrative.toLowerCase()).toContain("similar changes");
  });

  it("falls back to a generic narrative when readyOn is null", () => {
    const items = buildWaitingRail([row({ readyOn: null })]);
    expect(items[0].narrative.toLowerCase()).toContain("watching");
  });

  it("never leaks pattern-brain / median-landing vocabulary", () => {
    const banned = [
      "median_landing",
      "median landing",
      "pattern brain",
      "z-score",
      "edit_type",
      "edit type",
      "asset_type",
    ];
    const items = buildWaitingRail([
      row({ readyOn: { daysFromChange: 7, confidenceTier: "high" } }),
      row({ readyOn: { daysFromChange: 14, confidenceTier: "medium" } }),
      row({ readyOn: { daysFromChange: 3, confidenceTier: "low" } }),
      row({ readyOn: null }),
      row({ pillKind: "live", readyOn: null }),
    ]);
    for (const it of items) {
      const lower = it.narrative.toLowerCase();
      for (const term of banned) {
        expect(lower, `narrative leaked '${term}'`).not.toContain(term);
      }
    }
  });
});
