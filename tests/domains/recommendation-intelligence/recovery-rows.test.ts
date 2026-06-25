import { describe, it, expect } from "vitest";

import {
  buildRecoveryRows,
  recoveryClicksLost,
  indexCannibalizationByUrl,
} from "@/app/(shell)/today-declines-rows";

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

describe("indexCannibalizationByUrl", () => {
  const canon = (u: string) => u.toLowerCase().replace(/\/$/, "");
  const pretty = (u: string) => u.split("/").pop() || u;
  const cu = (url: string) => ({ url, clicks: 0, impressions: 0, position: 0 });
  // First URL is the lead (best-ranking) by convention in these fixtures.
  const kase = (query: string, urls: string[]) =>
    ({ query, competingUrls: urls.map(cu), leadUrl: urls[0]! }) as never;

  it("maps each competing URL with its others + a lead-aware consolidation fix", () => {
    const idx = indexCannibalizationByUrl([kase("iran flag", ["/iran-flag", "/pahlavi-flag", "/qajar-flag"])], canon, pretty);
    const lead = idx.get("/iran-flag")![0];
    expect(lead.otherPages).toEqual(["pahlavi-flag", "qajar-flag"]);
    expect(lead.isLead).toBe(true);
    expect(lead.fix).toContain("fold"); // lead absorbs the others
    const follower = idx.get("/pahlavi-flag")![0];
    expect(follower.isLead).toBe(false);
    expect(follower.leadPage).toBe("iran-flag");
    expect(follower.fix).toContain("iran-flag"); // follower points at the lead
  });

  it("skips single-URL cases (not actually cannibalization)", () => {
    expect(indexCannibalizationByUrl([kase("solo", ["/only"])], canon, pretty).size).toBe(0);
  });

  it("caps otherPages", () => {
    const idx = indexCannibalizationByUrl([kase("q", ["/a", "/b", "/c", "/d", "/e"])], canon, pretty, 2);
    expect(idx.get("/a")![0].otherPages).toHaveLength(2);
  });

  it("does NOT advise a topic page to defer to the homepage (no backwards link)", () => {
    // Lead is the homepage; a dedicated page competes.
    const c = { query: "persian boy names", competingUrls: [cu("https://x.com/"), cu("https://x.com/persian-boy-names")], leadUrl: "https://x.com/" } as never;
    const idx = indexCannibalizationByUrl([c], (u: string) => u.replace(/\/$/, ""), (u: string) => u.split("/").pop() || "home");
    const follower = idx.get("https://x.com/persian-boy-names")![0];
    expect(follower.linkSnippet).toBeNull(); // never link a topic page at the root
    expect(follower.fix).toContain("homepage");
    expect(follower.fix).toContain("dedicated");
  });
});
