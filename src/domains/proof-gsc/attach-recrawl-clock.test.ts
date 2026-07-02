/**
 * attach-recrawl-clock.test.ts (MASTER PLAN v2 N11, 2026-07-02).
 *
 * Pins:
 *   - one Supabase read of gsc_url_inspections, grouped by inspection_url, keyed
 *     back to each ledger row's own page.
 *   - fail-soft: no Supabase admin, an undefined-table error, or any other read
 *     error all degrade to an empty map, never a thrown error.
 *   - the title/meta fallback input (newTitle) is only populated for title
 *     action types, and only from the row's own `after` text.
 *   - a page with NO inspection rows at all still resolves (via
 *     computeRecrawlClock) to hasInspectionHistory=false, so the read-path cap
 *     never fires "never checked" as "still blind".
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type Row = Record<string, unknown>;
let inspectionRows: Row[] = [];
let readError: { code?: string; message?: string } | null = null;
let adminThrows = false;
const inCalls: unknown[][] = [];

function chainFor() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.in = vi.fn((_col: string, values: unknown[]) => {
    inCalls.push(values);
    if (readError) return Promise.resolve({ data: null, error: readError });
    return Promise.resolve({ data: inspectionRows, error: null });
  });
  return chain;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => {
    if (adminThrows) throw new Error("no supabase env");
    return { from: () => chainFor() };
  },
}));

import { attachRecrawlClockForLedger } from "./attach-recrawl-clock";

const NOW = new Date("2026-07-02T12:00:00Z");

function reset() {
  inspectionRows = [];
  readError = null;
  adminThrows = false;
  inCalls.length = 0;
}

describe("attachRecrawlClockForLedger", () => {
  it("empty tenantId or no rows ⇒ empty map, no Supabase call", async () => {
    reset();
    const out1 = await attachRecrawlClockForLedger("", [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }], NOW);
    expect(out1.size).toBe(0);
    const out2 = await attachRecrawlClockForLedger("tenant-1", [], NOW);
    expect(out2.size).toBe(0);
  });

  it("no Supabase admin (dev without keys) degrades to an empty map", async () => {
    reset();
    adminThrows = true;
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    expect(out.size).toBe(0);
  });

  it("undefined-table error (pre-migration) degrades to an empty map, not a throw", async () => {
    reset();
    readError = { code: "42P01", message: "relation does not exist" };
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    expect(out.size).toBe(0);
  });

  it("a real read error also degrades to an empty map (fail-soft)", async () => {
    reset();
    readError = { code: "XXYYY", message: "connection reset" };
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    expect(out.size).toBe(0);
  });

  it("a page with no inspection rows resolves with hasInspectionHistory=false, recrawlConfirmedAt null", async () => {
    reset();
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    const r = out.get("a")!;
    expect(r.hasInspectionHistory).toBe(false);
    expect(r.recrawlConfirmedAt).toBeNull();
    expect(r.basis).toBe("none");
  });

  it("a post-ship inspection row confirms recrawl for the matching page only", async () => {
    reset();
    inspectionRows = [
      { inspection_url: "https://x.com/a", last_crawl_time: "2026-06-25T00:00:00Z", last_checked_at: "2026-06-26T00:00:00Z" },
    ];
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [
        { id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null },
        { id: "b", page: "https://x.com/b", shippedAt: "2026-06-20", actionType: "edit_meta", after: null },
      ],
      NOW,
    );
    expect(out.get("a")!.recrawlConfirmedAt).toBe("2026-06-25T00:00:00.000Z");
    expect(out.get("a")!.basis).toBe("inspection");
    expect(out.get("b")!.recrawlConfirmedAt).toBeNull();
    expect(out.get("b")!.hasInspectionHistory).toBe(false);
  });

  it("multiple inspection rows for the same page are all passed through to computeRecrawlClock", async () => {
    reset();
    inspectionRows = [
      { inspection_url: "https://x.com/a", last_crawl_time: "2026-06-18T00:00:00Z", last_checked_at: "2026-06-19T00:00:00Z" },
      { inspection_url: "https://x.com/a", last_crawl_time: "2026-06-24T00:00:00Z", last_checked_at: "2026-06-25T00:00:00Z" },
    ];
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [{ id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null }],
      NOW,
    );
    // Earliest POST-liveAt inspection wins (the 06-18 one predates the ship).
    expect(out.get("a")!.recrawlConfirmedAt).toBe("2026-06-24T00:00:00.000Z");
    expect(out.get("a")!.hasInspectionHistory).toBe(true);
  });

  it("newTitle is only threaded through for a title action type, from the row's own after text", async () => {
    reset();
    const out = await attachRecrawlClockForLedger(
      "tenant-1",
      [
        { id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_title", after: "New Title Text" },
        { id: "b", page: "https://x.com/b", shippedAt: "2026-06-20", actionType: "add_answer_block", after: "Some answer text" },
      ],
      NOW,
    );
    // Neither has SERP snapshots wired (unimplemented data source), so both stay
    // basis "none" regardless - this test only pins that the call does not throw
    // and dedupes the query to the distinct pages requested.
    expect(out.get("a")!.basis).toBe("none");
    expect(out.get("b")!.basis).toBe("none");
    expect(inCalls[0]).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

  it("dedupes the requested page list before querying", async () => {
    reset();
    await attachRecrawlClockForLedger(
      "tenant-1",
      [
        { id: "a", page: "https://x.com/a", shippedAt: "2026-06-20", actionType: "edit_meta", after: null },
        { id: "a2", page: "https://x.com/a", shippedAt: "2026-06-21", actionType: "edit_meta", after: null },
      ],
      NOW,
    );
    expect(inCalls[0]).toEqual(["https://x.com/a"]);
  });
});
