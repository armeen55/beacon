import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type Row = { url: string; sessions: number; engaged_sessions: number; conversions: number };
const pages: Row[][] = [];
const rangeCalls: Array<[number, number]> = [];
const orderCalls: string[] = [];
let failPage: number | null = null;

function chain() {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "lt", "or"]) {
    value[method] = vi.fn(() => value);
  }
  value.order = vi.fn((column: string) => {
    orderCalls.push(column);
    return value;
  });
  value.range = vi.fn((from: number, to: number) => {
    rangeCalls.push([from, to]);
    const page = Math.floor(from / 1_000);
    return Promise.resolve(
      failPage === page
        ? { data: null, error: { message: "read failed" } }
        : { data: pages[page] ?? [], error: null },
    );
  });
  return value;
}

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => chain() }),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readGa4WindowForPages } from "./ga4-window";
import { log } from "@/lib/logger";

describe("readGa4WindowForPages paging", () => {
  beforeEach(() => {
    pages.length = 0;
    rangeCalls.length = 0;
    orderCalls.length = 0;
    failPage = null;
  });

  it("reads beyond PostgREST's 1,000-row response cap and sums every page", async () => {
    pages[0] = Array.from({ length: 1_000 }, () => ({
      url: "https://example.com/a",
      sessions: 1,
      engaged_sessions: 1,
      conversions: 0,
    }));
    pages[1] = [{
      url: "https://example.com/a",
      sessions: 7,
      engaged_sessions: 4,
      conversions: 2,
    }];
    const out = await readGa4WindowForPages({
      tenantId: "tenant-a",
      pages: ["https://example.com/a"],
      start: "2026-06-01",
      end: "2026-07-01",
    });
    expect(rangeCalls).toEqual([[0, 999], [1_000, 1_999]]);
    expect(orderCalls).toEqual(["date", "url", "date", "url"]);
    expect(out.get("https://example.com/a")).toEqual({
      sessions: 1_007,
      engagedSessions: 1_004,
      conversions: 2,
    });
  });

  it("discards a partial read when a later page fails instead of undercounting", async () => {
    pages[0] = Array.from({ length: 1_000 }, () => ({
      url: "https://example.com/a",
      sessions: 1,
      engaged_sessions: 1,
      conversions: 1,
    }));
    failPage = 1;
    vi.mocked(log.warn).mockClear();
    const out = await readGa4WindowForPages({
      tenantId: "tenant-a",
      pages: ["https://example.com/a"],
      start: "2026-06-01",
      end: "2026-07-01",
    });
    expect(out.get("https://example.com/a")).toEqual({
      sessions: 0,
      engagedSessions: 0,
      conversions: 0,
    });
    // The silent zero is now logged, not hidden.
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn).mock.calls[0]![0]).toContain("ga4-window");
  });
});
