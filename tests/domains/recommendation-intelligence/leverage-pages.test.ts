import { describe, it, expect } from "vitest";

import { buildLeveragePages } from "@/app/(shell)/today-leverage-rows";

const s = (page: string, signal: string, clicksAtStake: number) => ({ page, signal, clicksAtStake });

describe("buildLeveragePages", () => {
  it("ranks pages by distinct-signal breadth, then clicks-at-stake", () => {
    const rows = buildLeveragePages([
      s("/cheetah", "Thin", 100),
      s("/cheetah", "Rising", 50),
      s("/cheetah", "Answer", 80), // 3 signals
      s("/flags", "Declining", 900), // 1 signal — excluded by minSignals=2
      s("/names", "Declining", 200),
      s("/names", "Snippet", 150), // 2 signals
    ]);
    expect(rows.map((r) => r.page)).toEqual(["/cheetah", "/names"]); // 3 signals beats 2; /flags dropped
    expect(rows[0]!.signalCount).toBe(3);
    expect(rows[0]!.clicksAtStake).toBe(230);
    expect(rows[0]!.signals).toEqual(["Answer", "Rising", "Thin"]); // sorted, deduped
  });

  it("dedupes repeated signals on the same page", () => {
    const rows = buildLeveragePages([s("/a", "Thin", 10), s("/a", "Thin", 10), s("/a", "Rising", 5)]);
    expect(rows[0]!.signalCount).toBe(2);
    expect(rows[0]!.clicksAtStake).toBe(25);
  });

  it("returns empty when no page hits the minimum signal breadth", () => {
    expect(buildLeveragePages([s("/a", "Thin", 10), s("/b", "Rising", 5)])).toHaveLength(0);
  });
});
