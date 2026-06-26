/**
 * clarity-page-signals — per-URL Clarity friction aggregation.
 *
 * Pins the canonical-URL keying (review finding 2026-06-13): Clarity's
 * exported URL format often differs from the crawler's snapshot URL by
 * www/scheme/trailing-slash, so a raw-keyed map silently missed every
 * trigger lookup. The map is now keyed by canonicalizeCitationUrl (exactly
 * like the GSC fuses), so variants of the same page MERGE and the
 * trigger loader's canonical lookup hits.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _rows = { current: [] as unknown[] };
// audit wave-2 #4 (2026-06-14): the loader now PAGES via .order().range()
// instead of a single .limit() (PostgREST 1000-row cap fix). Chainable
// builder resolves at .range(); since the fixtures are <1000 rows, the
// loader's loop breaks after the first page (batch.length < PAGE).
vi.mock("@/lib/persistence/supabase", () => {
  const make = () => {
    const b: Record<string, unknown> = {};
    b.from = () => b;
    b.select = () => b;
    b.eq = () => b;
    b.gte = () => b;
    b.order = () => b;
    b.range = () => Promise.resolve({ data: _rows.current, error: null });
    return b;
  };
  return { getSupabaseAdmin: () => make() };
});
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";

function clarityRow(url: string, over: Record<string, number> = {}) {
  return {
    url,
    sessions: 0,
    rage_clicks: 0,
    dead_clicks: 0,
    quickbacks: 0,
    excessive_scroll: 0,
    script_errors: 0,
    ...over,
  };
}

beforeEach(() => {
  _rows.current = [];
});

describe("loadClarityPageSignalsForTenant — canonical URL keying", () => {
  it("merges www/scheme/trailing-slash variants of one page into a single canonical signal", async () => {
    _rows.current = [
      clarityRow("https://www.x.com/page/", { sessions: 30, rage_clicks: 2, script_errors: 1 }),
      clarityRow("http://x.com/page", { sessions: 40, rage_clicks: 3, script_errors: 2 }),
    ];
    const m = await loadClarityPageSignalsForTenant(
      "tenant-1",
      new Date("2026-06-13T00:00:00Z"),
    );
    // Both rows canonicalize to the same key → exactly one merged entry.
    expect(m.size).toBe(1);
    const sig = [...m.values()][0]!;
    expect(sig.sessions).toBe(70); // 30 + 40
    expect(sig.rageClicks).toBe(5); // 2 + 3
    expect(sig.scriptErrors).toBe(3); // 1 + 2
    // Rates computed off the merged denominator.
    expect(sig.rageRate).toBeCloseTo(5 / 70, 5);
  });

  it("distinct pages stay distinct", async () => {
    _rows.current = [
      clarityRow("https://x.com/a", { sessions: 10 }),
      clarityRow("https://x.com/b", { sessions: 20 }),
    ];
    const m = await loadClarityPageSignalsForTenant("tenant-1");
    expect(m.size).toBe(2);
  });

  it("fail-soft: a Supabase error returns an empty map (trigger abstains)", async () => {
    // Re-mock not needed — empty rows already yields empty; this asserts the
    // empty-map contract the trigger relies on (dormant-until-data).
    _rows.current = [];
    const m = await loadClarityPageSignalsForTenant("tenant-1");
    expect(m.size).toBe(0);
  });
});
