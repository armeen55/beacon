import "server-only";
/** funnel/winning-pages (integrity closure) - THE page work of a research pass, split out of funnel/observe when that file reached its size ceiling: rank every SERP and AI appearance into winning pages, acquire the
 * bodies I am allowed to acquire under two explicit ceilings, read AT MOST ONE page of the account's OWN, and then, as a SECOND stage under a freshly renewed run lease, buy the ONE page-by-page comparison the winners
 * earned. Nothing here re-picks a topic (the caller freezes it), nothing pays twice for the same identity (the money core's cache does that), and no failed read is forgotten (every one carries its own retry date). */
import { log } from "@/lib/logger";
import { reportingDay } from "@/lib/reporting-day";
import type { BusinessProfile } from "@/domains/account";
import { canonicalUrlKey } from "@/domains/evidence/snapshot";
import { pageIdFor } from "@/domains/evidence/scanning/in-process-scan";
import { rootDomain } from "@/domains/evidence/readers/serp-provider";
import { resolveCitationTargets } from "@/domains/evidence/competitor-intel/polite-fetch";
import { extractPageSnapshot } from "@/domains/evidence/pages/extractor";
import type { FunnelUnitFn, ProviderEnvelope } from "@/domains/evidence/dataforseo/funnel-boundary";
import { owedWinnerReads, PRIORITY_WINNERS_PER_QUERY, rankWinningPages } from "./normalize";
import { type FunnelState, type FunnelWinningPage } from "./state";
import { askIdentity, normalizePageIntersection, parsePageIntersection, type PageIntersectionAsk } from "@/domains/evidence/page-intersection";
import { publisherHost } from "@/domains/evidence/serp-shape";
import { mainOf, pageExtractFrom, pageExtractFromRecord, type IntersectionUnavailable, type OwnedPageReadOutcome, type ResearchPageComparison, type ResearchPageExtract, type ResearchWinningAppearance, type WinnerReadOutcome } from "./research-evidence";
import { isCurrent } from "@/domains/evidence/freshness";
import { canonicalQueryKey } from "@/domains/evidence/relevance-gate";
import { basisFromCursor, beginCycle, CONFLICT_DETAIL, interp, NO_BASIS_DETAIL, resolveDeps, round, save, type SaveCtx, sha16, StateConflictError, track, type FunnelDeps, type ResolvedDeps } from "./shared";
import type { CanonicalPairObservation } from "./research-evidence";

/** Per cycle: three queries' five-page reserves, one substitute each, and a separate paid-read ceiling. */
const WINNER_READ_BUDGET = 15, MAX_COMPARISONS = 8, MAX_PAGE_ATTEMPTS = 18, MAX_PAID_BODY_READS = 6;
/** CONTENT identity, never the address: the same parsed extract in any key order hashes the SAME, and a changed title, heading, opening or body hashes DIFFERENTLY. Banking sha16(url) on the provider path froze
 *  a page's identity at its address forever, so a rewritten page looked unchanged to a store whose whole point is content-hash-aware reuse. fetchedAt is when I looked, not what the page says, so it is excluded. */
const extractHash = (x: ResearchPageExtract): string => sha16(JSON.stringify(Object.entries(x).filter(([k, v]) => k !== "fetchedAt" && v !== undefined).sort((a, b) => a[0].localeCompare(b[0]))));
/** A WINNER CARRIES A READING when its extract holds the page's own words, or says in type that the read happened and found none (`truncated` is written by every read and by no row banked before reading existed). THE one test, asked where a banked row is reused and where the winners are written, so one of them can never call a page read while the other calls it unread. */ const carriesReading = (x: ResearchPageExtract | null | undefined): boolean => !!x && (x.mainText != null || x.truncated != null);
/** The engines and the real prompt texts of ONE page's OWN appearances, derived wherever a winner row is written so a carried row describes the evidence that names it today rather than the evidence that named it when it was read. */ const facetsOf = (as: ResearchWinningAppearance[]) => ({ engines: [...new Set(as.map((a) => a.engine).filter((e): e is string => !!e))].sort(), examplePrompts: [...new Set(as.map((a) => a.promptText).filter((t): t is string => !!t))].slice(0, 5) });


/** SERPs plus dated canonical AI citations. Ranking dedupes modes after redirects resolve. */
function collectAppearances(state: FunnelState, fallbackIso: string, observations: CanonicalPairObservation[]): ResearchWinningAppearance[] {
  const out: ResearchWinningAppearance[] = [];
  for (const s of owedWinnerReads(state.serps.queries, [], null).currentSerps) {
    const at = s.observedAt || state.updatedAt || fallbackIso;
    for (const o of s.organic ?? []) out.push({ kind: "serp_organic", query: s.query, promptId: null, promptText: null, engine: null, rank: o.rank, citedUrl: o.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiOverview ?? []) out.push({ kind: "ai_overview", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
    for (const a of s.aiMode ?? []) out.push({ kind: "ai_mode", query: s.query, promptId: null, promptText: null, engine: null, rank: null, citedUrl: a.url, observedAt: at, modelServed: null, observationMode: null });
  }
  for (const p of observations) for (const c of p.citations ?? [])
    out.push({ kind: "ai_answer", query: null, promptId: p.promptId, promptText: p.promptText, promptVersion: p.promptVersion, observationId: p.observationId, reportingDay: p.reportingDay, engine: p.engine, rank: null, citedUrl: c.url, observedAt: p.observedAt ?? p.reportingDay, modelServed: p.modelServed, observationMode: p.observationMode });
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
  deadline: number, profile: BusinessProfile | null, bustedAt: string | null): Promise<OwnedRead> {
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
  // BUT A BODY READ BEFORE THE PAGE CHANGED IS NOT THE PAGE. `bustedAt` is when its truth moved underneath
  // me (an implementation the operator marked, or a content hash that moved), and a read older than that
  // moment describes a page that no longer exists, however recent the clock says it is.
  const body = await d.readOwnedBodies(tenantId, [url]).then((m) => m.get(key) ?? null).catch(() => null);
  if (isCurrent("owned_page", body?.fetchedAt, now, bustedAt)) return { held: kept, pause: null };
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

/** Read winners before comparing them under a renewed lease. Short turns persist one public reading and resume. */
export function winningPagesUnit(deps: FunnelDeps = {}, priorityQueries: string[] = [], intersection: FunnelIntersectionAsk | null = null, ownedUrl: string | null = null, ownedBustedAt: string | null = null, competitorUrl: string | null = null): FunnelUnitFn {
  const d = resolveDeps(deps);
  const resolve = deps.resolveCitations ?? resolveCitationTargets; // wrapper citations resolve to their REAL target before ranking, so one page is never two winners
  return async (tenantId, cursor, budgetMs) => {
    const basis = basisFromCursor(cursor);
    if (!basis) return { status: "failed", cursor, progress: {}, detail: NO_BASIS_DETAIL };
    const shortRead = budgetMs < 40_000, deadline = d.now() + Math.max(1000, budgetMs), ids = { tenantId, unitKey: `winning:${tenantId}` };
    const loaded = await d.loadState(tenantId, basis), state = loaded.state;
    beginCycle(state, cursor, ids.unitKey);
    const ctx: SaveCtx = { rowVersion: loaded.rowVersion }, nowIso = new Date(d.now()).toISOString();
    const pages: FunnelWinningPage[] = []; let attempts = 0; // attempts = pages I actually went out and read this cycle, the bounded total the counter reports
    try {
      // The caller renews the run lease between persisted readings and this comparison stage.
      if ((cursor as { stage?: string } | null)?.stage === "compare") {
        const bought = intersection ? await buyComparison(d, state, intersection, ids, nowIso) : null;
        if (bought) { state.pageComparisons = [bought, ...state.pageComparisons.filter((c) => c.topicKey !== bought.topicKey)].slice(0, MAX_COMPARISONS);
          await save(d, tenantId, basis, state, ctx); }
        return { status: "done", cursor: null, progress: { cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) } };
      }
      const account = await d.getAccount(tenantId).catch(() => null), profile = await d.loadProfile(tenantId).catch(() => null);
      const ownDomain = account?.domain ? rootDomain(account.domain) : null;
      const toDay = reportingDay(d.now()), fromDay = new Date(Date.parse(`${toDay}T12:00:00Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
      const observations = await d.loadCanonicalObservations(tenantId, { fromDay, toDay }).catch(() => null);
      if (observations === null) return { status: "failed", cursor, progress: {}, detail: "I could not read your stored AI evidence, so I spent nothing and kept your saved research." };
      const raw = collectAppearances(state, nowIso, observations);
      const resolved = await Promise.resolve().then(() => resolve(raw, undefined, deadline)).catch(() => raw); // a resolver failure (sync OR async) degrades to raw appearances; the unit deadline bounds it
      const prior = new Map(state.winningPages.map((w) => [canonicalUrlKey(w.url), w])); // the row I already hold for each page: the reading it carries, and what stopped me last time
      /** WHAT THE EVIDENCE ON FILE NAMES RIGHT NOW, under the same top-ten rule the ranking applies and BEFORE any window cuts it: every page this account's own results pages and answers still point at, with the appearances that say so. */ const still = new Map<string, ResearchWinningAppearance[]>();
      for (const a of resolved) { if (a.kind === "serp_organic" && (a.rank == null || a.rank > 10)) continue; const k = canonicalUrlKey(a.citedUrl); if (k) still.set(k, [...(still.get(k) ?? []), a]); }
      /** HOW MANY READINGS THE RESEARCH ROW CARRIES ACROSS RANKINGS: the results pages on file times the reserve each of them gets, because that is the arithmetic ceiling of what this pass itself ever reserves to read, so inside it a reading is dropped for the evidence and never for room. Never below the window the rule before this one kept. */ const readingsBound = Math.min(WINNER_READ_BUDGET * 4, Math.max(WINNER_READ_BUDGET * 2, state.serps.queries.filter((q) => q.status === "done").length * PRIORITY_WINNERS_PER_QUERY)); // AND NEVER MORE THAN FOUR WINDOWS OF READINGS ON THE ROW (integrator, 2026-09-06): the done searches times the reserve allowed 306 on the acceptance account, and every reading is up to 12,000 characters the due-work projection carries on every drive
      const robots = new Map<string, string[]>(), readPublishers = new Set<string>(); // ONE robots.txt read per origin
      const bank = async (url: string, x: ResearchPageExtract) => { await d.writePageExtract(url, x as unknown as Record<string, unknown>, extractHash(x)).catch(() => {}); };
      // A SEARCH THIS ACCOUNT PAID FOR WHOSE PAGES NOTHING HAS EVER RANKED TAKES ITS OWN RESERVE, newest search first and at most three a pass, off THE one selection rule in funnel/normalize. The global order is by ACCUMULATED appearances, so the ten pages of a results page bought this morning carry one each and lose every slot to pages that have been winning for weeks (proved on this file's own starvation pin): the search is paid for, nothing off it is ever read, and the row that owed that reading asks for the same results page again tomorrow. runtime/ops/due-work counts the pages of exactly these searches to make the read due, so a pass opened for that reason discharges what opened it and the receipt can never promise a search this pass will not take. The ORDER is that rule's too: appended behind the focused cases, an owed search fell off the far side of the reserve's own ceiling the moment this account carried forty of them, and the receipt named three pages nobody would open.
      const priority = owedWinnerReads(state.serps.queries, state.winningPages.map((w) => w.url), ownDomain, priorityQueries).queries;
      const requested = competitorUrl ? rankWinningPages(resolved.filter((a) => [a.citedUrl, a.viaUrl].some((u) => !!u && canonicalUrlKey(u) === canonicalUrlKey(competitorUrl)) && priorityQueries.some((q) => canonicalQueryKey(q) === canonicalQueryKey(a.query ?? a.promptText ?? ""))), ownDomain, 1)[0] : null;
      if (competitorUrl && !requested) return { status: "failed", cursor, progress: {}, detail: "The requested competitor page is not backed by this query's stored search or citation evidence; nothing was fetched." };
      const normal = rankWinningPages(resolved, ownDomain, WINNER_READ_BUDGET, priority), same = (c: typeof normal[number]) => !!requested && canonicalUrlKey(c.url) === canonicalUrlKey(requested.url);
      const ranked = requested ? [{ ...requested, ownerQuery: canonicalQueryKey(requested.appearances[0]?.query ?? requested.appearances[0]?.promptText ?? "") }, ...normal.filter((c) => !c.standby && !same(c))].slice(0, WINNER_READ_BUDGET).concat(normal.filter((c) => c.standby && !same(c))) : normal, bench = new Map<string, typeof ranked>(), substituted = new Set<string>();
      for (const c of ranked) if (c.standby && c.ownerQuery) bench.set(c.ownerQuery, [...(bench.get(c.ownerQuery) ?? []), c]);
      // Interleave focused cases before substitutes and global fill; all share the same attempt/spend ceilings.
      const focus = ranked.filter((c) => !c.standby && c.ownerQuery), queue = [...focus, ...ranked.filter((c) => !c.standby && !c.ownerQuery)]; let focusEnd = focus.length, paidReads = 0;
      for (let i = 0; i < queue.length; i += 1) { const c = queue[i]!;
        // A short turn reads at most one public page, leaving time to save and no paid fallback.
        if (shortRead && (attempts > 0 || deadline - d.now() < 25_000)) break;
        const was = prior.get(canonicalUrlKey(c.url)) ?? null;
        let extract: ResearchPageExtract | null = null, outcome: WinnerReadOutcome | null = was?.readOutcome ?? null;
        // Reuse a cached public extract before any read; never re-read in freshness. Keep the CACHE ROW'S date when the extract predates the field: an undated winner never counts toward a comparison.
        const cached = await d.readPageExtract(c.url).catch(() => null);
        const rec = cached ? pageExtractFromRecord(cached.extract) : null, legacy = rec && cached ? { ...rec, fetchedAt: rec.fetchedAt ?? cached.fetchedAt ?? null } : null;
        // Legacy metadata alone is not a reading. An explicitly completed empty reading is reusable, not useful copy evidence.
        if (carriesReading(legacy)) { extract = legacy; outcome = null; }
        // A URL whose last read failed keeps that answer until retryAfter and spends no attempt before it.
        else if (attempts < MAX_PAGE_ATTEMPTS && d.now() <= deadline && !(outcome && d.now() < Date.parse(outcome.retryAfter))) {
          attempts += 1;
          try {
            const res = await d.fetchPage(c.url, robots, shortRead ? { timeoutMs: 10_000 } : {});
            if (res.ok) { outcome = null;
              extract = pageExtractFrom(extractPageSnapshot(res.html, c.url, `winpage-${sha16(c.url)}`, tenantId, res.status, profile));
              await bank(c.url, extract);
            // The publisher's OWN answer is final: a robots denial is NEVER sent through a provider.
            } else if (res.reason === "robots_blocked") outcome = readOutcomeAt("robots_blocked", d.now());
            // An ordinary refusal or timeout earns exactly ONE paid read of the body, US/English, on the same money core, cache identity and cap as every other call, and only while this cycle's own paid ceiling is unspent.
            else if (shortRead || paidReads >= MAX_PAID_BODY_READS) outcome = readOutcomeAt("temporarily_unavailable", d.now());
            else {
              paidReads += 1;
              const r = interp(await d.callProvider("onpage_content_parsing", { url: c.url }, ids)); track(state, r);
              const got = r.kind === "evidence" ? (d.parse("onpage_content_parsing", r.payload as never) as ResearchPageExtract | null) : null;
              // Preserve provider freshness and total size; an empty parse remains evidence debt.
              if (got && got.wordCount > 0) { extract = { ...got, ...mainOf(got.mainText, got.totalChars ?? 0), fetchedAt: got.fetchedAt ?? nowIso }; outcome = null; await bank(c.url, extract); }
              // A CAP OR A DAILY LIMIT IS NOT THE PAGE'S FAULT. Those cost nothing and read nothing, so stamping the 7 day hold on them froze pages the provider never even looked at, and one cap event stamped every remaining winner. They wait a day.
              else outcome = readOutcomeAt(r.kind === "evidence" ? "provider_unavailable" : "temporarily_unavailable", d.now());
            }
          } catch { outcome = readOutcomeAt("temporarily_unavailable", d.now()); }
        }
        // Failed re-reads preserve banked words alongside their failure hold.
        if (!extract) extract = [legacy, was?.extract ?? null].find(carriesReading) ?? legacy;
        // An unreadable ranked page earns one same-query substitute, never unrelated acquisition.
        if (extract) readPublishers.add(publisherHost(c.url));
        else if (c.ownerQuery && !substituted.has(c.ownerQuery)) { const sub = (bench.get(c.ownerQuery) ?? []).find((b) => !readPublishers.has(publisherHost(b.url)));
          if (sub) { substituted.add(c.ownerQuery); queue.splice(focusEnd, 0, sub); focusEnd += 1; } }
        pages.push({ url: c.url, domain: c.domain, ...facetsOf(c.appearances), appearances: c.appearances, extract, readOutcome: outcome });
      }
      // Preserve live readings outside the ranked window and unexpired failure holds.
      const banked = new Set(pages.map((p) => canonicalUrlKey(p.url))), rest = state.winningPages.filter((w) => !banked.has(canonicalUrlKey(w.url)));
      const kept = rest.flatMap((w) => { const live = still.get(canonicalUrlKey(w.url)); return live && carriesReading(w.extract) ? [{ ...w, ...facetsOf(live), appearances: live }] : []; })
        .sort((a, b) => (b.extract?.fetchedAt ?? "").localeCompare(a.extract?.fetchedAt ?? "")).slice(0, readingsBound), keptKeys = new Set(kept.map((w) => canonicalUrlKey(w.url)));
      state.winningPages = [...pages, ...kept, ...rest.filter((w) => !keptKeys.has(canonicalUrlKey(w.url)) && w.readOutcome
        && d.now() < Date.parse(w.readOutcome.retryAfter)).map((w) => ({ ...w, extract: null, appearances: [] })).slice(0, WINNER_READ_BUDGET * 2)];
      // AT MOST ONE page of the account's OWN, named by the caller, read here rather than anywhere a render can reach.
      let ownedPause: string | null = null;
      if (ownedUrl && !shortRead) { const owned = await readOwnedPage(d, tenantId, state.ownedReads ?? [], ownedUrl, deadline, profile, ownedBustedAt); state.ownedReads = owned.held; ownedPause = owned.pause; }
      // Optimistic funnel persistence is separate from the caller's renewed ResearchRun lease.
      await save(d, tenantId, basis, state, ctx);
      log.info("[research-funnel] page read budget", { tenantId, attempts, paidReads, ceilings: [MAX_PAGE_ATTEMPTS, MAX_PAID_BODY_READS] }); // internal progress truth: both ceilings, never silent
      const counters = { pageReadsAttempted: attempts, cacheHits: state.cycle.cacheHits, spendUsd: round(state.cycle.spentUsd) };
      // Unacknowledged owned-body persistence pauses without pretending delivery succeeded.
      if (ownedPause) return { status: "failed", cursor: null, progress: counters, detail: ownedPause };
      return { status: "advanced", cursor: { stage: shortRead && attempts > 0 ? "read" : "compare" }, progress: counters };
    } catch (e) {
      if (e instanceof StateConflictError) return { status: "failed", code: "state_conflict", cursor, progress: { pageReadsAttempted: attempts }, detail: CONFLICT_DETAIL };
      throw e;
    }
  };
}
