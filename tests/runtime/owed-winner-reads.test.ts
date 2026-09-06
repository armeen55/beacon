/** THE ONE RULE THAT DECIDES WHICH SEARCHES OWE A PAGE READING, AND WHAT THE RECEIPT MAY PROMISE FOR THEM. Both
 *  callers read `owedWinnerReads`: the runtime receipt that makes the read due and says the number on the operator's
 *  own screen, and the pass that reserves the reads. Two synthetic accounts, unrelated subjects, real pure functions. */
import { describe, it, expect } from "vitest";
import { owedWinnerReads, rankWinningPages } from "@/domains/evidence/funnel/normalize";
import { focusReads } from "@/domains/runtime/ops/investigation-queries";

const SITES = [{ t: "acct-reef", url: "https://acct-reef.example/tide-pool-guide", q: "tide pool safety" },
  { t: "acct-loom", url: "https://acct-loom.example/blackwork-stitches", q: "ordre des points blackwork" }] as const;
type Site = (typeof SITES)[number];
const serp = (query: string, at: string, urls: string[], status = "done") => ({ query, status, observedAt: at, organic: urls.map((u, i) => ({ url: u, rank: i + 1 })) });
const own = (s: Site) => new URL(s.url).hostname, key = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const WINNER_READ_BUDGET = 15;
/** THE PROMISE AND THE ORDER THE PASS TAKES, MEASURED TOGETHER through the same two functions the unit calls, in the
 *  same order: what the receipt says is owed a read, and which of exactly those pages the pass puts in front of its
 *  reader. `focus` stands in for the focused cases the pass already carries and is handed to the rule, never composed
 *  here, so a caller that ever appends them the other way round is caught by these arms and not by production. */
const both = (s: Site, serps: readonly unknown[], banked: readonly string[] = [], focus: readonly string[] = []) => {
  const owed = owedWinnerReads(serps, banked, own(s), focus);
  const organic = (serps as { query: string; organic: { url: string; rank: number }[] }[])
    .flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
  const picked = rankWinningPages(organic as never, own(s), WINNER_READ_BUDGET, owed.queries);
  const read = new Set(picked.filter((c) => !c.standby).map((c) => key(c.url)));
  return { promised: owed.pageKeys.length, owedSearches: owed.queries.length - focus.length, unread: owed.pageKeys.filter((k) => !read.has(k)), readTotal: read.size };
};

describe("owedWinnerReads, the receipt and the unit reading one rule", () => {
  it.each(SITES)("$t: fewer than ten results, an all-noise search, two searches sharing a page, and one search done twice", (s) => {
    const short = owedWinnerReads([serp("a", "2026-09-06T01:00:00Z", ["https://p1.example/x", "https://p2.example/y"])], [], own(s));
    const noise = owedWinnerReads([serp("b", "2026-09-06T01:00:00Z", ["https://reddit.com/r/x", `https://${own(s)}/mine`])], [], own(s));
    const shared = owedWinnerReads([serp("c", "2026-09-06T02:00:00Z", ["https://p1.example/x"]), serp("d", "2026-09-06T03:00:00Z", ["https://p1.example/x", "https://p3.example/z"])], [], own(s));
    const twice = owedWinnerReads([serp("e", "2026-09-06T01:00:00Z", ["https://p1.example/x"]), serp("e", "2026-09-06T05:00:00Z", ["https://p2.example/y"])], [], own(s));
    const held = owedWinnerReads([serp("f", "2026-09-06T01:00:00Z", ["https://p1.example/x", "https://p2.example/y"])], ["https://p1.example/x"], own(s));
    expect([short.pageKeys.length, noise.queries, shared.queries, shared.pageKeys.length, twice.queries, twice.pageKeys.length, held.queries],
      "a short results page owes both its pages; a search whose whole top ten is this account's own or a forum owes nothing; two searches sharing a page count that page once; one search seen twice is ONE owed search carrying both readings; and a search already holding a page on file is represented and owes nothing")
      .toEqual([2, [], ["d", "c"], 2, ["e"], 2, []]);
  });
  it.each(SITES)("$t: one search under two spellings is one owed search to the receipt and one case to the reserve", (s) => {
    const two = owedWinnerReads([serp("Tide Pool Safety", "2026-09-06T01:00:00Z", ["https://p1.example/x"]), serp("tide pool safety", "2026-09-06T02:00:00Z", ["https://p2.example/y"])], [], own(s));
    expect([two.queries.length, two.pageKeys.length], "the selection rule keys its map on the same canonical search the reserve keys its cases on, so a re-cased phrasing is ONE promise and one reservation, carrying both readings").toEqual([1, 2]);
  });
});

/** WHAT TODAY PROMISES AGAINST WHAT THE NEXT PASS TAKES: the pages of the searches the pass reserves for, and only
 *  the ones it reserves, with everything else left to the global weight order an AI-cited page always outranks. */
describe("the number Today says and the number the next pass reads", () => {
  it.each(SITES)("$t: three owed searches of ten pages promise nine reads and the pass reads exactly those nine", (s) => {
    const serps = ["q1", "q2", "q3"].map((q, n) => ({ query: `${q} ${s.q}`, status: "done", observedAt: `2026-09-0${n + 1}T01:00:00Z`,
      organic: Array.from({ length: 10 }, (_, i) => ({ url: `https://${q}-p${i}.example/a`, rank: i + 1 })) }));
    const owed = owedWinnerReads(serps, [], own(s));
    const organic = serps.flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
    const aiCited = Array.from({ length: 10 }, (_, i) => ({ citedUrl: `https://ai-cited-${i}.example/a`, kind: "ai_citation", query: "", engine: "chatgpt", promptText: "p" }));
    const picked = rankWinningPages([...organic, ...aiCited] as never, own(s), WINNER_READ_BUDGET, owed.queries);
    const owedKeys = new Set(owed.pageKeys), read = picked.filter((c) => !c.standby && owedKeys.has(key(c.url)));
    expect([owed.pageKeys.length, read.length],
      "Today says this many pages winning a search already bought are owed a read and that the next pass reads them, so the promise is the reserve itself: three publishers a search, never the thirty pages of those searches, of which the pass would open nine")
      .toEqual([9, 9]);
  });
});

describe("the number Today says and the pages the next pass reserves", () => {
  it.each(SITES)("$t: two spellings of one search, one publisher, two publishers, and a page two searches share", (s) => {
    const spellings = both(s, [serp(`${s.q}`, "2026-09-06T01:00:00Z", ["https://p1.example/x"]), serp(s.q.toUpperCase(), "2026-09-06T02:00:00Z", ["https://p2.example/y"])]);
    const onePublisher = both(s, [serp(`one ${s.q}`, "2026-09-06T01:00:00Z", Array.from({ length: 10 }, (_, i) => `https://solo.example/a${i}`))]);
    const twoPublishers = both(s, [serp(`two ${s.q}`, "2026-09-06T01:00:00Z", ["https://p1.example/a", "https://p1.example/b", "https://p2.example/c", "https://p2.example/d"])]);
    const sharedPage = both(s, [serp(`left ${s.q}`, "2026-09-06T01:00:00Z", ["https://p1.example/x", "https://p2.example/y", "https://p3.example/z"]),
      serp(`right ${s.q}`, "2026-09-06T02:00:00Z", ["https://p1.example/x", "https://p4.example/w", "https://p5.example/v"])]);
    expect([[spellings.owedSearches, spellings.promised, spellings.unread], [onePublisher.promised, onePublisher.unread],
      [twoPublishers.promised, twoPublishers.unread], [sharedPage.promised, sharedPage.unread]],
      "one search however it is spelt is one promise carrying both readings; a search whose whole top ten is one publisher owes ONE read, because a second page from a source already held teaches nothing; a search with two publishers owes two; and a page two searches share is promised once. Every promised page is one the reserve actually opens.")
      .toEqual([[1, 2, []], [1, []], [2, []], [5, []]]);
  });

  it.each(SITES)("$t: the promise is never a page the pass will not open, whatever the account already has in focus", (s) => {
    // the reserve stops at MAX_PRIORITY_QUERIES (40) cases, so 39, 40 and 41 focused cases are the boundary a promise appended behind them falls off
    const owedSerp = serp(`unread ${s.q}`, "2026-09-06T23:00:00Z", ["https://p1.example/x", "https://p2.example/y", "https://p3.example/z"]);
    const withFocus = (n: number) => { const focus = Array.from({ length: n }, (_, i) => `focus ${i} ${s.q}`);
      const serps = focus.map((q, k) => serp(q, `2026-09-0${(k % 9) + 1}T01:00:00Z`, [`https://f${k}.example/a`]));
      // the focused searches already hold a page on file, so only the last search is OWED a read
      return both(s, [...serps, owedSerp], serps.flatMap((x) => x.organic.map((o) => o.url)), focus); };
    expect([withFocus(39).unread, withFocus(40).unread, withFocus(41).unread, withFocus(40).promised],
      "Today says these pages are owed a read and that the next pass reads them, so a reserve the pass cannot spend on them makes the sentence say a number nobody will read: the owed searches are cut into the ceiling ahead of the focused tail, and the promise is kept on either side of it")
      .toEqual([[], [], [], 3]);
  });
});

/** The account the boundary needs: `n` focused cases, each already holding its own page on file, plus ONE search
 *  nothing has ranked, which is the search the receipt owes a read for. */
const account = (s: Site, n: number) => {
  const focus = Array.from({ length: n }, (_, i) => `focus ${i} ${s.q}`);
  const held = focus.map((q, k) => serp(q, `2026-09-0${(k % 9) + 1}T01:00:00Z`, [`https://f${k}.example/a`]));
  const owedSerp = serp(`unread ${s.q}`, "2026-09-06T23:00:00Z", ["https://p1.example/x", "https://p2.example/y", "https://p3.example/z"]);
  const serps = [...held, owedSerp], banked = held.flatMap((x) => x.organic.map((o) => o.url));
  const organic = serps.flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
  return { focus, serps, banked, organic }; };

/** EXACTLY THE TWO LINES THE UNIT RUNS. Nothing is composed here, so a caller that ever appended the owed searches
 *  itself would be caught by these arms rather than in production. */
const pass = (s: Site, n: number) => { const a = account(s, n);
  const priority = owedWinnerReads(a.serps, a.banked, own(s), a.focus).queries;
  const picked = rankWinningPages(a.organic as never, own(s), WINNER_READ_BUDGET, priority);
  const reserved = picked.filter((c) => !c.standby && c.ownerQuery), reservedKeys = new Set(reserved.map((c) => key(c.url)));
  const receipt = owedWinnerReads(a.serps, a.banked, own(s)).pageKeys; // the runtime receipt asks the same rule with NO focus (due-work.ts:392)
  return { priority, receipt, reserved: reserved.length, promisedAndOpened: receipt.filter((k) => reservedKeys.has(k)).length,
    focusedOpened: a.focus.filter((_, i) => reservedKeys.has(key(`https://f${i}.example/a`))).length, focusedTotal: n,
    readTotal: picked.filter((c) => !c.standby).length }; };

describe("the priority order the rule returns and the order the pass takes", () => {
  it.each(SITES)("$t: every page the receipt promises is opened by the RESERVE at 39, 40 and 41 focused cases", (s) => {
    const at = [39, 40, 41].map((n) => pass(s, n));
    expect(at.map((x) => [x.receipt.length, x.promisedAndOpened]),
      "the promise is three pages of a search already bought, and on either side of the ceiling the reserve itself opens exactly those three: not the global weight order, which the file's own starvation pin proves a page bought this morning loses")
      .toEqual([[3, 3], [3, 3], [3, 3]]);
  });

  it.each(SITES)("$t: the receipt is the same number whatever the account has in focus", (s) => {
    expect([pass(s, 0).receipt.length, pass(s, 39).receipt.length, pass(s, 41).receipt.length],
      "due-work asks this rule with no focus at all, so what Today says is owed a read cannot move with the size of the plan")
      .toEqual([3, 3, 3]);
  });

  it.each(SITES)("$t: MEASURED: past the ceiling the tail of the focus loses its reserve, and nothing else counts it back", (s) => {
    const under = pass(s, 36), over = pass(s, 41);
    expect([[under.focusedOpened, under.focusedTotal], [over.focusedOpened, over.focusedTotal]],
      "the one owed search is cut INTO the ceiling ahead of the focused tail, so the two focused cases past it are reserved nothing and their pages are opened by nobody: the trade B12 named, measured, and the reason the next arm bounds how many focused cases can exist")
      .toEqual([[36, 36], [39, 41]]);
  });
});

/** WHETHER THAT TRADE CAN EVER BE PAID. The only production caller of `winningPagesUnit` hands it `focusReads(...).queries`
 *  (research-steps.ts:372, :379), which is one string per FROZEN TOPIC, and a run freezes at most MAX_PRIORITY_QUERIES
 *  (3) of them (investigation-queries.ts:29, :37). */
describe("how wide the focus can be on the only path that reaches this rule", () => {
  it.each(SITES)("$t: the frozen plan hands one search per topic and nothing widens it", (s) => {
    const topics = [1, 2, 3].map((i) => ({ topicKey: `case-${i}`, query: `${s.q} ${i}`, requirement: "no_serp", retryAfter: null, ownedUrl: null }));
    const read = focusReads({ basis: "b1", topics } as never, Date.parse("2026-09-06T00:00:00Z"), "b1");
    const wide = pass(s, read.queries.length);
    expect([read.queries.length, wide.focusedOpened, wide.receipt.length, wide.promisedAndOpened],
      "three focused cases and three owed pages is six of a forty-case ceiling, so the cut the rule applies takes nothing from anybody on the path production actually walks")
      .toEqual([3, 3, 3, 3]);
  });
});
