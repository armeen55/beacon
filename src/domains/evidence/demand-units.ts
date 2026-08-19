/** evidence/demand-units - RELATED SEARCHES ARE ONE AUDIENCE. The decision floor used to read one query row at
 *  a time, so a page shown 2,922 times across 384 phrasings of one intent ("nowruz 2026", "when is nowruz",
 *  "nowruz persian new year") never cleared a 500-impression bar any single phrasing missed, and 63% of the
 *  site's demand was invisible to the only path that can authorise work. This module groups a page's query
 *  rows into DEMAND UNITS deterministically, with no model and no site-specific rule:
 *    - two queries whose distinguishing tokens are EQUAL are one unit ("persian girl names",
 *      "girl names persian", "persian names for girls" - the tokenizer already drops connectives);
 *    - a query whose tokens ADD at most one to a member's set joins it, but only when the shorter side
 *      carries at least three tokens, so "list of persian girl names" joins "persian girl names" while a
 *      two-token head like "persian names" stays its own unit rather than folding into every child intent.
 *  Unit metrics are the honest sums: impressions and clicks add, position is impressions-weighted, expected
 *  clicks are what each member's own position pays on the account's own curve, and recoverable is the unit's
 *  shortfall under that, floored at zero. The member phrasings ride along as `vocabulary`: the exact words
 *  searchers use, which is what the drafter may lead with and the one thing a page's own copy cannot supply.
 *  PURE and deterministic: same rows in any order, same units. */

import { topicTokens } from "@/domains/evidence/relevance-gate";
import type { OwnedQuerySignal } from "@/domains/evidence/snapshot";

export type DemandUnit = {
  /** The unit's biggest member query: a real search, so SERP and readiness lookups stay exact. */
  label: string;
  /** Every member, impressions-descending. */
  queries: OwnedQuerySignal[];
  impressions: number;
  clicks: number;
  /** Impressions-weighted average position across members that carry one. */
  position: number | null;
  /** What the members' own positions pay on the supplied curve, summed. */
  expectedClicks: number;
  /** expectedClicks minus clicks, floored at zero. */
  recoverableClicks: number;
  /** Distinct member phrasings, biggest first: the searchers' own vocabulary for the drafter. */
  vocabulary: string[];
};

const keyOf = (tokens: string[]): string => [...new Set(tokens)].sort().join("|");

/** Group one page's query rows into demand units. `expectedCtrAt` is the account's own fitted curve. */
export function demandUnitsOf(
  queries: readonly OwnedQuerySignal[],
  expectedCtrAt: (position: number) => number,
): DemandUnit[] {
  const rows = queries
    .map((q) => ({ q, tokens: [...new Set(topicTokens(q.query))] }))
    .filter((r) => r.tokens.length > 0)
    .sort((a, b) => b.q.impressions - a.q.impressions || a.q.query.localeCompare(b.q.query));
  // Pass 1: exact token-set identity.
  const byKey = new Map<string, { tokens: string[]; members: OwnedQuerySignal[] }>();
  for (const r of rows) {
    const k = keyOf(r.tokens);
    const got = byKey.get(k);
    if (got) got.members.push(r.q);
    else byKey.set(k, { tokens: r.tokens, members: [r.q] });
  }
  // Pass 2: guarded subset absorption, biggest group first so the anchor is the demand center. A group joins
  // an anchor when its token set contains the anchor's whole set with at most one extra token, and the anchor
  // carries at least three tokens. Deterministic: groups are visited impressions-descending.
  const groups = [...byKey.values()].sort(
    (a, b) => sum(b.members) - sum(a.members) || keyOf(a.tokens).localeCompare(keyOf(b.tokens)));
  const units: { tokens: Set<string>; members: OwnedQuerySignal[] }[] = [];
  for (const g of groups) {
    const set = new Set(g.tokens);
    const host = units.find((u) =>
      u.tokens.size >= 3 && set.size <= u.tokens.size + 1 && [...u.tokens].every((t) => set.has(t)));
    if (host) host.members.push(...g.members);
    else units.push({ tokens: set, members: [...g.members] });
  }
  return units.map((u) => {
    const members = [...u.members].sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
    const impressions = sum(members);
    const clicks = members.reduce((a, m) => a + m.clicks, 0);
    const withPos = members.filter((m) => m.position != null && Number.isFinite(m.position));
    const posWeight = withPos.reduce((a, m) => a + m.impressions, 0);
    const position = posWeight > 0 ? withPos.reduce((a, m) => a + (m.position as number) * m.impressions, 0) / posWeight : null;
    const expectedClicks = withPos.reduce((a, m) => a + expectedCtrAt(m.position as number) * m.impressions, 0);
    return {
      label: members[0]!.query,
      queries: members,
      impressions,
      clicks,
      position: position == null ? null : Math.round(position * 10) / 10,
      expectedClicks: Math.round(expectedClicks),
      recoverableClicks: Math.max(0, Math.round(expectedClicks - clicks)),
      vocabulary: [...new Set(members.map((m) => m.query))],
    };
  }).sort((a, b) => b.impressions - a.impressions || a.label.localeCompare(b.label));
}

const sum = (ms: readonly OwnedQuerySignal[]): number => ms.reduce((a, m) => a + m.impressions, 0);

// ── THE CANONICAL DEMAND UNIT (account level) ────────────────────────────────
// One audience need, joined across every stream of evidence this account holds: its current Google rows and
// the pages earning them, its sixteen months of history (losses, page swaps), bought keyword volume and
// intent, the stored results page, the tracked AI questions with their answers, mentions and cited rivals,
// the fan-out searches engines ran while answering, the pages that win, and nothing invented anywhere. THIS
// IS A RESOLUTION, NOT A CONCATENATION: a stream joins a unit only through an exact key or a subject-token
// rule, and where two streams disagree about the need (Google moved the audience between pages, the keyword
// provider grades it commercial while the tracked question asks a plain question, several owned pages split
// it) the disagreement is written onto the unit as a tension instead of being averaged away. PURE builder;
// the two bounded reads live in the loader below it.

/** One query's two-window history, as the gsc_unit_history aggregate returns it. The page-true fields are
 *  the CURRENT top page's own position and impressions share per window; the plain positions blend every
 *  page the site ranks with, and a second owned page entering the results moves that blend on its own. */
export type UnitHistoryRow = {
  query: string; earlyClicks: number; earlyImpressions: number; earlyPosition: number | null;
  recentClicks: number; recentImpressions: number; recentPosition: number | null;
  earlyTopPage: string | null; recentTopPage: string | null;
  earlyPagePosition?: number | null; recentPagePosition?: number | null;
  earlyPageShare?: number | null; recentPageShare?: number | null };

export type CanonicalDemandUnit = {
  label: string;
  /** Searchers' and askers' own phrasings, demand-descending: queries first, joined prompt texts after. */
  vocabulary: string[];
  /** Current 90-day members, merged across the pages that earn them. */
  queries: OwnedQuerySignal[];
  /** Owned pages currently shown for member queries, biggest contributor first. */
  pages: string[];
  history: null | { earlyClicksPerDay: number; recentClicksPerDay: number; lostClicksPerMonth: number;
    earlyImpressions: number; recentImpressions: number; priorTopPage: string | null;
    currentTopPage: string | null; pageSwapped: boolean;
    /** Impressions-weighted positions per window, blended across every page the site ranks with. */
    earlyPosition: number | null; recentPosition: number | null;
    /** The current top page's OWN positions per window: the only positions a page-specific diagnosis may
     *  read, because the blend above moves when a second owned page enters or leaves the results. */
    pageEarlyPosition: number | null; pageRecentPosition: number | null;
    /** That page's impressions share of the unit per window; a material fall means the site's own second
     *  page absorbed part of this audience, which is composition, not a ranking story. */
    pageShareEarly: number | null; pageShareRecent: number | null };
  volume: null | { searchVolume: number | null; intent: string | null; difficulty: number | null };
  serp: null | { winners: { rank: number; domain: string; url: string }[]; paa: string[]; related: string[]; observedAt: string | null };
  prompts: { promptId: string; text: string; answers: number; credited: number;
    citedRivals: { domain: string; url: string; count: number }[] }[];
  /** Searches engines ran while answering the joined prompts. Evidence about how they look, never a topic. */
  fanouts: string[];
  /** Pages that win this audience somewhere (SERP or AI), deduplicated. */
  winningPages: { url: string; domain: string }[];
  /** What the CURRENT window's own positions still pay that the unit is not collecting: the only figure that
   *  may ever be called recoverable, and only once a cause is diagnosed. Never the historical delta. */
  recoverableClicks: number;
  /** The disagreements between streams, preserved in words instead of resolved by force. */
  tensions: string[];
  audience: { impressions90d: number; aiAnswers: number; lostClicksPerMonth: number };
  /** WHERE THIS AUDIENCE WAS SEEN: Google queries, AI questions and their fan-outs, or both. An AI-only
   *  recurring demand used to be invisible unless it already resembled a GSC query (operator, 2026-08-19). */
  seededBy: "search" | "ai" | "both";
};

export type CanonicalUnitInputs = {
  pageQueries: readonly { page: string; rows: readonly OwnedQuerySignal[] }[];
  history: readonly UnitHistoryRow[];
  windows: { earlyDays: number; recentDays: number };
  keywords: readonly { query: string; searchVolume: number | null; intent: string | null; difficulty: number | null }[];
  serps: readonly { query: string; observedAt: string | null; organic: { rank: number; domain: string; url: string }[]; paa: string[]; related: string[] }[];
  observations: readonly { promptId: string; promptText: string; creditedOwn: boolean; engine?: string; day?: string;
    citations: readonly { domain: string; url: string }[] | null; fanOutQueries: readonly string[] | null }[];
  winning: readonly { url: string; domain: string; queries: readonly string[]; promptIds: readonly string[] }[];
  expectedCtrAt: (position: number) => number;
};

const canon = (q: string): string => [...new Set(topicTokens(q))].sort().join("|");

export function canonicalDemandUnits(input: CanonicalUnitInputs): CanonicalDemandUnit[] {
  const { earlyDays, recentDays } = input.windows;
  // CURRENT ROWS, MERGED ACROSS PAGES: one query earned on two pages is one audience with two doors. The
  // key is the EXACT query, never its token set, so distinct phrasings survive into the clusterer and the
  // vocabulary keeps every spelling searchers actually use ("list of persian girl names" included).
  const merged = new Map<string, { query: string; impressions: number; clicks: number; posW: number; posI: number; pages: Map<string, number> }>();
  for (const pq of input.pageQueries) for (const r of pq.rows) {
    const k = r.query.trim().toLowerCase(); if (!k) continue;
    const m = merged.get(k) ?? { query: r.query, impressions: 0, clicks: 0, posW: 0, posI: 0, pages: new Map() };
    m.impressions += r.impressions; m.clicks += r.clicks;
    if (r.position != null && Number.isFinite(r.position)) { m.posW += r.position * r.impressions; m.posI += r.impressions; }
    m.pages.set(pq.page, (m.pages.get(pq.page) ?? 0) + r.impressions);
    merged.set(k, m);
  }
  // LOST QUERIES SEED UNITS TOO: an audience that vanished has no current row, and the collapse story is
  // exactly those. They enter the clustering weighted by a 90-day equivalent of what they USED to earn.
  const hist = new Map<string, UnitHistoryRow>();
  for (const h of input.history) { const k = canon(h.query); if (k && !hist.has(k)) hist.set(k, h); }
  const currentCanons = new Set([...merged.values()].map((m) => canon(m.query)));
  for (const [k, h] of hist) if (!currentCanons.has(k)) {
    merged.set(h.query.trim().toLowerCase(), { query: h.query, impressions: Math.round((h.earlyImpressions / Math.max(1, earlyDays)) * 90),
      clicks: 0, posW: 0, posI: 0, pages: new Map() });
  }
  const signals: OwnedQuerySignal[] = [...merged.values()].map((m) => ({
    query: m.query, impressions: m.impressions, clicks: m.clicks,
    position: m.posI > 0 ? m.posW / m.posI : null } as OwnedQuerySignal));
  const units = demandUnitsOf(signals, input.expectedCtrAt);

  const kw = new Map(input.keywords.map((k) => [canon(k.query), k] as const));
  const serp = new Map(input.serps.map((s) => [canon(s.query), s] as const));
  const promptTok = input.observations.map((o) => ({ o, tokens: new Set(topicTokens(o.promptText)) }));

  const searchSeeded = units.map((u) => {
    // Deduplicated: two phrasings sharing one token set are ONE history row, never a double count.
    const keys = [...new Set(u.queries.map((q) => canon(q.query)))];
    const keySet = new Set(keys);
    const unitTokens = new Set(u.queries.flatMap((q) => topicTokens(q.query)));
    // Pages currently earning members, biggest contributor first.
    const pageShare = new Map<string, number>();
    for (const q of u.queries) for (const [pg, imp] of merged.get(q.query.trim().toLowerCase())?.pages ?? []) pageShare.set(pg, (pageShare.get(pg) ?? 0) + imp);
    const pages = [...pageShare.entries()].sort((a, b) => b[1] - a[1]).map(([pg]) => pg);
    // History: summed across members; the top member with history names the pages.
    const hRows = keys.map((k) => hist.get(k)).filter((h): h is UnitHistoryRow => !!h);
    const hSum = hRows.reduce((a, h) => ({ ec: a.ec + h.earlyClicks, ei: a.ei + h.earlyImpressions,
      rc: a.rc + h.recentClicks, ri: a.ri + h.recentImpressions }), { ec: 0, ei: 0, rc: 0, ri: 0 });
    const hTop = [...hRows].sort((a, b) => b.earlyClicks - a.earlyClicks)[0];
    const perDayEarly = hSum.ec / Math.max(1, earlyDays), perDayRecent = hSum.rc / Math.max(1, recentDays);
    const swapped = !!hTop?.earlyTopPage && !!hTop.recentTopPage
      && hTop.earlyTopPage.replace(/^https?:\/\/(www\.)?/, "") !== hTop.recentTopPage.replace(/^https?:\/\/(www\.)?/, "");
    const posOf = (rows2: UnitHistoryRow[], side: "early" | "recent"): number | null => {
      const w = rows2.reduce((a, h) => a + (side === "early" ? (h.earlyPosition != null ? h.earlyImpressions : 0) : (h.recentPosition != null ? h.recentImpressions : 0)), 0);
      if (w <= 0) return null;
      const t = rows2.reduce((a, h) => a + (side === "early" ? (h.earlyPosition ?? 0) * (h.earlyPosition != null ? h.earlyImpressions : 0) : (h.recentPosition ?? 0) * (h.recentPosition != null ? h.recentImpressions : 0)), 0);
      return Math.round((t / w) * 100) / 100; };
    // PAGE-TRUE AGGREGATES: each member's current-top-page position weighted by that page's own impressions
    // (share times the window's impressions), and the impressions-weighted share itself per window.
    const pageAgg = (side: "early" | "recent"): { pos: number | null; share: number | null } => {
      let pw = 0, pt = 0, sw = 0, st = 0;
      for (const h of hRows) {
        const imp = side === "early" ? h.earlyImpressions : h.recentImpressions;
        const pos = side === "early" ? h.earlyPagePosition : h.recentPagePosition;
        const share = side === "early" ? h.earlyPageShare : h.recentPageShare;
        if (share != null && imp > 0) { sw += share * imp; st += imp;
          if (pos != null) { pw += pos * share * imp; pt += share * imp; } }
      }
      return { pos: pt > 0 ? Math.round((pw / pt) * 100) / 100 : null, share: st > 0 ? Math.round((sw / st) * 100) / 100 : null };
    };
    const pgEarly = pageAgg("early"), pgRecent = pageAgg("recent");
    const history = hRows.length === 0 ? null : {
      earlyClicksPerDay: Math.round(perDayEarly * 100) / 100, recentClicksPerDay: Math.round(perDayRecent * 100) / 100,
      lostClicksPerMonth: Math.max(0, Math.round((perDayEarly - perDayRecent) * 30)),
      earlyImpressions: hSum.ei, recentImpressions: hSum.ri,
      priorTopPage: hTop?.earlyTopPage ?? null, currentTopPage: hTop?.recentTopPage ?? null, pageSwapped: swapped,
      earlyPosition: posOf(hRows, "early"), recentPosition: posOf(hRows, "recent"),
      pageEarlyPosition: pgEarly.pos, pageRecentPosition: pgRecent.pos,
      pageShareEarly: pgEarly.share, pageShareRecent: pgRecent.share };
    // Volume: the biggest bought figure among members.
    const kws = keys.map((k) => kw.get(k)).filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0));
    const volume = kws[0] ? { searchVolume: kws[0].searchVolume, intent: kws[0].intent, difficulty: kws[0].difficulty } : null;
    // SERP: the biggest member whose results page is on file.
    const sr = keys.map((k) => serp.get(k)).find((x) => !!x) ?? null;
    // PROMPTS JOIN BY IDENTITY, NEVER SIMILARITY: the question asked IS a member search, or the provider's
    // own fan-out for that answer is. Shared subject tokens joined "best places to visit in Iran" to an
    // iran-flag unit through the account's everywhere-word; a word an account puts on everything is not
    // evidence about anything (operator, 2026-08-19). The same rule Decision's membership predicate holds.
    const joined = promptTok.filter(({ o }) => keySet.has(canon(o.promptText))
      || (o.fanOutQueries ?? []).some((q) => { const k = canon(q); return k.length > 0 && k !== canon(o.promptText) && keySet.has(k); }));
    const byPrompt = new Map<string, { text: string; answers: number; credited: number; rivals: Map<string, { url: string; count: number }> }>();
    for (const { o } of joined) {
      const p = byPrompt.get(o.promptId) ?? { text: o.promptText, answers: 0, credited: 0, rivals: new Map() };
      p.answers += 1; if (o.creditedOwn) p.credited += 1;
      if (!o.creditedOwn) for (const c of new Map((o.citations ?? []).map((c) => [c.domain, c])).values()) {
        const r = p.rivals.get(c.domain) ?? { url: c.url, count: 0 }; r.count += 1; p.rivals.set(c.domain, r); }
      byPrompt.set(o.promptId, p);
    }
    const prompts = [...byPrompt.entries()].map(([promptId, p]) => ({ promptId, text: p.text, answers: p.answers, credited: p.credited,
      citedRivals: [...p.rivals.entries()].map(([domain, r]) => ({ domain, url: r.url, count: r.count }))
        .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 5) }))
      .sort((a, b) => b.answers - a.answers || a.promptId.localeCompare(b.promptId));
    const fanouts = [...new Set(joined.flatMap(({ o }) => o.fanOutQueries ?? []))].slice(0, 20);
    const promptIds = new Set(prompts.map((p) => p.promptId));
    const winningPages = input.winning
      .filter((w) => w.queries.some((q) => keySet.has(canon(q))) || w.promptIds.some((id) => promptIds.has(id)))
      .map((w) => ({ url: w.url, domain: w.domain }));
    // THE TENSIONS, said instead of averaged.
    const tensions: string[] = [];
    if (swapped) tensions.push(`Google moved this audience: ${hTop!.earlyTopPage} earned it before, ${hTop!.recentTopPage} is shown now.`);
    if (history?.pageShareEarly != null && history.pageShareRecent != null && history.pageShareEarly - history.pageShareRecent >= 0.2)
      tensions.push(`Another of your own pages absorbed part of this audience: the page now shown carried ${Math.round(history.pageShareEarly * 100)} percent of its impressions before and carries ${Math.round(history.pageShareRecent * 100)} percent now.`);
    const material = [...pageShare.values()].filter((v) => v >= Math.max(30, (u.impressions || 1) * 0.1)).length;
    if (material >= 2) tensions.push(`${material} of your pages currently split this audience.`);
    if (volume?.intent && /commercial|transactional/i.test(volume.intent) && prompts.some((p) => /^(what|how|why|when|where|who)\b/i.test(p.text)))
      tensions.push(`The keyword provider grades this ${volume.intent} while the tracked question asks a plain question.`);
    return {
      label: u.label,
      vocabulary: [...new Set([...u.vocabulary, ...prompts.map((p) => p.text)])],
      queries: u.queries, pages, history, volume,
      serp: sr ? { winners: sr.organic.slice(0, 10), paa: sr.paa.slice(0, 8), related: sr.related.slice(0, 8), observedAt: sr.observedAt } : null,
      prompts, fanouts, winningPages, recoverableClicks: u.recoverableClicks, tensions,
      audience: { impressions90d: u.impressions, aiAnswers: prompts.reduce((a, p) => a + p.answers, 0),
        lostClicksPerMonth: history?.lostClicksPerMonth ?? 0 },
      seededBy: (prompts.length > 0 ? "both" : "search") as CanonicalDemandUnit["seededBy"],
    };
  });

  // ── AI-SEEDED UNITS: demand Google never named (operator, 2026-08-19). A tracked question whose answers
  // joined no search unit is an audience somebody approved watching; a fan-out that RECURRED across distinct
  // days, engines or parent questions earned materiality the way one sighting never does. Each becomes a unit
  // with zero impressions, never a borrowed Google number: unknown volume stays unknown.
  const claimed = new Set(searchSeeded.flatMap((un) => un.prompts.map((pr) => pr.promptId)));
  const claimedKeys = new Set(searchSeeded.flatMap((un) => un.queries.map((q) => canon(q.query))));
  const aiSeeded: CanonicalDemandUnit[] = [];
  const byUnjoinedPrompt = new Map<string, (typeof input.observations)[number][]>();
  for (const o of input.observations) if (!claimed.has(o.promptId)) byUnjoinedPrompt.set(o.promptId, [...(byUnjoinedPrompt.get(o.promptId) ?? []), o]);
  for (const [promptId, obs] of byUnjoinedPrompt) {
    const text = obs[0]!.promptText;
    if (claimedKeys.has(canon(text))) continue;
    const credited = obs.filter((o) => o.creditedOwn).length;
    const rivals = new Map<string, { url: string; count: number }>();
    for (const o of obs) if (!o.creditedOwn) for (const c of new Map((o.citations ?? []).map((x) => [x.domain, x])).values()) {
      const r = rivals.get(c.domain) ?? { url: c.url, count: 0 }; r.count += 1; rivals.set(c.domain, r); }
    aiSeeded.push({ label: text, vocabulary: [text], queries: [], pages: [], history: null, volume: null, serp: null,
      prompts: [{ promptId, text, answers: obs.length, credited,
        citedRivals: [...rivals.entries()].map(([domain, r]) => ({ domain, url: r.url, count: r.count }))
          .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain)).slice(0, 5) }],
      fanouts: [...new Set(obs.flatMap((o) => o.fanOutQueries ?? []))].slice(0, 20),
      winningPages: input.winning.filter((w) => w.promptIds.includes(promptId)).map((w) => ({ url: w.url, domain: w.domain })),
      recoverableClicks: 0, tensions: [], seededBy: "ai",
      audience: { impressions90d: 0, aiAnswers: obs.length, lostClicksPerMonth: 0 } });
  }
  // Fan-outs that recurred and joined nothing: distinct days, engines or parent prompts make the claim.
  const fanRec = new Map<string, { query: string; days: Set<string>; engines: Set<string>; parents: Set<string> }>();
  for (const o of input.observations) for (const q of new Set((o.fanOutQueries ?? []).map((x) => x.trim()).filter(Boolean))) {
    const k = canon(q);
    if (!k || k === canon(o.promptText) || claimedKeys.has(k)) continue;
    const held = fanRec.get(k) ?? { query: q, days: new Set<string>(), engines: new Set<string>(), parents: new Set<string>() };
    if (o.day) held.days.add(o.day);
    if (o.engine) held.engines.add(o.engine);
    held.parents.add(o.promptId);
    fanRec.set(k, held);
  }
  for (const [, f] of fanRec) {
    if (f.days.size < 3 && f.engines.size < 2 && f.parents.size < 2) continue; // one sighting is noise, watched and never work
    aiSeeded.push({ label: f.query, vocabulary: [f.query], queries: [], pages: [], history: null, volume: null,
      serp: null, prompts: [], fanouts: [f.query], winningPages: [], recoverableClicks: 0,
      tensions: [], seededBy: "ai", audience: { impressions90d: 0, aiAnswers: 0, lostClicksPerMonth: 0 } });
  }
  return [...searchSeeded, ...aiSeeded].sort((a, b) => b.audience.lostClicksPerMonth - a.audience.lostClicksPerMonth
    || b.audience.impressions90d - a.audience.impressions90d || b.audience.aiAnswers - a.audience.aiAnswers || a.label.localeCompare(b.label));
}
