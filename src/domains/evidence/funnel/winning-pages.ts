import "server-only";
/** funnel/winning-pages (integrity closure) - THE page work of a research pass, split out of funnel/observe when that file reached its size ceiling: rank every SERP and AI appearance into winning pages, acquire the
 * bodies I am allowed to acquire under two explicit ceilings, read AT MOST ONE page of the account's OWN, and then, as a SECOND stage under a freshly renewed run lease, buy the ONE page-by-page comparison the winners
 * earned. Nothing here re-picks a topic (the caller freezes it), nothing pays twice for the same identity (the money core's cache does that), and no failed read is forgotten (every one carries its own retry date). */
import { log } from "@/lib/logger";
import type { BusinessProfile } from "@/domains/account";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { resolveCitationTargets } from "@/domains/evidence/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { FunnelUnitFn, ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { rankWinningPages } from "./normalize";
import { type FunnelState, type FunnelWinningPage } from "./state";
import { askIdentity, normalizePageIntersection, parsePageIntersection, type PageIntersectionAsk } from "@/domains/evidence/page-intersection";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { pageExtractFrom, pageExtractFromRecord, type IntersectionUnavailable, type OwnedPageReadOutcome, type ResearchPageComparison, type ResearchPageExtract, type ResearchWinningAppearance, type WinnerReadOutcome } from "./research-evidence";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, FRESH_MS, interp, modeOf, NO_BASIS_DETAIL, resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps } from "./shared";

/** ONE explicit acquisition budget per cycle, never a global free-for-all. 15 winning pages are ranked, so three priority searches keep their own three, and 18 is the MOST I ever go out and read: those 15 plus at
 *  most ONE substitute for each of the three priority searches, every one of them spending an ATTEMPT from the same total. Paid body reads are bounded SEPARATELY at 6, because they are the only page work that
 *  costs money, so a cycle where every publisher refuses can no longer buy a paid read for all fifteen. Bought comparisons kept: 8. */
const WINNER_READ_BUDGET = 15, MAX_COMPARISONS = 8, MAX_PAGE_ATTEMPTS = 18, MAX_PAID_BODY_READS = 6;
/** CONTENT identity, never the address: the same parsed extract in any key order hashes the SAME, and a changed title, heading, opening or body hashes DIFFERENTLY. Banking sha16(url) on the provider path froze
 *  a page's identity at its address forever, so a rewritten page looked unchanged to a store whose whole point is content-hash-aware reuse. fetchedAt is when I looked, not what the page says, so it is excluded. */
const extractHash = (x: ResearchPageExtract): string => sha16(JSON.stringify(Object.entries(x).filter(([k, v]) => k !== "fetchedAt" && v !== undefined).sort((a, b) => a[0].localeCompare(b[0]))));

// ── B5: winning pages ───────────────────────────────────────────────────────

/** Flatten every SERP + AI appearance into TRUE-provenance rows: each carries its own query or real prompt id + text, its engine, its rank and (for AI answers) its observation MODE. One citation seen through BOTH ChatGPT modes is ONE appearance credited to the consumer look, never counted twice. Pure. */
function collectAppearances(state: FunnelState, fallbackIso: string): ResearchWinningAppearance[] {
  const out: ResearchWinningAppearance[] = [], seen = new Set<string>();
  for (const s of state.serps.queries.filter((x) => x.status === "done")) {
    const at = s.observedAt || state.updatedAt || fallbackIso;
    for (const o of s.organic ?? []) out.push({ kind: "serp_organic", query: s.query, promptId: null, promptText: null, engine: null, rank: o.rank, citedUrl: o.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiOverview ?? []) out.push({ kind: "ai_overview", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiMode ?? []) out.push({ kind: "ai_mode", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
  }
  const cited = state.prompts.pairs.filter((x) => x.status === "done" && x.citations && x.citations.length > 0)
    .sort((a, b) => Number(modeOf(b) === "consumer_search") - Number(modeOf(a) === "consumer_search")); // consumer look first: it wins the duplicate
  for (const p of cited) for (const c of p.citations!) {
    const key = `${p.promptId}|${p.engine}|${c.url}`; if (seen.has(key)) continue; seen.add(key);
    out.push({ kind: "ai_answer", query: null, promptId: p.promptId, promptText: p.promptText ?? null, engine: p.engine, rank: null, citedUrl: c.url, observedAt: p.observedAt ?? fallbackIso, modelServed: p.modelServed ?? null, observationMode: modeOf(p) });
  }
  return out;
}

/** What the caller wants compared page by page, in plain Evidence terms (Evidence never reads Decision): the topic it belongs to and the page set. */
export type FunnelIntersectionAsk = { topicKey: string; ask: PageIntersectionAsk };
/** Every disposition that produced NO comparison. `failed` is the fallback, so an unmapped one can never read as a finding. */
const COMPARISON_GAP: Partial<Record<string, IntersectionUnavailable>> = { blocked: "blocked", daily_limit: "capped", quarantined: "quarantined", retry_free: "ambiguous", repost_once: "ambiguous" };

/** THE page-by-page comparison: at most ONE request, carrying the WHOLE page set (one call per page or per keyword is a defect). It rides the same money core as every other unit, so the reservation, the
 *  deterministic identity, the reconcile to actual and the cache reuse are the boundary's, not a second copy here. TWO guards stop a second buy: a landed answer for this topic AND this normalized ask is never
 *  re-requested, and a crash after the provider answered but before this phase saved re-derives the SAME identity, so the money core serves it warm. Under two usable pages is not a comparison and never pays. */
async function buyComparison(d: ResolvedDeps, state: FunnelState, want: FunnelIntersectionAsk, ids: { tenantId: string; unitKey: string }, nowIso: string): Promise<ResearchPageComparison | null> {
  const ask = normalizePageIntersection(want.ask), askKey = askIdentity(ask); // ONE definition, shared with the reader
  if (ask.pages.length < 2 || state.pageComparisons.some((c) => c.topicKey === want.topicKey && c.askKey === askKey && c.comparison)) return null;
  const raw = await d.callProvider("labs_page_intersection", ask, ids), r = interp(raw);
  track(state, r);
  const row: ResearchPageComparison = { topicKey: want.topicKey, askKey, pages: ask.pages, excludePages: ask.exclude_pages ?? [], observedAt: nowIso, receipt: r.cacheKey, comparison: null, unavailable: null };
  // Parsed WITH the ask: the envelope carries numbered slots and the money core strips the request echo, so without it the answer knows the ranks but not WHICH page took them. An unreadable answer says so.
  if (r.kind === "evidence") { try { row.comparison = parsePageIntersection(r.payload as ProviderEnvelope, ask); } catch { row.unavailable = "ambiguous"; } }
  else if (r.kind === "waiting") row.unavailable = "waiting";
  else row.unavailable = raw.state === "capped" ? "capped" : COMPARISON_GAP[r.disposition ?? ""] ?? "failed";
  return row;
}

/** How long a failed read holds its URL out of the read budget. A robots denial is the publisher's own answer, so I honor it for a month and never ask a provider to go around it; my one paid read of a body is
 *  held a week; a site that simply did not answer me is retried tomorrow. Without this memory the same dead URL was refetched on every single pass forever, because "403" and "not tried yet" looked alike. */
const RETRY_MS: Record<WinnerReadOutcome["state"], number> = { robots_blocked: 30 * 86_400_000, provider_unavailable: 7 * 86_400_000, temporarily_unavailable: 86_400_000 };
const readOutcomeAt = <S extends WinnerReadOutcome["state"]>(state: S, at: number) => ({ state, attemptedAt: new Date(at).toISOString(), retryAfter: new Date(at + RETRY_MS[state]).toISOString() });
/** How many failed reads of MY OWN pages the research row remembers. A handful, never a log, and now a CAPACITY rather than a queue: an unexpired hold is never pushed out of it. */
const MAX_OWNED_READS = 10;
/** What the one owned read did: the memory to persist, and the pause when a body I had in hand could not be made durable. */
type OwnedRead = { held: OwnedPageReadOutcome[]; pause: string | null };
/** A page response is NOT a durable success until its snapshot write lands. This is my own persistence failing, so it is never a robots denial and never "your page did not answer": those are the page's answer, this one is mine. */
const OWNED_WRITE_PAUSE = "I read your page but I could not save what it says, so I am not counting it as read yet. I will read it again on your next visit.";

/** THE read of ONE page of the account's OWN, at most once per run, under the caller's live lease, and NEVER through a paid provider: the publisher here is the customer. Decision NAMES the URL and reads the result, so
 *  nothing about a page render ever reaches the customer's website. A success persists the canonical page snapshot and CLEARS the failure memory for that URL; a failure is remembered on the SAME retry policy a winning
 *  page gets, so the same dead URL is not refetched on every visit and the date I promised the operator stays that same date until the retry is genuinely due. */
async function readOwnedPage(d: ResolvedDeps, tenantId: string, held: OwnedPageReadOutcome[], url: string,
  deadline: number, profile: BusinessProfile | null): Promise<OwnedRead> {
  const now = d.now(), key = canonicalUrlKey(url), kept: OwnedPageReadOutcome[] = [], seen = new Set<string>();
  // PRUNE THE EXPIRED, THEN DEDUPE BY CANONICAL URL. Slicing a bounded list newest-first could drop an
  // unexpired 30-day robots hold once ten newer failures arrived, and that URL then looked untried and was
  // fetched before the very date I promised. An expired row is a memory of nothing and frees its slot instead.
  // A DATE I CANNOT READ IS NOT A PROMISE I MUST KEEP. `now >= NaN` is false, so a row whose retryAfter is
  // unparseable was never pruned and never expired: it blocked its own URL forever, and ten of them filled
  // the memory and failed every owned read of that account closed, for good. Unreadable means expired.
  const due = (t: string): boolean => { const ms = Date.parse(t); return !Number.isFinite(ms) || now >= ms; };
  for (const o of held) { const k = canonicalUrlKey(o.url); if (due(o.retryAfter) || seen.has(k)) continue; seen.add(k); kept.push(o); }
  // Inside its own live hold, or out of time: no fetch, and no new date. The winner loop has always checked the
  // deadline before every read; without the same check here the customer's own site was fetched twice, at ten
  // seconds apiece, AFTER the unit's budget was spent and often after the lease it was supposed to run under.
  if (seen.has(key) || now > deadline) return { held: kept, pause: null };
  // READ BEFORE FETCH, off the ONE canonical row the write below lands in. The snapshot write and the funnel
  // save are two different writes, so a state conflict on the second used to send me back out to the
  // customer's website for a body I had persisted seconds earlier. A body already on file at current
  // freshness IS the read: zero network, and the failure memory for that URL is already cleared above.
  const body = await d.readOwnedBodies(tenantId, [url]).then((m) => m.get(key) ?? null).catch(() => null);
  if (body?.fetchedAt && now - Date.parse(body.fetchedAt) <= FRESH_MS) return { held: kept, pause: null };
  // FAIL CLOSED ON A FULL MEMORY. A read whose failure I could not remember would be repeated on every pass
  // forever, and evicting a live hold would break a date I promised, so I do not make the read at all.
  if (kept.length >= MAX_OWNED_READS) { log.info("[research-funnel] owned read deferred: every read-memory slot is a live hold", { tenantId, holds: kept.length }); return { held: kept, pause: null }; }
  const absolute = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  const remember = (state: OwnedPageReadOutcome["state"]): OwnedRead => ({ held: [{ url, ...readOutcomeAt(state, now) }, ...kept].slice(0, MAX_OWNED_READS), pause: null });
  let res;
  try { res = await d.fetchPage(absolute, new Map(), {}); } catch { return remember("temporarily_unavailable"); }
  if (!res.ok) return remember(res.reason === "robots_blocked" ? "robots_blocked" : "temporarily_unavailable");
  // THE PROFILE TRAVELS WITH THE READ, like every other crawl of this account's pages. Extracting blind left
  // the location and service terms empty, and this row upserts on the SAME id the crawlers use, so a blind
  // read quietly degraded the richer row the account already had.
  // A SWALLOWED WRITE IS NOT A SUCCESS. Catching this failure let the unit carry on as though an acquired body
  // had become durable: nothing was persisted, so the memory is left exactly as it was, the page is never
  // called readable, and the phase pauses on MY OWN persistence failure, named as exactly that.
  // AND IT STILL EARNS A DATE. Pausing with the memory untouched left a persistently failing write refetching
  // the customer's site on every single visit, which is the exact behaviour the retry memory exists to stop.
  try { await d.writeOwnedPage(extractPageSnapshot(res.html, absolute, pageIdFor(url), tenantId, res.status, profile ?? undefined), tenantId); }
  catch { return { ...remember("temporarily_unavailable"), pause: OWNED_WRITE_PAUSE }; }
  return { held: kept, pause: null };
}

/** `priorityQueries`: plain strings from the caller (Evidence never reads Decision), the exact searches an open investigation cannot close without. Each banks its own top organic winners before the global fill, at the SAME total.
 *  TWO STAGES, one phase: the first reads and persists the winners and hands the run back; the caller renews the RUN lease and re-enters with `stage: "compare"`, so the ONE paid comparison is the first side effect of a live lease. */
export function winningPagesUnit(deps: FunnelDeps = {}, priorityQueries: string[] = [], intersection: FunnelIntersectionAsk | null = null, ownedUrl: string | null = null): FunnelUnitFn {
  const d = resolveDeps(deps);
  const resolve = deps.resolveCitations ?? resolveCitationTargets; // wrapper citations resolve to their REAL target before ranking, so one page is never two winners
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const deadline = d.now() + Math.max(1000, budgetMs), ids = { tenantId, unitKey: `winning:${tenantId}` };
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    beginCycle(state, cursor, ids.unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion }, nowIso = new Date(d.now()).toISOString();
    const pages: FunnelWinningPage[] = []; let attempts = 0; // attempts = pages I actually went out and read this cycle, the bounded total the counter reports
    try {
      // STAGE TWO of the SAME phase: the winners are already persisted and the caller renewed the RUN lease in between, so the ONE comparison is the FIRST side effect
      // this invocation has. Newest first, ONE row per topic, bounded. No ask (none earned, or the frozen topic could not be reconfirmed) is a $0 pass.
      if ((cursor as { stage?: string } | null)?.stage === "compare") {
        const bought = intersection ? await buyComparison(d, state, intersection, ids, nowIso) : null;
        if (bought) { state.pageComparisons = [bought, ...state.pageComparisons.filter((c) => c.topicKey !== bought.topicKey)].slice(0, MAX_COMPARISONS);
          await save(d, tenantId, basis, state, ctx); }
        return { status: "done", cursor: null, progress: { cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) } };
      }
      const account = await d.getAccount(tenantId).catch(() => null), profile = await d.loadProfile(tenantId).catch(() => null);
      const ownDomain = account?.domain ? rootDomain(account.domain) : null;
      const raw = collectAppearances(state, nowIso);
      const resolved = await Promise.resolve().then(() => resolve(raw, undefined, deadline)).catch(() => raw); // a resolver failure (sync OR async) degrades to raw appearances; the unit deadline bounds it
      const held = new Map(state.winningPages.map((w) => [w.url, w.readOutcome ?? null])); // what stopped me last time
      const robots = new Map<string, string[]>(), readPublishers = new Set<string>(); // ONE robots.txt read per origin
      const bank = async (url: string, x: ResearchPageExtract) => { await d.writePageExtract(url, x as unknown as Record<string, unknown>, extractHash(x)).catch(() => {}); };
      const ranked = rankWinningPages(resolved, ownDomain, WINNER_READ_BUDGET, priorityQueries), bench = new Map<string, typeof ranked>(), substituted = new Set<string>();
      for (const c of ranked) if (c.standby && c.ownerQuery) bench.set(c.ownerQuery, [...(bench.get(c.ownerQuery) ?? []), c]);
      // FOCUS BEFORE BREADTH: each priority search's own winners, then the substitutes their unreadable pages earn, then the global fill, every one of them spending from the SAME attempt total.
      const focus = ranked.filter((c) => !c.standby && c.ownerQuery), queue = [...focus, ...ranked.filter((c) => !c.standby && !c.ownerQuery)]; let focusEnd = focus.length, paidReads = 0;
      for (let i = 0; i < queue.length; i += 1) { const c = queue[i]!;
        const engines = [...new Set(c.appearances.map((a) => a.engine).filter((e): e is string => !!e))].sort(),
          examplePrompts = [...new Set(c.appearances.map((a) => a.promptText).filter((t): t is string => !!t))].slice(0, 5);
        let extract: ResearchPageExtract | null = null, outcome: WinnerReadOutcome | null = held.get(c.url) ?? null;
        // Reuse a cached public extract before any read; never re-read in freshness. Keep the CACHE ROW'S date when the extract predates the field: an undated winner never counts toward a comparison.
        const cached = await d.readPageExtract(c.url).catch(() => null);
        if (cached) { const e = pageExtractFromRecord(cached.extract); extract = { ...e, fetchedAt: e.fetchedAt ?? cached.fetchedAt ?? null }; outcome = null; }
        // A URL whose last read failed keeps that answer until retryAfter and spends no attempt before it.
        else if (attempts < MAX_PAGE_ATTEMPTS && d.now() <= deadline && !(outcome && d.now() < Date.parse(outcome.retryAfter))) {
          attempts += 1;
          try {
            const res = await d.fetchPage(c.url, robots, {});
            if (res.ok) { outcome = null;
              extract = pageExtractFrom(extractPageSnapshot(res.html, c.url, `winpage-${sha16(c.url)}`, tenantId, res.status, profile));
              await bank(c.url, extract);
            // The publisher's OWN answer is final: a robots denial is NEVER sent through a provider.
            } else if (res.reason === "robots_blocked") outcome = readOutcomeAt("robots_blocked", d.now());
            // An ordinary refusal or timeout earns exactly ONE paid read of the body, US/English, on the same money core, cache identity and cap as every other call, and only while this cycle's own paid ceiling is unspent.
            else if (paidReads >= MAX_PAID_BODY_READS) outcome = readOutcomeAt("temporarily_unavailable", d.now());
            else {
              paidReads += 1;
              const r = interp(await d.callProvider("onpage_content_parsing", { url: c.url }, ids)); track(state, r);
              const got = r.kind === "evidence" ? (d.parse("onpage_content_parsing", r.payload as never) as ResearchPageExtract | null) : null;
              // An empty parse is not a body: it stays a named gap, never a fake extract. Never invent freshness either, so the provider's OWN fetch time wins whenever it sends one.
              if (got && got.wordCount > 0) { extract = { ...got, fetchedAt: got.fetchedAt ?? nowIso }; outcome = null; await bank(c.url, extract); }
              // A CAP OR A DAILY LIMIT IS NOT THE PAGE'S FAULT. Those cost nothing and read nothing, so stamping the 7 day hold on them froze pages the provider never even looked at, and one cap event stamped every remaining winner. They wait a day.
              else outcome = readOutcomeAt(r.kind === "evidence" ? "provider_unavailable" : "temporarily_unavailable", d.now());
            }
          } catch { outcome = readOutcomeAt("temporarily_unavailable", d.now()); }
        }
        // The ranked URL is evidence in its own right, so an unreadable body never deletes a winner. An unreadable page frees ONE substitute, for ITS OWN search only, from that search's own bench, and admitting
        // it SPENDS that opportunity: one failure buys one substitute, and a publisher whose body I already hold teaches me nothing new. Anything else let a single failure unlock every bench on every topic.
        if (extract) readPublishers.add(publisherHost(c.url));
        else if (c.ownerQuery && !substituted.has(c.ownerQuery)) { const sub = (bench.get(c.ownerQuery) ?? []).find((b) => !readPublishers.has(publisherHost(b.url)));
          if (sub) { substituted.add(c.ownerQuery); queue.splice(focusEnd, 0, sub); focusEnd += 1; } }
        pages.push({ url: c.url, domain: c.domain, engines, examplePrompts, appearances: c.appearances, extract, readOutcome: outcome });
      }
      // CARRY THE MEMORY, NOT JUST THE PAGES. Replacing the list wholesale forgot the read outcome of any
      // URL that fell out of this cycle's top set, so its 403 was re-paid INSIDE the hold meant to stop that.
      const banked = new Set(pages.map((p) => p.url));
      // A carried row is MEMORY, not evidence: its appearances go with it, or a page that has since fallen
      // out of the results would still count as one of the three addresses a comparison PAYS to compare.
      state.winningPages = [...pages, ...state.winningPages.filter((w) => !banked.has(w.url) && w.readOutcome
        && d.now() < Date.parse(w.readOutcome.retryAfter)).map((w) => ({ ...w, extract: null, appearances: [] }))].slice(0, WINNER_READ_BUDGET * 2);
      // AT MOST ONE page of the account's OWN, named by the caller, read here rather than anywhere a render can reach.
      let ownedPause: string | null = null;
      if (ownedUrl) { const owned = await readOwnedPage(d, tenantId, state.ownedReads ?? [], ownedUrl, deadline, profile); state.ownedReads = owned.held; ownedPause = owned.pause; }
      // The winners land BEFORE this phase hands the run back. This save is the FUNNEL ROW's optimistic
      // row_version and nothing more: it proves only that no concurrent writer moved the research document.
      // It is NOT the ResearchRun lease, a different guarantee the caller renews between the two stages.
      await save(d, tenantId, basis, state, ctx);
      log.info("[research-funnel] page read budget", { tenantId, attempts, paidReads, ceilings: [MAX_PAGE_ATTEMPTS, MAX_PAID_BODY_READS] }); // internal progress truth: both ceilings, never silent
      const counters = { pageReadsAttempted: attempts, cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) };
      // The winners still landed, but a body I could not persist pauses this phase rather than handing the run
      // on as though the page were read. A retry re-enters stage one, where read-before-fetch decides honestly.
      if (ownedPause) return { status: "failed", cursor: null, progress: counters, detail: ownedPause };
      return { status: "advanced", cursor: { stage: "compare" }, progress: counters };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: { pageReadsAttempted: attempts }, detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
