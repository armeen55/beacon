import { describe, it, expect } from "vitest";

import { clusterOf, buildClusterPerformance } from "@/app/(shell)/today-clusters-rows";

describe("clusterOf", () => {
  it("uses the directory for nested URLs", () => {
    expect(clusterOf("https://x.com/iran-animals/asiatic-cheetah")).toBe("iran-animals");
  });
  it("uses the leading slug token for flat URLs", () => {
    expect(clusterOf("https://x.com/persian-boy-names")).toBe("persian");
    expect(clusterOf("https://x.com/persian-girl-names")).toBe("persian");
  });
  it("handles the homepage", () => {
    expect(clusterOf("https://x.com/")).toBe("home");
  });
});

describe("buildClusterPerformance", () => {
  const p = (page: string, clicks: number, impressions: number) => ({ page, clicks, impressions });

  it("groups pages by theme and ranks by clicks", () => {
    const rows = buildClusterPerformance([
      p("https://x.com/persian-boy-names", 200, 4000),
      p("https://x.com/persian-girl-names", 150, 3000),
      p("https://x.com/iran-flags", 50, 1000),
    ]);
    expect(rows[0]!.cluster).toBe("persian");
    expect(rows[0]!.pages).toBe(2);
    expect(rows[0]!.clicks).toBe(350);
    expect(rows[0]!.ctr).toBeCloseTo(350 / 7000, 5);
  });

  it("respects the minPages floor and cap", () => {
    const rows = buildClusterPerformance(
      [p("https://x.com/a-1", 10, 100), p("https://x.com/a-2", 10, 100), p("https://x.com/b-1", 5, 50)],
      { minPages: 2 },
    );
    expect(rows.map((r) => r.cluster)).toEqual(["a"]); // "b" has 1 page, dropped
  });
});
