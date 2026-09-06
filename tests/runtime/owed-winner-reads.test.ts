/** THE ONE RULE THAT DECIDES WHICH SEARCHES OWE A PAGE READING, AND WHAT THE RECEIPT MAY PROMISE FOR THEM. Both
 *  callers read `owedWinnerReads`: the runtime receipt that makes the read due and says the number on the operator's
 *  own screen, and the pass that reserves the reads. Two synthetic accounts, unrelated subjects, real pure functions. */
import { describe, it, expect } from "vitest";
import { owedWinnerReads, rankWinningPages } from "@/domains/evidence/funnel/normalize";

const SITES = [{ t: "acct-reef", url: "https://acct-reef.example/tide-pool-guide", q: "tide pool safety" },
  { t: "acct-loom", url: "https://acct-loom.example/blackwork-stitches", q: "ordre des points blackwork" }] as const;
type Site = (typeof SITES)[number];
const serp = (query: string, at: string, urls: string[], status = "done") => ({ query, status, observedAt: at, organic: urls.map((u, i) => ({ url: u, rank: i + 1 })) });
const own = (s: Site) => new URL(s.url).hostname, key = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
/** THE PROMISE AND THE ORDER THE PASS TAKES, MEASURED TOGETHER through the same two functions the unit calls, in the
 *  same order: what the receipt says is owed a read, and which of exactly those pages the pass puts in front of its
 *  reader. `focus` stands in for the focused cases the pass already carries and is handed to the rule, never composed
 *  here, so a caller that ever appends them the other way round is caught by these arms and not by production. */
const both = (s: Site, serps: readonly unknown[], banked: readonly string[] = [], focus: readonly string[] = []) => {
  const owed = owedWinnerReads(serps, banked, own(s), focus);
  const organic = (serps as { query: string; organic: { url: string; rank: number }[] }[])
    .flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
  const picked = rankWinningPages(organic as never, own(s), 15, owed.queries);
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
    const WINNER_READ_BUDGET = 15;
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
