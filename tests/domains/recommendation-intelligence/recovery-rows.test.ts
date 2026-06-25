import { describe, it, expect } from "vitest";

import { buildRecoveryRows, recoveryClicksLost } from "@/app/(shell)/today-declines-rows";

// Minimal move shapes — only the fields buildRecoveryRows reads.
const decl = (query: string, dropPct: number, priorClicks: number, recentClicks: number, positionSlip = 0) => ({
  query,
  dropPct,
  priorClicks,
  recentClicks,
  positionSlip,
  recentPosition: 0,
  priorPosition: 0,
});
const move = (id: string, pageLabel: string, declines: ReturnType<typeof decl>[]) =>
  ({ id, pageLabel, targetUrl: `https://x/${id}`, declines }) as never;

describe("buildRecoveryRows", () => {
  it("flattens declines across moves and ranks by clicks at stake (prior desc)", () => {
    const rows = buildRecoveryRows([
      move("a", "Page A", [decl("small", 50, 30, 15)]),
      move("b", "Page B", [decl("big", 75, 292, 73), decl("mid", 60, 80, 32)]),
    ]);
    expect(rows.map((r) => r.query)).toEqual(["big", "mid", "small"]);
    expect(rows[0]!.page).toBe("Page B");
  });

  it("caps the list", () => {
    const declines = Array.from({ length: 20 }, (_, i) => decl(`q${i}`, 50, 100 - i, 10));
    expect(buildRecoveryRows([move("a", "A", declines)], 5)).toHaveLength(5);
  });

  it("returns empty when no declines", () => {
    expect(buildRecoveryRows([move("a", "A", [])])).toEqual([]);
  });

  it("sums clicks slipping, never negative", () => {
    const rows = buildRecoveryRows([
      move("a", "A", [decl("x", 75, 292, 73), decl("y", 50, 100, 50)]),
    ]);
    expect(recoveryClicksLost(rows)).toBe(292 - 73 + (100 - 50)); // 219 + 50 = 269
  });

  it("never goes negative if a query somehow grew", () => {
    const rows = buildRecoveryRows([move("a", "A", [decl("grew", 0, 50, 80)])]);
    expect(recoveryClicksLost(rows)).toBe(0);
  });
});
