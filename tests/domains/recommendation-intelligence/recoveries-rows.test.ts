import { describe, it, expect } from "vitest";

import {
  classifyRecovery,
  buildRecoveryWins,
  recoveryClicksRegained,
  type RecoveryInput,
} from "@/app/(shell)/today-recoveries-rows";

const inp = (page: string, beforeClicks: number, afterClicks: number): RecoveryInput => ({
  page,
  label: page,
  beforeClicks,
  afterClicks,
});

describe("classifyRecovery", () => {
  it("recovered = strong climb (≥25% and ≥5 net)", () => {
    expect(classifyRecovery(40, 60)).toBe("recovered"); // +50%, +20
    expect(classifyRecovery(100, 130)).toBe("recovered"); // +30%, +30
  });
  it("improving = real but smaller climb", () => {
    expect(classifyRecovery(40, 46)).toBe("improving"); // +15%, +6
  });
  it("slipping = it fell", () => {
    expect(classifyRecovery(100, 80)).toBe("slipping");
  });
  it("flat = noise / tiny move", () => {
    expect(classifyRecovery(100, 103)).toBe("flat"); // +3%
    expect(classifyRecovery(1, 3)).toBe("flat"); // tiny base, +2 net but <5 and base guard
  });
  it("does not over-celebrate from a near-zero baseline", () => {
    // 0 → 4: net 4 (<5) → improving requires net≥2 AND ≥10% of base(=1) → 400% pct, net 4 ≥2 → improving
    expect(classifyRecovery(0, 4)).toBe("improving");
    // but 0 → 1 stays flat (net 1 < 2)
    expect(classifyRecovery(0, 1)).toBe("flat");
  });
});

describe("buildRecoveryWins", () => {
  it("keeps only recovered/improving, ranked by net clicks regained", () => {
    const wins = buildRecoveryWins([
      inp("/a", 100, 80), // slipping → excluded
      inp("/b", 40, 60), // recovered, +20
      inp("/c", 40, 46), // improving, +6
      inp("/d", 100, 101), // flat → excluded
    ]);
    expect(wins.map((w) => w.page)).toEqual(["/b", "/c"]);
    expect(wins[0]!.status).toBe("recovered");
    expect(wins[0]!.deltaPct).toBe(50);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 10 }, (_, i) => inp(`/p${i}`, 40, 80));
    expect(buildRecoveryWins(many, { cap: 3 })).toHaveLength(3);
  });
  it("sums net clicks regained", () => {
    const wins = buildRecoveryWins([inp("/b", 40, 60), inp("/c", 40, 46)]);
    expect(recoveryClicksRegained(wins)).toBe(20 + 6);
  });
});
