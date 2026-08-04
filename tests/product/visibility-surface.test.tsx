/** VISIBILITY (Dream V1 Phase 7). What a customer READS on the surface that answers "is my visibility moving, and why":
 *  both tabs, the honest limitation without Google, the day every number was read on, the days nobody read, a trend that
 *  STOPS where the instrument changed, and what each recurring domain is. Fixtures only, no clock, no dash, no lab word. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseFake, type Row } from "../helpers/supabase-fake";
import { renderToStaticMarkup } from "react-dom/server";
const store = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reads: [] as { max: number; cols: string }[], fetched: [] as unknown[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => supabaseFake({
  rows: () => store.rows, onSelect: (_t, r) => store.reads.push({ max: r.max, cols: r.cols }) }) }));
globalThis.fetch = (async (...a: unknown[]) => { store.fetched.push(a); throw new Error("no provider call is allowed from Visibility"); }) as typeof fetch;
import type { AiOutcomeReport } from "@/domains/measurement";
import { aiTrend } from "@/app/(shell)/results/results-presentation";
import { aiView, answerView, googleView, type AnswerRow, type VisBlock } from "@/app/(shell)/visibility/visibility-view";
import { readAiObservations } from "@/domains/evidence/ai-visibility/ai-observations";
import { VisibilityTabs } from "@/app/(shell)/visibility/visibility-tabs";
import VisibilityPage from "@/app/(shell)/visibility/page"; import type { ReactElement } from "react";
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
const at = (v: { blocks: VisBlock[] }, title: string): VisBlock => v.blocks.find((b) => b.title === title)!;

const TENANT = "acct-a", DAY = "2026-08-02";
/** A whole AI answer is thousands of characters; the old view cut it at 1,400 with no way to the rest. */
const LONG_ANSWER = `You can order a haft seen set from a few specialist shops. ${"the haft seen table is the centre of nowruz. ".repeat(105)}`.slice(0, 5000).trim();
const ROW: AnswerRow = { id: "obs_7", day: DAY, promptId: "p1", promptText: "where to buy a haft seen set", engine: "chatgpt",
  slot: 0, answered: true, mentioned: true, cited: true,
  // MORE THAN TWELVE real fan-outs, and the tracked question itself among them: the row keeps it, the summary drops it.
  fanOuts: [...Array.from({ length: 13 }, (_, i) => `haft seen search ${i}`), "haft seen set delivery", "nowruz table shop", "where to buy a haft seen set"],
  answerText: LONG_ANSWER,
  // FIFTEEN cited pages, past the old ten, with the passage the provider stored on the first of them.
  citations: [{ url: "https://own.example/haft-seen", domain: "own.example", owned: true },
    { url: "https://standards.example/nowruz", domain: "standards.example", owned: false, passage: "the haft seen table" },
    ...Array.from({ length: 13 }, (_, i) => ({ url: `https://shop${i}.example/a`, domain: `shop${i}.example`, owned: false }))],
  retrievedNotCited: ["https://other.example/x"],
  modelRequested: "gpt-x-preview", modelServed: "gpt-x", mode: "api",
  askedAt: "9:02 AM Pacific", answeredAt: "9:02 AM Pacific", receipt: "answer:9f3c1", costUsd: 0.02,
  failureReason: null, reading: "read" };
/** THE WHOLE SURFACE, so the server actions it hands the browser can be invoked exactly as a stale tab would invoke them. Everything except the observation
 *  store itself is stubbed: what is under test is WHOSE account an action reads for, and what it says when it may not read at all. */
const SESSION = vi.hoisted(() => ({ id: "acct-a" }));
const JOURNEY = vi.hoisted(() => ({ props: null as null | { tenantId: string; days: Array<{ day: string; label: string }>;
  page: (t: string, day: string, after: string | null) => Promise<{ rows: unknown[]; cursor: string | null; note: string | null; replace?: boolean }>;
  open: (t: string, id: string) => Promise<string[]> } }));
vi.mock("@/app/(shell)/visibility/answers-client", () => ({ AnswerJourney: (p: never) => { JOURNEY.props = p; return null; } }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantId: async () => SESSION.id }));
vi.mock("@/domains/account", () => ({ requireReadyAccount: async (t: string) => ({ access: { kind: t === SESSION.id ? "ready" : "suspended" } }), loadBusinessProfile: async () => null }));
vi.mock("@/domains/decision", () => ({ loadDailyTotalsForTenant: async () => [] }));
vi.mock("@/domains/runtime", () => ({ researchRunStatus: async () => null }));
vi.mock("@/domains/measurement", () => ({ buildScoreboard: () => null, visibilitySeries: async () => SEGMENTS }));
const { reads, fetched } = store;
/** 140 stored readings on ONE day: 35 tracked questions across 4 assistants, which is a live day. */
beforeEach(() => {
  store.reads.length = 0; store.fetched.length = 0;
  store.rows = Array.from({ length: 140 }, (_, i) => ({
    id: `obs_${i}`, tenant_id: TENANT, site: "own.example", prompt_id: `p${i % 35}`, prompt_version: 1,
    prompt_text: `question ${i % 35}`, engine: ["chatgpt", "claude", "gemini", "perplexity"][i % 4], sample_slot: 0,
    reporting_day: DAY, status: "observed", requested_at: `2026-08-02T${String(i % 24).padStart(2, "0")}:00:${String(i % 60).padStart(2, "0")}Z`,
    answer_text: "x".repeat(5000), answer_hash: "h", analysis: null, analysis_hash: null,
    journey: { fan_outs: null, retrieved_results: null, cited_sources: null, brand_mentions: null, web_search_reported: null },
  } as Row));
});

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
  // PIN: ONE READING OPENS INTO THE WHOLE OF ITSELF, cut nowhere. The prompt word for word, the complete
  // answer however long, EVERY search that answer ran, EVERY page it credited with the part it quoted, what
  // it read without crediting, both model names, the mode, the day, the instants, the cost, how far I have
  // read it, and the stored envelope's identity. A question I asked is never listed as a search the
  // assistant ran itself. And a page that moved says WHICH searches moved it.
  it("opens one question into the whole reading behind it, and a moved page into the searches under it", () => {
    const v = ai({ latest: { day: "2026-08-02", rows: [ROW] }, landscape: LANDSCAPE });
    const one = answerView(ROW, new Map(LANDSCAPE.map((l) => [l.domain, l.kind])));
    expect(one.head).toBe("where to buy a haft seen set (ChatGPT)");
    const all = one.details.join("\n");
    for (const s of [LONG_ANSWER, '"haft seen set delivery"', "https://own.example/haft-seen (your page)",
      "https://standards.example/nowruz (standards.example, a source)", 'It quoted this part: "the haft seen table"',
      "It also read these and credited none of them: https://other.example/x.",
      "ChatGPT answered as gpt-x, and gpt-x-preview is what I asked for, in api mode.",
      "This reading counts for Aug 2. Asked 9:02 AM Pacific, answered 9:02 AM Pacific.",
      "I have read every word of this answer closely.", "answer:9f3c1", "0.02 dollars"]) expect(all, s).toContain(s);
    // EVERY citation and EVERY fan-out, past the old ten and twelve, and the whole 5,000 character answer.
    expect(one.details.filter((d) => d.startsWith("https://")).length).toBe(15);
    expect(all).toContain(LONG_ANSWER); // not a first 1,400 characters with a count of what was cut
    // A TRACKED QUESTION OF MINE IS NEVER A SEARCH THE ASSISTANT RAN. The summary already dropped the self-echo; the ROW printed it
    // back as the assistant's own idea, which reads as Beacon discovering the exact question Beacon asked.
    const searched = one.details.find((d) => d.startsWith("Before answering it searched for"))!;
    expect((ROW.fanOuts ?? []).filter((q) => q !== ROW.promptText).every((q) => searched.includes(`"${q}"`))).toBe(true);
    expect(searched).not.toContain(ROW.promptText);
    expect(at(v, "What the assistants searched for").chips).not.toContain(ROW.promptText);
    expect(all).toContain(`I asked ChatGPT, word for word: "${ROW.promptText}"`); // the question is still quoted where it belongs
    // An answer whose ONLY fan-out was the echo ran no search of its own, and says exactly that.
    expect(answerView({ ...ROW, fanOuts: [ROW.promptText] }).details).toContain("It ran no searches of its own before answering.");
    // WHAT THE PROVIDER NEVER REPORTED SAYS SO, and is never printed as a factual none.
    const quiet = answerView({ ...ROW, fanOuts: null, citations: null, retrievedNotCited: null, reading: "unread" }).details.join("\n");
    for (const s of ["ChatGPT does not report the searches it ran on this path",
      "ChatGPT does not report which pages it used on this path, so I am not claiming it credited nobody.",
      "ChatGPT does not report the pages it read but did not credit on this path.",
      "Nobody has read this answer closely yet"]) expect(quiet, s).toContain(s);
    for (const gone of ["It ran no searches of its own", "It credited no pages at all", "Every page it read, it credited"]) expect(quiet).not.toContain(gone);
    const live = googleView({ hasData: true, decay: [{ page: "/nowruz", clicksNow: 20, clicksPrior: 60, positionNow: 12.4, positionPrior: 6.1 }],
      windowEnd: "2026-08-01", board: null, weekly: null,
      queriesByPage: new Map([["/nowruz", [{ query: "nowruz table", clicks: 12, impressions: 900, position: 8.2 }]]]) });
    expect(at(live, "Pages that moved").rows[0]!.details!.join("\n")).toContain('"nowruz table": 12 clicks from 900 appearances, at 8.2 on average.');
  });
  // PIN: A 140 READING DAY IS REACHABLE, ALL OF IT, one bounded page at a time, and the page read never asks
  // for the one heavy column. Reads only: no provider is ever called from this surface.
  it("pages a whole day of readings without ever loading a whole answer, and calls no provider", async () => {
    const seen = new Set<string>();
    let after: { at: string; id: string } | null = null;
    for (let guard = 0; guard < 12; guard += 1) {
      const page = await readAiObservations(TENANT, { day: DAY, limit: 25, projection: "list", after });
      for (const r of page) { seen.add(r.id); expect(r.answer_text).toBeUndefined(); } // the LIST read never carries it
      if (page.length < 25) break;
      const last = page[page.length - 1]!;
      after = { at: String(last.requested_at), id: last.id };
    }
    expect(seen.size).toBe(140);                                   // every canonical identity, none skipped
    expect(reads.every((r) => r.max <= 25)).toBe(true);            // one bounded page per request
    expect(reads.every((r) => !r.cols.includes("answer_text"))).toBe(true);
    const [one] = await readAiObservations(TENANT, { id: "obs_7", limit: 1 });
    expect(one!.answer_text).toHaveLength(5000);                   // the whole answer, only when asked for by itself
    expect(fetched).toHaveLength(0);                               // nothing on this path ever asks a provider
  });
  /** PHASE 4 (SECURITY) + 6C + 6D + 7, on the REAL surface. The actions used to close over the account the page was DRAWN with and read for THAT account with the
   *  service role, so a tab left open on one account and clicked after signing into another handed back the first account's stored answers. */
  it("refuses a stale tab's action for another account without reading a single row of it, keeps the way back open when a read fails, and opens any observed day", async () => {
    SESSION.id = TENANT;
    const page = await VisibilityPage() as ReactElement<{ children: ReactElement[] }>;
    const holder = (page.props.children[1]! as ReactElement<{ children: ReactElement }>).props.children as ReactElement<{ tenantId: string }>;
    renderToStaticMarkup(await (holder.type as (p: { tenantId: string }) => Promise<ReactElement>)(holder.props));
    const j = JOURNEY.props!;
    expect([j.tenantId, j.days.at(-1)]).toEqual([TENANT, { day: DAY, label: "Aug 2" }]); // every day I hold readings on is reachable, not only the newest
    const mine = await j.page(TENANT, DAY, null);
    expect([mine.rows.length, mine.note, mine.replace]).toEqual([25, null, true]);
    SESSION.id = "acct-b"; store.reads.length = 0; // the operator signed into another account; this tab is now stale
    const stale = await j.page(TENANT, DAY, "2026-08-02T05:00:05Z|obs_5");
    expect([stale.rows, stale.note, stale.cursor]).toEqual([[], "This page was open for a different account. Reload it and I will show you this account's answers.", "2026-08-02T05:00:05Z|obs_5"]);
    expect(await j.open(TENANT, "obs_7")).toEqual([stale.note]);
    expect(store.reads).toEqual([]); // THE PIN: not one admin read was issued for account A, so nothing of A's could leak
    expect(stale.note).not.toContain("every answer"); // and a refusal is never dressed up as the end of the day
    SESSION.id = TENANT; });
  it("says what one stored answer cost off the receipt it names, and refuses to call an unproven cost zero dollars", () => {
    expect(answerView(ROW).details.at(-1)).toBe("The stored answer this all comes off is filed as answer:9f3c1, and it cost 0.02 dollars to buy once.");
    expect(answerView({ ...ROW, costUsd: null }).details.at(-1)).toBe("The stored answer this all comes off is filed as answer:9f3c1, and I hold no receipt proving what it cost, so I am not putting a number on it.");
    // A SUB-CENT RECEIPT IS NOT ZERO DOLLARS. Two decimals printed a real 0.004 charge as "0.00 dollars", the exact free-when-it-was-paid claim this refuses.
    expect(answerView({ ...ROW, costUsd: 0.004 }).details.at(-1)).toContain("and it cost under a cent to buy once.");
    expect(answerView({ ...ROW, costUsd: null }, new Map(), 0.0073).details.at(-1)).toContain("under a cent"); }); // the exact cache receipt, resolved for a row that preserved none
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
