/** VISIBILITY (Dream V1 Phase 7). What a customer READS on the surface that answers "is my visibility moving, and why":
 *  both tabs, the honest limitation without Google, the day every number was read on, the days nobody read, a trend that
 *  STOPS where the instrument changed, and what each recurring domain is. Fixtures only, no clock, no dash, no lab word. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AiOutcomeReport } from "@/domains/measurement";
import { aiTrend } from "@/app/(shell)/results/results-presentation";
import { aiView, googleView } from "@/app/(shell)/visibility/visibility-view";
import { VisibilityTabs } from "@/app/(shell)/visibility/visibility-tabs";
import { ScoreboardChartTabs } from "@/app/(shell)/scoreboard-chart-tabs";
type Day = AiOutcomeReport["segments"][number]["days"][number]; // one reporting day as the kernel hands it over
const day = (d: string, rate: number | null, over: Partial<Day> = {}): Day => ({ day: d, observed: 10, analyzed: 10, mentioning: Math.round((rate ?? 0) * 10), mentionRate: rate,
  citationSample: 8, ownedCiting: 2, ownedCitationRate: 0.25, ownedCitationRank: 1, retrievalSample: 0, ownedRetrieved: 0, retrievedNotCited: 0, retrievedNotCitedRate: null,
  byEngine: [{ engine: "chatgpt", modelServed: "a", mode: "api", asked: 10, observed: 10, mentioning: 4, citedOwned: 2 }], ...over });
const SEGMENTS: AiOutcomeReport["segments"] = [
  { from: "2026-07-30", to: "2026-07-31", models: [], boundary: null, days: [day("2026-07-30", 0.2), day("2026-07-31", 0.3)] },
  { from: "2026-08-01", to: "2026-08-02", models: [], days: [day("2026-08-01", null, { observed: 0, analyzed: 0, citationSample: 0, ownedCiting: 0 }), day("2026-08-02", 0.5)], boundary: [{ engine: "chatgpt", day: "2026-08-02", fromModel: "a", toModel: "b", fromMode: "api", toMode: "api" }] }];
const LANDSCAPE = [{ domain: "standards.example", kind: "citation_authority" as const, why: "Engines cite it 7 times as a source and it never ranks against you.", evidence: { serpAppearances: 0, aiCitations: 7, competingQueries: 0 } }];
const ai = (over: Partial<Parameters<typeof aiView>[0]> = {}) => aiView({ segments: SEGMENTS, trend: aiTrend(SEGMENTS), windowDays: 5, landscape: null, checks: { done: 42, total: 48, answered: 40, unavailable: 2 }, latest: { day: "2026-08-02", rows: [] }, ...over });
const at = <T extends { blocks: Array<{ title: string; notes: string[]; rows: Array<{ head: string; body: string }>; runs: Array<{ breakLabel: string | null; span: string | null }> }> }>(v: T, title: string) => v.blocks.find((b) => b.title === title)!;

describe("Visibility explains where you stand, and never invents a score", () => {
  it("ships both tabs with both panels, keeps Today's chart to those same two, and never blanks without Google", () => {
    const tabs = renderToStaticMarkup(<VisibilityTabs google={<p>google panel</p>} ai={<p>ai panel</p>} />);
    const chart = renderToStaticMarkup(<ScoreboardChartTabs googleChart={<p>chart</p>} aiPoints={[{ date: "2026-08-01", value: 3 }, { date: "2026-08-02", value: 4 }]} />);
    for (const s of ["Google", "AI answers", "google panel", "ai panel"]) expect(tabs).toContain(s);
    expect(chart).toContain("AI answers"); for (const gone of ["Visitors", "Value"]) expect(chart).not.toContain(gone);
    const bare = googleView({ hasData: false, board: null, decay: [], windowEnd: null, weekly: null });
    expect(bare.blocks).toEqual([]); // it says what it cannot show rather than rendering an empty tab
    expect(bare.limitation).toBe("I do not have any Search Console numbers for this account, so I cannot show you clicks, appearances, or rankings here. Connect Google Search Console on Connections and I will fill this tab in on my next daily round.");
  });
  it("names the day Google's numbers end, and compares one page window with the window before it", () => {
    const live = googleView({ hasData: true, decay: [{ page: "/nowruz", clicksNow: 20, clicksPrior: 60, positionNow: 12.4, positionPrior: 6.1 }], windowEnd: "2026-08-01",
      board: { last7Clicks: 1204, last7Impressions: 40110, deltaPct: -12, reportedThrough: "2026-08-01" }, weekly: { lines: ["7 in 10 of your Google visitors are on phones."], weekEnd: "2026-07-27" } });
    expect(at(live, "Where Google has you").notes).toEqual(["You had 1,204 clicks and 40,110 appearances over the last 7 reported days. That is down 12% on the week before.",
      "Google's numbers run through Aug 1. Google reports a few days behind, so the newest days are still settling."]);
    expect(at(live, "Pages that moved").rows[0]).toEqual({ head: "Losing: /nowruz", body: "20 clicks, down from 60. I see it at 12.4 on average now, against 6.1 before." });
    expect(at(live, "How you show up on Google").notes[1]).toBe("I check this once a week. This is the week ending Jul 27.");
  });
  it("dates every AI number, counts the days it missed, breaks the line where the assistant changed, and names each domain", () => {
    const lines = at(ai(), "How often AI answers name you").notes, runs = at(ai(), "How often AI answers name you").runs;
    expect(lines[0]).toBe("On Aug 2 you were named in 5 of the 10 answers I read closely, and a page of yours was credited in 2 of the 8 that told me what they used.");
    expect(lines).toContain("I have settled 42 of the 48 answer checks I planned for today: 40 came back with an answer, 2 found nothing to give me.");
    expect(lines[lines.length - 1]).toBe("I read answers on 3 of the last 5 days. Aug 1 came back with nothing. A day I missed stays missed, and I never fill one in."); expect(runs).toHaveLength(2); expect(runs[0]!.breakLabel).toBeNull(); expect(runs.map((r) => r.span)).toEqual(["Jul 30 to Jul 31", "Aug 2 to Aug 2"]);
    expect(runs[1]!.breakLabel).toBe("ChatGPT changed the version behind its answers on Aug 2, so I start a new line here rather than joining two different readings.");
    expect(at(ai({ landscape: LANDSCAPE }), "Domains showing up around you").rows[0]).toEqual({ head: "standards.example", body: "A source. Engines cite it 7 times as a source and it never ranks against you." });
    expect(at(ai(), "Domains showing up around you").notes[0]).toContain("I could not put together the list of domains"); expect(ai({ segments: [], trend: aiTrend([]) }).empty).toContain("I have not read a single AI answer for this account yet.");
    for (const b of ai({ landscape: LANDSCAPE }).blocks) for (const s of [...b.notes, ...b.rows.flatMap((r) => [r.head, r.body])]) {
      expect(s, `dash or raw date stamp in: ${s}`).not.toMatch(/[–—]|\d{4}-\d{2}-\d{2}/);
      expect(s.toLowerCase(), `lab word in: ${s}`).not.toMatch(/\b(experiment|control|baseline|treatment|serp|cohort|statistically)\b/); } });
});
