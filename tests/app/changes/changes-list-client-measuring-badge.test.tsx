/**
 * ChangesListClient - Measuring tab badge honesty (UX0, 2026-07-02).
 *
 * Operator ground-truth: Today said 16 measuring, the worklist header said Measuring
 * 10 - two different numbers for the same word. The fix threads the SAME canonical
 * proof-ledger count (measuringCountCanonical) into the worklist's Measuring tab, and
 * the badge says "N of M" whenever this worklist's own subset is smaller. Rendered as
 * a pure server-side string via `renderToStaticMarkup` (Node-only, no DOM).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/changes",
}));

import { ChangesListClient } from "@/app/(shell)/changes-list-client";
import type { ChangesView } from "@/app/(shell)/changes-data";

function baseView(over: Partial<ChangesView> = {}): ChangesView {
  return {
    changes: [],
    movesById: {},
    summary: { todo: 0, ready: 0, measuring: 6, results: 0, selectedForToday: 0, protectedPages: 0 },
    hasPlan: false,
    planAccepted: false,
    readyZeroHint: null,
    measuringCountCanonical: 6,
    ...over,
  } as ChangesView;
}

describe("ChangesListClient - Measuring tab badge", () => {
  it("shows a bare count when the worklist's own measuring count matches the canonical total", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 6 })} />);
    expect(html).toContain(">6<");
    expect(html).not.toContain("of 6");
  });

  it("operator ground-truth: shows 'N of M' when the canonical total exceeds this worklist's own subset", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 16 })} />);
    expect(html).toContain("6 of 16");
  });

  it("never shows a bare count that disagrees with Today's canonical number", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 16 })} />);
    // The old bug: a bare "10" (or here, "6") with no context, contradicting Today's 16.
    expect(html).not.toMatch(/>6<\/span>/);
  });
});
