import { describe, it, expect } from "vitest";
import { assembleBotReferralSignals } from "./load-bot-referral-signals";
import type { ProfoundBotRow } from "./bot-coverage";
import type { ProfoundReferralRow } from "./referral-signals";

const bot = (o: Partial<ProfoundBotRow>): ProfoundBotRow => ({
  date: "2026-06-20", path: "/persian-boy-names", botName: "GPTBot", botType: "ai", hitCount: 5, citations: 1, ...o,
});
const ref = (o: Partial<ProfoundReferralRow>): ProfoundReferralRow => ({
  date: "2026-06-21", path: "/persian-boy-names", referralSource: "chatgpt.com", referralType: "ai_assistant", visits: 3, ...o,
});

describe("assembleBotReferralSignals — honest empty + real aggregates", () => {
  it("EMPTY rows → hasData:false, no fabricated signals", () => {
    const s = assembleBotReferralSignals([], []);
    expect(s.hasData).toBe(false);
    expect(s.hasBotData).toBe(false);
    expect(s.hasReferralData).toBe(false);
    expect(s.botByPath).toEqual([]);
    expect(s.referralByPath).toEqual([]);
    expect(s.botSummary.totalHits).toBe(0);
    expect(s.referralSummary.totalVisits).toBe(0);
    expect(s.latestDate).toBeNull();
  });
  it("bot rows only → hasBotData, aggregates, latestDate from bot feed", () => {
    const s = assembleBotReferralSignals([bot({}), bot({ date: "2026-06-22", hitCount: 2 })], []);
    expect(s.hasData).toBe(true);
    expect(s.hasBotData).toBe(true);
    expect(s.hasReferralData).toBe(false);
    expect(s.botSummary.totalHits).toBe(7);
    expect(s.botByPath[0].path).toBe("/persian-boy-names");
    expect(s.latestDate).toBe("2026-06-22");
  });
  it("referral rows → per-page visits + sources + latest across both feeds", () => {
    const s = assembleBotReferralSignals([bot({ date: "2026-06-19" })], [ref({}), ref({ date: "2026-06-25", visits: 4, referralSource: "perplexity.ai" })]);
    expect(s.hasReferralData).toBe(true);
    expect(s.referralSummary.totalVisits).toBe(7);
    expect(s.referralByPath[0].visits).toBe(7);
    expect(s.referralByPath[0].sources.length).toBe(2);
    expect(s.latestDate).toBe("2026-06-25"); // newest across bot + referral
  });
});
