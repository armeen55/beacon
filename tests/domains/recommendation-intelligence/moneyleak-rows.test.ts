import { describe, it, expect } from "vitest";

import {
  buildMoneyLeakRows,
  moneyLeakSessionsAtRisk,
  type Ga4Like,
  type ClarityLike,
} from "@/app/(shell)/today-moneyleak-rows";

const canon = (u: string) => u.toLowerCase().replace(/\/$/, "");
const ga4 = (page: string, sessions28d: number, conversions28d = 0): Ga4Like => ({ page, sessions28d, conversions28d });
const clar = (url: string, deadRate: number, rageRate = 0, quickbackRate = 0): ClarityLike => ({ url, deadRate, rageRate, quickbackRate });

describe("buildMoneyLeakRows", () => {
  it("emits a row only when a high-traffic page also clears a friction threshold", () => {
    const rows = buildMoneyLeakRows(
      [ga4("https://x/a", 500, 10), ga4("https://x/b", 500)],
      [clar("https://x/a", 0.3), clar("https://x/b", 0.01)], // a leaks (30% dead), b clean
      canon,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page).toBe("https://x/a");
    expect(rows[0]!.friction.kind).toBe("dead");
    expect(rows[0]!.friction.pct).toBe(30);
  });

  it("ignores low-traffic pages even with bad friction", () => {
    const rows = buildMoneyLeakRows([ga4("https://x/a", 10)], [clar("https://x/a", 0.9)], canon, { minSessions: 50 });
    expect(rows).toEqual([]);
  });

  it("names the MOST severe friction (highest ratio over its own threshold)", () => {
    // rage 0.16 = 2× its 0.08 floor; dead 0.22 = 1.1× its 0.2 floor → rage wins.
    const rows = buildMoneyLeakRows([ga4("https://x/a", 200)], [clar("https://x/a", 0.22, 0.16)], canon);
    expect(rows[0]!.friction.kind).toBe("rage");
  });

  it("carries a friction-specific fix directive (signal → directive)", () => {
    const dead = buildMoneyLeakRows([ga4("https://x/a", 200)], [clar("https://x/a", 0.4)], canon);
    expect(dead[0]!.friction.directive).toMatch(/click/i);
    const qb = buildMoneyLeakRows([ga4("https://x/b", 200)], [clar("https://x/b", 0, 0, 0.5)], canon);
    expect(qb[0]!.friction.kind).toBe("quickback");
    expect(qb[0]!.friction.directive).toMatch(/bounce|search|answer/i);
  });

  it("ranks by sessions at risk (desc) and caps", () => {
    const rows = buildMoneyLeakRows(
      [ga4("https://x/a", 100), ga4("https://x/b", 900)],
      [clar("https://x/a", 0.5), clar("https://x/b", 0.5)],
      canon,
      { cap: 1 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page).toBe("https://x/b");
  });

  it("joins GA4 and Clarity by canonical URL (trailing slash / case)", () => {
    const rows = buildMoneyLeakRows([ga4("https://X/A/", 200)], [clar("https://x/a", 0.4)], canon);
    expect(rows).toHaveLength(1);
  });

  it("sums sessions at risk", () => {
    const rows = buildMoneyLeakRows(
      [ga4("https://x/a", 200), ga4("https://x/b", 300)],
      [clar("https://x/a", 0.4), clar("https://x/b", 0.4)],
      canon,
    );
    expect(moneyLeakSessionsAtRisk(rows)).toBe(500);
  });

  it("returns empty when no friction data at all", () => {
    expect(buildMoneyLeakRows([ga4("https://x/a", 999)], [], canon)).toEqual([]);
  });
});
