/**
 * 2026-07-01 - AI-referral row-mapper tests (BEACON_500 item 6, slimmed 2026-07-21
 * to the surviving live slice after the reader half was deleted).
 *
 * Pins src/domains/ai-visibility/ai-referrals.ts:
 *   - mapAiReferralRow: raw table row -> fact, numeric-string coercion,
 *     malformed rows dropped (never guessed)
 */

import { describe, it, expect } from "vitest";

import { mapAiReferralRow } from "@/domains/ai-visibility/ai-referrals";

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
