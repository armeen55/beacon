/**
 * 2026-07-01 - AI-referral loader tests (BEACON_500 item 6).
 *
 * Pins src/domains/ai-visibility/ai-referrals.ts:
 *   - mapAiReferralRow: raw table row -> fact, numeric-string coercion,
 *     malformed rows dropped (never guessed)
 *   - summarizeAiReferrals math: totals, bySource desc, topPages capped at 10
 *     with a per-page top source, byDay ascending, latestDay
 *   - honest zero-state: zero facts AND zero-session facts both read as
 *     hasData false; aiReferralTodayLine is NULL at zero (silence, no fake win)
 *   - aiReferralTodayLine wording: concrete number, first person, top source,
 *     short path, no banned dashes
 *   - loadAiReferralSummary fail-soft: missing table or read error -> empty
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const _limitMock = vi.fn();
const _queryChain = {
  select: vi.fn(() => _queryChain),
  eq: vi.fn(() => _queryChain),
  gte: vi.fn(() => _queryChain),
  limit: (...a: unknown[]) => _limitMock(...a),
};
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => _queryChain }),
}));

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  aiReferralTodayLine,
  emptyAiReferralSummary,
  loadAiReferralSummary,
  mapAiReferralRow,
  shortAiReferralPath,
  summarizeAiReferrals,
  type AiReferralFact,
} from "@/domains/ai-visibility/ai-referrals";

const BANNED_DASH = /[‒–—―]/;

const fact = (over: Partial<AiReferralFact>): AiReferralFact => ({
  pagePath: "/iran-cheetah",
  day: "2026-06-30",
  sourceDomain: "chatgpt.com",
  sessions: 1,
  engagedSessions: 1,
  keyEvents: 0,
  ...over,
});

beforeEach(() => {
  _limitMock.mockReset();
});

describe("mapAiReferralRow", () => {
  it("maps a raw row and coerces numeric strings", () => {
    expect(
      mapAiReferralRow({
        page_path: "/a",
        day: "2026-06-30",
        source_domain: "chatgpt.com",
        sessions: "7",
        engaged_sessions: 5,
        key_events: "1.5",
      }),
    ).toEqual({
      pagePath: "/a",
      day: "2026-06-30",
      sourceDomain: "chatgpt.com",
      sessions: 7,
      engagedSessions: 5,
      keyEvents: 1.5,
    });
  });

  it("trims a timestamp day to YYYY-MM-DD and zeroes unparseable metrics", () => {
    const f = mapAiReferralRow({
      page_path: "/a",
      day: "2026-06-30T00:00:00",
      source_domain: "claude.ai",
      sessions: "abc",
    });
    expect(f).toMatchObject({ day: "2026-06-30", sessions: 0, engagedSessions: 0, keyEvents: 0 });
  });

  it("drops rows missing identity columns", () => {
    expect(mapAiReferralRow({ day: "2026-06-30", source_domain: "chatgpt.com" })).toBeNull();
    expect(mapAiReferralRow({ page_path: "/a", source_domain: "chatgpt.com" })).toBeNull();
    expect(mapAiReferralRow({ page_path: "/a", day: "2026-06-30" })).toBeNull();
  });
});

describe("summarizeAiReferrals - loader math", () => {
  const facts: AiReferralFact[] = [
    fact({ pagePath: "/iran-cheetah", day: "2026-06-29", sourceDomain: "chatgpt.com", sessions: 5, engagedSessions: 4, keyEvents: 1 }),
    fact({ pagePath: "/iran-cheetah", day: "2026-06-30", sourceDomain: "perplexity.ai", sessions: 2, engagedSessions: 1, keyEvents: 0.5 }),
    fact({ pagePath: "/farsi-numbers", day: "2026-06-30", sourceDomain: "chatgpt.com", sessions: 3, engagedSessions: 2, keyEvents: 0 }),
  ];

  it("computes totals, per-source and per-day rollups, and latestDay", () => {
    const s = summarizeAiReferrals(facts, 30);
    expect(s.hasData).toBe(true);
    expect(s.windowDays).toBe(30);
    expect(s.totalSessions).toBe(10);
    expect(s.totalEngagedSessions).toBe(7);
    expect(s.totalKeyEvents).toBe(1.5);
    expect(s.bySource.map((x) => [x.sourceDomain, x.sessions])).toEqual([
      ["chatgpt.com", 8],
      ["perplexity.ai", 2],
    ]);
    expect(s.bySource[0]!.label).toBe("ChatGPT");
    expect(s.byDay).toEqual([
      { day: "2026-06-29", sessions: 5 },
      { day: "2026-06-30", sessions: 5 },
    ]);
    expect(s.latestDay).toBe("2026-06-30");
  });

  it("ranks pages by sessions with each page's top source", () => {
    const s = summarizeAiReferrals(facts, 30);
    expect(s.topPages.map((p) => p.pagePath)).toEqual(["/iran-cheetah", "/farsi-numbers"]);
    expect(s.topPages[0]).toMatchObject({
      sessions: 7,
      engagedSessions: 5,
      keyEvents: 1.5,
      topSource: { sourceDomain: "chatgpt.com", label: "ChatGPT", sessions: 5 },
    });
  });

  it("caps topPages at 10", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      fact({ pagePath: `/p${i}`, sessions: i + 1 }),
    );
    const s = summarizeAiReferrals(many, 30);
    expect(s.topPages).toHaveLength(10);
    expect(s.topPages[0]!.pagePath).toBe("/p13");
  });

  it("honest zero: no facts and zero-session facts both read hasData false", () => {
    expect(summarizeAiReferrals([], 30)).toEqual(emptyAiReferralSummary(30));
    const s = summarizeAiReferrals([fact({ sessions: 0, engagedSessions: 0 })], 30);
    expect(s.hasData).toBe(false);
    expect(s.latestDay).toBeNull();
  });
});

describe("aiReferralTodayLine - the one honest line", () => {
  it("is silent (null) at zero", () => {
    expect(aiReferralTodayLine(emptyAiReferralSummary(30))).toBeNull();
    expect(aiReferralTodayLine(summarizeAiReferrals([fact({ sessions: 0 })], 30))).toBeNull();
  });

  it("names the number, the top assistant, and the top page", () => {
    const s = summarizeAiReferrals(
      [
        fact({ pagePath: "/iran-cheetah", sourceDomain: "chatgpt.com", sessions: 200 }),
        fact({ pagePath: "/farsi-numbers", sourceDomain: "perplexity.ai", sessions: 14 }),
      ],
      30,
    );
    expect(aiReferralTodayLine(s)).toBe(
      "AI assistants sent you 214 visitors these 30 days, most from ChatGPT, most to /iran-cheetah.",
    );
  });

  it("uses the singular for exactly one visitor", () => {
    const s = summarizeAiReferrals([fact({ sessions: 1 })], 30);
    expect(aiReferralTodayLine(s)).toContain("sent you 1 visitor these 30 days");
  });

  it("never emits a banned dash", () => {
    const s = summarizeAiReferrals(
      [fact({ pagePath: "/a-very-long-path-name-that-keeps-going-and-going-and-going", sessions: 1234 })],
      30,
    );
    const line = aiReferralTodayLine(s);
    expect(line).not.toBeNull();
    expect(BANNED_DASH.test(line!)).toBe(false);
  });
});

describe("shortAiReferralPath", () => {
  it("strips origin and trailing slash; root stays /", () => {
    expect(shortAiReferralPath("https://iranopedia.com/iran-cheetah/")).toBe("/iran-cheetah");
    expect(shortAiReferralPath("/")).toBe("/");
    expect(shortAiReferralPath("")).toBe("/");
  });

  it("truncates very long paths with an ellipsis of periods", () => {
    const long = "/" + "x".repeat(60);
    const short = shortAiReferralPath(long);
    expect(short.length).toBe(48);
    expect(short.endsWith("...")).toBe(true);
  });
});

describe("loadAiReferralSummary - fail-soft reads", () => {
  it("missing table (PGRST205) collapses to the empty summary", async () => {
    _limitMock.mockResolvedValue({ data: null, error: { code: "PGRST205", message: "no table" } });
    const s = await loadAiReferralSummary("t1", 30);
    expect(s).toEqual(emptyAiReferralSummary(30));
  });

  it("read error collapses to empty instead of throwing", async () => {
    _limitMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    const s = await loadAiReferralSummary("t1", 7);
    expect(s).toEqual(emptyAiReferralSummary(7));
  });

  it("maps real rows into a summary", async () => {
    _limitMock.mockResolvedValue({
      data: [
        {
          page_path: "/iran-cheetah",
          day: "2026-06-30",
          source_domain: "chatgpt.com",
          sessions: 6,
          engaged_sessions: 4,
          key_events: 1,
        },
      ],
      error: null,
    });
    const s = await loadAiReferralSummary("t2", 30);
    expect(s.hasData).toBe(true);
    expect(s.totalSessions).toBe(6);
    expect(s.topPages[0]!.pagePath).toBe("/iran-cheetah");
  });
});
