import { describe, it, expect } from "vitest";
import { owedWinnerReads, rankWinningPages } from "@/domains/evidence/funnel/normalize";
import { focusReads } from "@/domains/runtime/ops/investigation-queries";
const SITES = [{ t: "acct-reef", url: "https://acct-reef.example/tide-pool-guide", q: "tide pool safety" },
  { t: "acct-loom", url: "https://acct-loom.example/blackwork-stitches", q: "ordre des points blackwork" }] as const;
type Site = (typeof SITES)[number];
const serp = (query: string, at: string, urls: string[], status = "done") => ({ query, status, observedAt: at, organic: urls.map((u, i) => ({ url: u, rank: i + 1 })) });
const own = (s: Site) => new URL(s.url).hostname, key = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const WINNER_READ_BUDGET = 15;
const both = (s: Site, serps: readonly unknown[], banked: readonly string[] = [], focus: readonly string[] = []) => {
  const owed = owedWinnerReads(serps, banked, own(s), focus);
  const organic = (owed.currentSerps as { query: string; organic: { url: string; rank: number }[] }[])
    .flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
  const picked = rankWinningPages(organic as never, own(s), WINNER_READ_BUDGET, owed.queries);
  const read = new Set(picked.filter((c) => !c.standby).map((c) => key(c.url)));
  return { owed, picked, promised: owed.pageKeys.length, owedSearches: owed.queries.length - focus.length, unread: owed.pageKeys.filter((k) => !read.has(k)), readTotal: read.size };
};
describe("owedWinnerReads, the receipt and the unit reading one rule", () => {
  it.each(SITES)("$t: selects dates chronologically, keeps incomplete refreshes owed, and ignores identity failures", (s) => {
    const old = serp(s.q, "2026-09-06T23:30:00+02:00", ["https://old.example/x"]), fresh = serp(s.q.toUpperCase(), "2026-09-06T22:00:00Z", ["https://new.example/x"]);
    const pending = serp(s.q, "2026-09-07T00:00:00Z", [], "posted"), wrong = { ...serp(s.q, "2026-09-08T00:00:00Z", ["https://wrong.example/x"]), identityMismatch: true };
    for (const rows of [[old, fresh, pending, wrong], [wrong, pending, fresh, old]]) {
      const owed = owedWinnerReads(rows, [], own(s)); expect([owed.currentSerps, owed.pageKeys]).toEqual([[fresh], [key("https://new.example/x")]]);
      expect(owedWinnerReads(rows, ["https://new.example/x"], own(s)).pageKeys).toEqual([]);
      expect(both(s, rows).unread).toEqual([]);
    }
    const empty = serp(s.q, "2026-09-09T00:00:00Z", []); expect(owedWinnerReads([old, empty], [], own(s))).toMatchObject({ currentSerps: [empty], pageKeys: [] });
    expect(owedWinnerReads([{ ...old, observedAt: "invalid-date" }, fresh], [], own(s)).currentSerps).toEqual([fresh]);
  });
  it.each(SITES)("$t: fewer than ten results, an all-noise search, two searches sharing a page, and one search done twice", (s) => {
    const short = owedWinnerReads([serp("a", "2026-09-06T01:00:00Z", ["https://p1.example/x", "https://p2.example/y"])], [], own(s));
    const noise = owedWinnerReads([serp("b", "2026-09-06T01:00:00Z", ["https://reddit.com/r/x", `https://${own(s)}/mine`])], [], own(s));
    const shared = owedWinnerReads([serp("c", "2026-09-06T02:00:00Z", ["https://p1.example/x"]), serp("d", "2026-09-06T03:00:00Z", ["https://p1.example/x", "https://p3.example/z"])], [], own(s));
    const twice = owedWinnerReads([serp("e", "2026-09-06T01:00:00Z", ["https://p1.example/x"]), serp("e", "2026-09-06T05:00:00Z", ["https://p2.example/y"])], [], own(s));
    const held = owedWinnerReads([serp("f", "2026-09-06T01:00:00Z", ["https://p1.example/x", "https://p2.example/y"])], ["https://p1.example/x"], own(s));
    expect([short.pageKeys.length, noise.queries, shared.queries, shared.pageKeys.length, twice.queries, twice.pageKeys.length, held.queries],
      "a short result owes both pages; own/noise results owe nothing; shared pages count once; a refreshed search owes only its newest pages; partial banking leaves comparison debt")
      .toEqual([2, [], ["d", "c"], 2, ["e"], 1, ["f"]]);
    expect(twice.pageKeys).toEqual([key("https://p2.example/y")]);
    const two = owedWinnerReads([serp("Tide Pool Safety", "2026-09-06T01:00:00Z", ["https://p1.example/x"]), serp("tide pool safety", "2026-09-06T02:00:00Z", ["https://p2.example/y"])], [], own(s));
    expect([two.queries.length, two.pageKeys.length], "one canonical query uses its newest complete result, never a union of old and new pages").toEqual([1, 1]);
  });
});
describe("the number Today says and the number the next pass reads", () => {
it.each(SITES)("$t: three owed searches reserve their exact top five pages inside fifteen total reads", (s) => {
    const serps = ["q1", "q2", "q3"].map((q, n) => ({ query: `${q} ${s.q}`, status: "done", observedAt: `2026-09-0${n + 1}T01:00:00Z`,
      organic: Array.from({ length: 10 }, (_, i) => ({ url: `https://${q}-p${i}.example/a`, rank: i + 1 })) }));
    const owed = owedWinnerReads(serps, [], own(s));
    const organic = serps.flatMap((x) => x.organic.map((o) => ({ citedUrl: o.url, kind: "serp_organic", rank: o.rank, query: x.query, engine: "google" })));
    const aiCited = Array.from({ length: 10 }, (_, i) => ({ citedUrl: `https://ai-cited-${i}.example/a`, kind: "ai_citation", query: "", engine: "chatgpt", promptText: "p" }));
    const picked = rankWinningPages([...organic, ...aiCited] as never, own(s), WINNER_READ_BUDGET, owed.queries);
    const owedKeys = new Set(owed.pageKeys), read = picked.filter((c) => !c.standby && owedKeys.has(key(c.url)));
    expect([owed.pageKeys.length, read.length],
      "Today says this many pages winning a search already bought are owed a read and that the next pass reads them, so the promise is the reserve itself: five ranked pages per search, never thirty pages or a publisher-deduplicated substitute")
      .toEqual([15, 15]);
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
      "one query uses its newest result; one publisher can supply five distinct pages; short results owe every page; shared pages count once. Every promised page is reserved.")
      .toEqual([[1, 1, []], [5, []], [4, []], [5, []]]);
  });
  it.each(SITES)("$t: the promise is never a page the pass will not open, whatever the account already has in focus", (s) => {
    const withFocus = (n: number) => { const a = account(s, n); return both(s, a.serps, a.banked, a.focus); };
    expect([withFocus(39).unread, withFocus(40).unread, withFocus(41).unread, withFocus(40).promised],
      "Today says these pages are owed a read and that the next pass reads them, so a reserve the pass cannot spend on them makes the sentence say a number nobody will read: the owed searches are cut into the ceiling ahead of the focused tail, and the promise is kept on either side of it")
      .toEqual([[], [], [], 3]);
  });
});
const account = (s: Site, n: number) => {
  const focus = Array.from({ length: n }, (_, i) => `focus ${i} ${s.q}`);
  const held = focus.map((q, k) => serp(q, `2026-09-0${(k % 9) + 1}T01:00:00Z`, [`https://f${k}.example/a`]));
  const owedSerp = serp(`unread ${s.q}`, "2026-09-06T23:00:00Z", ["https://p1.example/x", "https://p2.example/y", "https://p3.example/z"]);
  const serps = [...held, owedSerp], banked = held.flatMap((x) => x.organic.map((o) => o.url));
  return { focus, serps, banked }; };
const pass = (s: Site, n: number) => { const a = account(s, n), { owed, picked } = both(s, a.serps, a.banked, a.focus);
  const reserved = picked.filter((c) => !c.standby && c.ownerQuery), reservedKeys = new Set(reserved.map((c) => key(c.url)));
  const receipt = owedWinnerReads(a.serps, a.banked, own(s)).pageKeys; // the runtime receipt asks the same rule with NO focus (due-work.ts:392)
  return { priority: owed.queries, receipt, reserved: reserved.length, promisedAndOpened: receipt.filter((k) => reservedKeys.has(k)).length,
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
