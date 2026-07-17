import { describe, expect, it } from "vitest";

import { buildCompetitorRank } from "./performance-timeseries";

const classify = () => "direct" as const;

describe("buildCompetitorRank tenant identity", () => {
  it("uses the explicit tenant domain when a stored owned flag is false", () => {
    const rows = buildCompetitorRank(
      {
        by_page_and_topic: [
          {
            page_url: "https://www.iranopedia.com/people",
            domain: "www.iranopedia.com",
            is_owned: false,
            total_citations: 12,
          },
        ],
      },
      "https://iranopedia.com/",
      classify,
    );

    expect(rows[0]).toMatchObject({ domain: "iranopedia.com", isOwned: true });
  });

  it("does not let a stale true flag claim another tenant's domain", () => {
    const rows = buildCompetitorRank(
      {
        by_page_and_topic: [
          {
            page_url: "https://ritzbuilders.com/projects",
            domain: "ritzbuilders.com",
            is_owned: true,
            total_citations: 9,
          },
          {
            page_url: "https://learn.iranopedia.com/guide",
            domain: "learn.iranopedia.com",
            is_owned: false,
            total_citations: 7,
          },
        ],
      },
      "iranopedia.com",
      classify,
    );

    expect(rows.find((row) => row.domain === "ritzbuilders.com")?.isOwned).toBe(false);
    expect(rows.find((row) => row.domain === "learn.iranopedia.com")?.isOwned).toBe(true);
  });
});
