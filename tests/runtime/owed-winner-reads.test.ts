/** THE ONE RULE THAT DECIDES WHICH SEARCHES OWE A PAGE READING, AND WHAT THE RECEIPT MAY PROMISE FOR THEM. Both
 *  callers read `owedWinnerReads`: the runtime receipt that makes the read due and says the number on the operator's
 *  own screen, and the pass that reserves the reads. Two synthetic accounts, unrelated subjects, real pure functions. */
import { describe, it, expect } from "vitest";
import { owedWinnerReads, rankWinningPages } from "@/domains/evidence/funnel/normalize";

const SITES = [{ t: "acct-reef", url: "https://acct-reef.example/tide-pool-guide", q: "tide pool safety" },
  { t: "acct-loom", url: "https://acct-loom.example/blackwork-stitches", q: "ordre des points blackwork" }] as const;
type Site = (typeof SITES)[number];

describe("owedWinnerReads, the receipt and the unit reading one rule", () => {
  const serp = (query: string, at: string, urls: string[], status = "done") => ({ query, status, observedAt: at, organic: urls.map((u, i) => ({ url: u, rank: i + 1 })) });
  const own = (s: Site) => new URL(s.url).hostname;
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
    const own = new URL(s.url).hostname, WINNER_READ_BUDGET = 15;
    const serps = ["q1", "q2", "q3"].map((q, n) => ({ query: `${q} ${s.q}`, status: "done", observedAt: `2026-09-0${n + 1}T01:00:00Z`,
      organic: Array.from({ length: 10 }, (_, i) => ({ url: `https://${q}-p${i}.example/a`, rank: i + 1 })) }));
    const owed = owedWinnerReads(serps, [], own);
    const organic = serps.flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
    const aiCited = Array.from({ length: 10 }, (_, i) => ({ citedUrl: `https://ai-cited-${i}.example/a`, kind: "ai_citation", query: "", engine: "chatgpt", promptText: "p" }));
    const picked = rankWinningPages([...organic, ...aiCited] as never, own, WINNER_READ_BUDGET, owed.queries);
    const owedKeys = new Set(owed.pageKeys), read = picked.filter((c) => !c.standby && owedKeys.has(c.url.replace(/^https?:\/\//, "").replace(/\/$/, "")));
    expect([owed.pageKeys.length, read.length],
      "Today says this many pages winning a search already bought are owed a read and that the next pass reads them, so the promise is the reserve itself: three publishers a search, never the thirty pages of those searches, of which the pass would open nine")
      .toEqual([9, 9]);
  });
});
