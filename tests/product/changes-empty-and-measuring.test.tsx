/**
 * /changes empty-vs-building + measuring visibility - merged suite (Core 100K Phase 6).
 * Absorbs: changes-empty-vs-building (item 14), changes-list-client-measuring-badge
 * (one-count rule), today-measuring-hold (the measurement hold builder).
 *
 * Pins:
 *   - a COLD rebuild never renders as a confident empty list (building copy vs empty copy);
 *   - measuring rows have ONE home (Results): on Changes the canonical count is a read-only
 *     pointer, never a tab/filter, and self-hides at zero;
 *   - the measuring hold releases at the 28-day window and fails open to action.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/changes",
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/load-with-deadline", () => ({
  loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }),
}));

let _view: unknown = null;
vi.mock("@/app/(shell)/changes-data", () => ({
  loadChangesView: async () => _view,
  toClientView: (v: unknown) => v,
}));

import { ChangesSection } from "@/app/(shell)/changes/page";
import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";
import { buildMeasuringHold, isHeldForMeasurement } from "@/app/(shell)/today-measuring-hold";

function emptyView(over: Partial<ChangesView>): ChangesView {
  return {
    changes: [],
    movesById: {},
    summary: { todo: 0, ready: 0, measuring: 0, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 0,
    decidedCountCanonical: 0,
    suppressedRowsNote: null,
    expiredSubline: null,
    receiptLine: null,
    readyCount: 0,
    shippedThisWeekCount: 0,
    watching: [],
    surfaceComputedAt: null,
    surfaceBuilding: false,
    ...over,
  } as ChangesView;
}

async function renderSection(view: ChangesView): Promise<string> {
  _view = view;
  const el = await ChangesSection();
  return el ? renderToStaticMarkup(el) : "";
}

describe("ChangesSection empty vs building (item 14)", () => {
  it("COLD rebuild (surfaceBuilding) renders the honest BUILDING copy, never 'No changes yet'", async () => {
    const html = await renderSection(emptyView({ surfaceBuilding: true }));
    expect(html).toContain("I&#x27;m putting your ranked changes together for the first time");
    expect(html).toContain("Beacon is checking again automatically");
    expect(html).not.toContain("No changes yet");
  });

  it("a genuinely empty list renders the EMPTY copy, never the building copy", async () => {
    const html = await renderSection(emptyView({ surfaceBuilding: false }));
    expect(html).toContain("No changes yet");
    expect(html).not.toContain("putting your ranked changes together");
  });
});

describe("measuring is a read-only pointer to Results (one-count rule)", () => {
  const withMeasuring = (n: number) =>
    renderToStaticMarkup(<ChangesListClient view={emptyView({ measuringCountCanonical: n, summary: { todo: 0, ready: 0, measuring: n, results: 0, selectedForToday: 0, protectedPages: 0 } })} />);

  it("surfaces the canonical count as a pointer to Results, never a tab or filter", () => {
    const html = withMeasuring(6);
    expect(html).toMatch(/href="\/results"[\s\S]*?Measuring[\s\S]*?<span[^>]*>6<\/span>/);
    expect(html).not.toMatch(/<button\b[^>]*>[^<]*Measuring/i);
    expect(html).not.toMatch(/aria-pressed[^>]*Measuring/i);
  });

  it("shows the ONE canonical number, never subset-vs-canonical math", () => {
    const html = withMeasuring(16);
    expect(html).not.toContain("6 of 16");
    expect(html).toMatch(/href="\/results"[\s\S]*?<span[^>]*>16<\/span>/);
  });

  it("self-hides the pointer entirely when there is nothing measuring", () => {
    expect(withMeasuring(0)).not.toContain("Measuring");
  });
});

describe("buildMeasuringHold - the measurement hold releases honestly", () => {
  const now = Date.parse("2026-06-25T00:00:00Z");
  const DAY = 86_400_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  it("holds an open 'measuring' record inside the window, releases after 28d", () => {
    const inWindow = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 3 * DAY), verdict: "measuring" }],
      now,
    );
    expect(inWindow.has("/iran-flag")).toBe(true);

    const elapsed = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: iso(now - 40 * DAY), verdict: "measuring" }],
      now,
    );
    expect(elapsed.size).toBe(0);
  });

  it("normalizes trailing slashes so ledger path and Move URL match; other pages are not held", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag/", shippedAt: iso(now - 1 * DAY), verdict: "measuring" }],
      now,
    );
    expect(isHeldForMeasurement("https://iranopedia.com/iran-flag", held)).toBe(true);
    expect(isHeldForMeasurement("https://iranopedia.com/persian-boy-names", held)).toBe(false);
  });

  it("ignores rows with an unparseable ship date (fail-open to action)", () => {
    const held = buildMeasuringHold(
      [{ path: "/iran-flag", shippedAt: "garbage", verdict: "measuring" }],
      now,
    );
    expect(held.size).toBe(0);
  });
});
