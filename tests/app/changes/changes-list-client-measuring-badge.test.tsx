/**
 * ChangesListClient - measuring is a read-only POINTER to Results, never a tab/filter.
 *
 * FP5a ground-truth (UX0, 2026-07-02): measurement rows have ONE home - Results. Changes must
 * never grow a third status tab or a "Measuring" filter that shows measuring rows here, and it
 * must never render a subset-vs-canonical "N of M" number that disagrees with Today's canonical
 * count.
 *
 * One-count reconciliation (2026-07-20): the canonical measuring count was invisible on Changes,
 * which hid a live lifecycle stage. The fix surfaces it as a read-only POINTER (an anchor to
 * /results carrying the ONE canonical field, measuringCountCanonical) - visible and clickable, but
 * NOT a tab and NOT a status filter. This pin holds both intents at once: one home per job (rows
 * live on Results) AND lifecycle visibility (the count is shown and links to Results). Rendered as
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

describe("ChangesListClient - measuring stays on Results, surfaced only as a read-only pointer", () => {
  it("surfaces the canonical measuring count as a read-only pointer that links to Results", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 6 })} />);
    // Lifecycle visibility: the count IS shown and IS clickable to its one home, Results.
    expect(html).toMatch(/href="\/results"[\s\S]*?Measuring[\s\S]*?<span[^>]*>6<\/span>/);
  });

  it("never adds a Measuring TAB or status filter to Changes (rows live on Results)", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 6 })} />);
    // The status filter tabs are buttons with aria-pressed; the only two are To do / Ready.
    // A "Measuring" word must NEVER appear inside a filter button or on an aria-pressed control,
    // so it can never read as a third tab or a status filter that shows measuring rows here.
    expect(html).not.toMatch(/<button\b[^>]*>[^<]*Measuring/i);
    expect(html).not.toMatch(/aria-pressed[^>]*Measuring/i);
    // The measuring element is an anchor to /results, never a <button>.
    expect(html).toMatch(/<a\b[^>]*href="\/results"[^>]*>[\s\S]*?Measuring/i);
  });

  it("shows the canonical number only, never subset-versus-canonical measurement math", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 16 })} />);
    // The old bug threaded a worklist-subset "N of M" that disagreed with Today's canonical number.
    expect(html).not.toContain("6 of 16");
    // The pointer shows the ONE canonical count (16), linked to Results.
    expect(html).toMatch(/href="\/results"[\s\S]*?<span[^>]*>16<\/span>/);
  });

  it("self-hides the pointer entirely when there is nothing measuring", () => {
    const html = renderToStaticMarkup(<ChangesListClient view={baseView({ measuringCountCanonical: 0 })} />);
    expect(html).not.toContain("Measuring");
  });
});
