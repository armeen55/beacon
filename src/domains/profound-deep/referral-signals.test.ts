import { describe, it, expect } from "vitest";
import {
  aggregateReferralsByPage,
  referralOutcomeForPage,
  summarizeReferrals,
  type ProfoundReferralRow,
} from "./referral-signals";

const row = (date: string, path: string, source: string, visits: number): ProfoundReferralRow => ({
  date,
  path,
  referralSource: source,
  referralType: "ai_assistant",
  visits,
});

describe("aggregateReferralsByPage", () => {
  it("sums visits per page, ranks sources, canonicalizes paths", () => {
    const out = aggregateReferralsByPage([
      row("2026-06-01", "/iran-flags/", "chatgpt.com", 10),
      row("2026-06-02", "/iran-flags", "perplexity.ai", 5),
      row("2026-06-02", "/iran-flags", "chatgpt.com", 7),
      row("2026-06-01", "/persian-food", "chatgpt.com", 3),
    ]);
    const flags = out.find((p) => p.path === "/iran-flags")!;
    expect(flags.visits).toBe(22);
    expect(flags.sources[0]).toEqual({ source: "chatgpt.com", visits: 17 });
    expect(out[0].path).toBe("/iran-flags"); // ranked by visits
  });

  it("ignores zero/negative visits, empty paths", () => {
    expect(aggregateReferralsByPage([row("2026-06-01", "", "x", 5), row("2026-06-01", "/p", "x", 0)])).toEqual([]);
  });

  it("empty rows → empty (no fabrication)", () => {
    expect(aggregateReferralsByPage([])).toEqual([]);
  });
});

describe("referralOutcomeForPage — before/after AI-referral lift", () => {
  const rows = [
    row("2026-06-01", "/p", "chatgpt.com", 10), // before
    row("2026-06-05", "/p", "chatgpt.com", 10), // before
    row("2026-06-12", "/p", "chatgpt.com", 30), // after
    row("2026-06-14", "/p", "chatgpt.com", 30), // after
  ];
  it("detects a rise after the treatment date", () => {
    const o = referralOutcomeForPage(rows, "/p", "2026-06-08", 14);
    expect(o.beforeVisits).toBe(20);
    expect(o.afterVisits).toBe(60);
    expect(o.verdict).toBe("rose");
  });
  it("no data for the page → no_data (honest)", () => {
    expect(referralOutcomeForPage(rows, "/other", "2026-06-08").verdict).toBe("no_data");
  });
});

describe("summarizeReferrals", () => {
  it("totals visits + top sources", () => {
    const s = summarizeReferrals([row("2026-06-01", "/a", "chatgpt.com", 10), row("2026-06-01", "/b", "perplexity.ai", 4)]);
    expect(s.totalVisits).toBe(14);
    expect(s.pages).toBe(2);
    expect(s.topSources[0].source).toBe("chatgpt.com");
  });
});
