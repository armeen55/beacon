/**
 * W2 (2026-07-10) - item 14: the /changes empty state must DISTINGUISH a
 * legitimately-empty ranked list ("No changes yet ...") from a rebuild that has
 * not finished / has not run ("I'm putting your ranked changes together ..."), so
 * a building or failed rebuild is never rendered as a confident empty list.
 *
 * The surfaceBuilding FLAG that selects between the two is pinned at the data layer
 * (changes-surface-swr.test.ts: COLD -> surfaceBuilding true, FRESH/STALE -> false);
 * this pins that the PAGE renders the correct, DISTINCT copy for each flag value.
 * Rendered for real via renderToStaticMarkup so we assert the exact operator copy.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

// loadWithDeadline just resolves the view (no timeout) so ChangesSection reaches its
// empty-state branches deterministically.
vi.mock("@/lib/load-with-deadline", () => ({
  loadWithDeadline: async (p: Promise<unknown>) => ({ timedOut: false, data: await p }),
}));

let _view: unknown = null;
vi.mock("./changes-data", () => ({
  loadChangesView: async () => _view,
  toClientView: (v: unknown) => v,
}));

import { ChangesSection } from "./changes/page";
import type { ChangesView } from "./changes-data";

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
  };
}

async function render(view: ChangesView): Promise<string> {
  _view = view;
  const el = await ChangesSection();
  return el ? renderToStaticMarkup(el) : "";
}

describe("ChangesSection empty vs building (item 14)", () => {
  it("COLD rebuild (surfaceBuilding) renders the honest BUILDING copy, never 'No changes yet'", async () => {
    const html = await render(emptyView({ surfaceBuilding: true }));
    expect(html).toContain("I&#x27;m putting your ranked changes together for the first time");
    expect(html).not.toContain("No changes yet");
  });

  it("a genuinely empty list renders the EMPTY copy, never the building copy", async () => {
    const html = await render(emptyView({ surfaceBuilding: false }));
    expect(html).toContain("No changes yet");
    expect(html).toContain("Beacon&#x27;s ranked changes appear here");
    expect(html).not.toContain("putting your ranked changes together");
  });
});
