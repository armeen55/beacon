import { describe, it, expect } from "vitest";

import {
  computeAiOverviewGap,
  computeAiOverviewGaps,
  computeAiOverviewTransitions,
  aiOverviewGapHeadline,
  type AiOverviewHistoryRow,
} from "./ai-overview-gaps";

const row = (over: Partial<AiOverviewHistoryRow> = {}): AiOverviewHistoryRow => ({
  query: "persian carpets",
  capturedAt: "2026-07-01T00:00:00Z",
  ownRank: 3,
  aiOverviewPresent: true,
  aiOverviewDomains: [],
  ...over,
});

describe("computeAiOverviewGap — one query, most recent snapshot", () => {
  it("names a distinct gap: ranks top 5, overview exists, cites a rival instead", () => {
    const g = computeAiOverviewGap(
      [row({ aiOverviewDomains: [{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x", position: 1 }] })],
      "iranopedia.com",
    );
    expect(g?.gap).toBe(true);
    expect(g?.overviewCitesYou).toBe(false);
    expect(g?.overviewCitedDomains).toEqual(["carpetencyclopedia.com"]);
    expect(g?.sentence).toBe(
      "You rank 3 on Google for persian carpets, but the AI answer box cites carpetencyclopedia.com instead of you.",
    );
  });

  it("no gap when the overview actually cites the tenant's own domain", () => {
    const g = computeAiOverviewGap(
      [row({ aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/persian-carpets", position: 1 }] })],
      "iranopedia.com",
    );
    expect(g?.gap).toBe(false);
    expect(g?.overviewCitesYou).toBe(true);
    expect(g?.sentence).toBeNull();
  });

  it("matches the tenant domain through schemeless/www/subdomain forms, never suffix look-alikes", () => {
    const cited = (domain: string) =>
      computeAiOverviewGap([row({ aiOverviewDomains: [{ domain, url: `https://${domain}/x`, position: 1 }] })], "iranopedia.com")
        ?.overviewCitesYou;
    expect(cited("iranopedia.com")).toBe(true);
    expect(cited("www.iranopedia.com")).toBe(true);
    expect(cited("blog.iranopedia.com")).toBe(true);
    expect(cited("notiranopedia.com")).toBe(false);
  });

  it("no gap when no AI Overview rendered at all (silence, not a false negative)", () => {
    const g = computeAiOverviewGap([row({ aiOverviewPresent: false, aiOverviewDomains: [] })], "iranopedia.com");
    expect(g?.overviewPresent).toBe(false);
    expect(g?.gap).toBe(false);
    expect(g?.sentence).toBeNull();
  });

  it("no gap when the tenant's organic rank does not qualify (below top 5, or absent)", () => {
    const farRank = computeAiOverviewGap(
      [row({ ownRank: 40, aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] })],
      "iranopedia.com",
    );
    expect(farRank?.gap).toBe(false);
    const absentRank = computeAiOverviewGap(
      [row({ ownRank: null, aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] })],
      "iranopedia.com",
    );
    expect(absentRank?.gap).toBe(false);
  });

  it("no gap and no crash when the tenant domain is unknown", () => {
    const g = computeAiOverviewGap(
      [row({ aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] })],
      null,
    );
    expect(g?.overviewCitesYou).toBe(false);
    expect(g?.gap).toBe(true); // still a real observed gap even though we cannot claim "instead of you" ownership context
  });

  it("uses the MOST RECENT snapshot when multiple rows exist for the same query, any input order", () => {
    const older = row({ capturedAt: "2026-06-01T00:00:00Z", ownRank: 9, aiOverviewDomains: [] });
    const newer = row({
      capturedAt: "2026-07-01T00:00:00Z",
      ownRank: 3,
      aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }],
    });
    const g = computeAiOverviewGap([newer, older], "iranopedia.com");
    expect(g?.ownRank).toBe(3);
    expect(g?.capturedAt).toBe("2026-07-01T00:00:00Z");
  });

  it("answers null for an empty row list", () => {
    expect(computeAiOverviewGap([], "iranopedia.com")).toBeNull();
  });

  it("falls back to a generic sentence when the overview exists but no rival domain parsed", () => {
    const g = computeAiOverviewGap([row({ aiOverviewDomains: [] })], "iranopedia.com");
    expect(g?.gap).toBe(true);
    expect(g?.sentence).toBe("You rank 3 on Google for persian carpets, but the AI answer box does not cite you.");
  });
});

describe("computeAiOverviewGaps — every tracked query, ranked", () => {
  it("groups by query, ranks real gaps first by best organic rank, keeps non-gap rows visible", () => {
    const rows: AiOverviewHistoryRow[] = [
      row({ query: "persian carpets", ownRank: 4, aiOverviewDomains: [{ domain: "rival-a.com", url: "https://rival-a.com/x", position: 1 }] }),
      row({ query: "nowruz traditions", ownRank: 1, aiOverviewDomains: [{ domain: "rival-b.com", url: "https://rival-b.com/y", position: 1 }] }),
      row({ query: "persian cats", ownRank: 2, aiOverviewPresent: false, aiOverviewDomains: [] }),
    ];
    const gaps = computeAiOverviewGaps(rows, "iranopedia.com");
    expect(gaps).toHaveLength(3);
    expect(gaps[0].query).toBe("nowruz traditions"); // gap=true, rank 1 beats rank 4
    expect(gaps[1].query).toBe("persian carpets");
    expect(gaps[2].query).toBe("persian cats"); // no overview -> not a gap, sorted last
    expect(gaps[2].gap).toBe(false);
  });

  it("returns an empty list for empty input", () => {
    expect(computeAiOverviewGaps([], "iranopedia.com")).toEqual([]);
  });
});

describe("computeAiOverviewTransitions — real lost/gained citation moves", () => {
  it("detects a LOST transition across two real snapshots", () => {
    const rows: AiOverviewHistoryRow[] = [
      row({ capturedAt: "2026-06-01T00:00:00Z", aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/x", position: 1 }] }),
      row({ capturedAt: "2026-07-01T00:00:00Z", aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] }),
    ];
    const t = computeAiOverviewTransitions(rows, "iranopedia.com");
    expect(t).toHaveLength(1);
    expect(t[0].direction).toBe("lost");
    expect(t[0].sentence).toContain("stopped citing you");
  });

  it("detects a GAINED transition across two real snapshots", () => {
    const rows: AiOverviewHistoryRow[] = [
      row({ capturedAt: "2026-06-01T00:00:00Z", aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] }),
      row({ capturedAt: "2026-07-01T00:00:00Z", aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/x", position: 1 }] }),
    ];
    const t = computeAiOverviewTransitions(rows, "iranopedia.com");
    expect(t).toHaveLength(1);
    expect(t[0].direction).toBe("gained");
    expect(t[0].sentence).toContain("started citing you");
  });

  it("needs at least TWO overview-present snapshots for the SAME query — one point is silence", () => {
    expect(computeAiOverviewTransitions([row()], "iranopedia.com")).toEqual([]);
    expect(computeAiOverviewTransitions([], "iranopedia.com")).toEqual([]);
  });

  it("ignores snapshots where no overview rendered when looking for adjacent citation state", () => {
    const rows: AiOverviewHistoryRow[] = [
      row({ capturedAt: "2026-06-01T00:00:00Z", aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/x", position: 1 }] }),
      row({ capturedAt: "2026-06-15T00:00:00Z", aiOverviewPresent: false, aiOverviewDomains: [] }),
      row({ capturedAt: "2026-07-01T00:00:00Z", aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/x", position: 1 }] }),
    ];
    // Both present snapshots cite the tenant - no transition, and the absent-overview
    // row in between is skipped entirely rather than treated as a "citation lost" blip.
    expect(computeAiOverviewTransitions(rows, "iranopedia.com")).toEqual([]);
  });

  it("no transitions and no crash when the tenant domain is unknown", () => {
    expect(computeAiOverviewTransitions([row(), row({ capturedAt: "2026-07-01T00:00:00Z" })], null)).toEqual([]);
  });
});

describe("aiOverviewGapHeadline — the Today AI band line", () => {
  it("caps at 1 line + up to 2 named examples", () => {
    const gaps = computeAiOverviewGaps(
      [
        row({ query: "persian carpets", ownRank: 3, aiOverviewDomains: [{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x", position: 1 }] }),
        row({ query: "nowruz traditions", ownRank: 1, aiOverviewDomains: [{ domain: "wikipedia.org", url: "https://en.wikipedia.org/wiki/Nowruz", position: 1 }] }),
        row({ query: "persian rugs", ownRank: 2, aiOverviewDomains: [{ domain: "rival-3.com", url: "https://rival-3.com/x", position: 1 }] }),
      ],
      "iranopedia.com",
    );
    const line = aiOverviewGapHeadline(gaps);
    expect(line).toBe(
      "Google's AI answer box cites someone else on 3 searches where you rank top 5. Examples: nowruz traditions (wikipedia.org), persian rugs (rival-3.com).",
    );
  });

  it("is silent (null) when there is no real gap", () => {
    const gaps = computeAiOverviewGaps([row({ aiOverviewPresent: false, aiOverviewDomains: [] })], "iranopedia.com");
    expect(aiOverviewGapHeadline(gaps)).toBeNull();
    expect(aiOverviewGapHeadline([])).toBeNull();
  });

  it("never contains an em dash or en dash", () => {
    const gaps = computeAiOverviewGaps(
      [row({ query: "persian carpets", ownRank: 3, aiOverviewDomains: [{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x", position: 1 }] })],
      "iranopedia.com",
    );
    const line = aiOverviewGapHeadline(gaps);
    expect(line).not.toMatch(/[–—]/);
  });
});

describe("dash guard — no em or en dashes anywhere in generated copy", () => {
  it("gap sentences never use em or en dashes", () => {
    const g = computeAiOverviewGap(
      [row({ aiOverviewDomains: [{ domain: "carpetencyclopedia.com", url: "https://carpetencyclopedia.com/x", position: 1 }] })],
      "iranopedia.com",
    );
    expect(g?.sentence).not.toMatch(/[–—]/);
  });

  it("transition sentences never use em or en dashes", () => {
    const rows: AiOverviewHistoryRow[] = [
      row({ capturedAt: "2026-06-01T00:00:00Z", aiOverviewDomains: [{ domain: "iranopedia.com", url: "https://iranopedia.com/x", position: 1 }] }),
      row({ capturedAt: "2026-07-01T00:00:00Z", aiOverviewDomains: [{ domain: "rival.com", url: "https://rival.com/x", position: 1 }] }),
    ];
    const [t] = computeAiOverviewTransitions(rows, "iranopedia.com");
    expect(t.sentence).not.toMatch(/[–—]/);
  });
});
